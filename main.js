// electron の shell は electronShell として受ける。terminal:create の中でログインシェルの
// パスを持つローカル変数 shell と名前がぶつかるため、紛らわしさを避けて別名にしている。
const { app, BrowserWindow, ipcMain, screen, dialog, shell: electronShell, clipboard } = require('electron');
const pty = require('node-pty');
const path = require('path');
const os = require('os');
const fs = require('fs');
const http = require('http');
const crypto = require('crypto');
const { execFile } = require('child_process');
const { promisify } = require('util');
const { pathToFileURL } = require('url');
const { stripAnsiForPattern } = require('./utils/stripAnsi');
const {
  createTrustPromptGate,
  isTrustPrompt,
  TRUST_WINDOW_MS: DEFAULT_TRUST_WINDOW_MS,
  READY_GRACE_MS: DEFAULT_READY_GRACE_MS,
  resolvePositiveFiniteMs,
} = require('./utils/trustPromptGate');
// 宣言的ウィジェット（tasks-widget.json）契約の共有ロジック（#229 / vk-orchestrator#182）。
// タスクのドメイン語彙（遷移マトリクス・ラベル・優先度など）はこのプロセスに持たず、
// orchestrator が書き出す宣言を検証・中継するだけの汎用実装にする。
const widgetContract = require('./utils/widgetContract');
// エージェントルーム（issue #58）の agent 名・state 検証を renderer 側と共有する。
// canonicalizeState / isKnownAgent は DOM 非依存なので main プロセスから require して使える。
const { canonicalizeState, isKnownAgent } = require('./renderer/agentRoom');
// トークン使用量トラッカー（issue #69）。トランスクリプト集計＋整形はすべて usageTracker 側。
const { createUsageTracker, createTtlMemo } = require('./usageTracker');
// 公式 usage API（issue #73）。OAuth トークンは oauthUsage モジュール（main プロセス）内で
// のみ扱い、ここから先へは正規化済みの数値（%・リセット時刻・source 種別）だけを渡す。
const { createOauthUsageProvider } = require('./oauthUsage');
const { createCodexUsageProvider } = require('./codexUsage');
const { createCodexUsageTracker } = require('./codexUsageTracker');
// GUI(Electron) の GPU 起動モード。WSLg 等の Linux では Chromium の GPU 初期化が
// 失敗して起動時にエラーが多発するため、既定で GPU を無効化する。モードは
// VK_TERMINALS_GPU（環境変数）または config.json の gpu で off/default を
// 選べる（優先順位は env > config > プラットフォーム既定）。呼び出し側（VK Orchestrator
// 等）が argv で GPU スイッチを明示している場合は介入しない。詳細は utils/gpu.js を参照。
const { applyGpuMode } = require('./utils/gpu');
const { normalizeConfirmClose } = require('./utils/closeConfirm');
const { normalizeTerminalLinkClickMode } = require('./utils/terminalLinkPolicy');
// 外部ブラウザで開いてよい URL の判定（renderer と共有）。renderer 側にも同じ判定が
// あるが、最終防衛線はこのプロセス側（issue #268）。
const { isSafeHttpUrl } = require('./renderer/urlSafety');
// 新規ペインで起動する AI エンジンとモデル指定（issue #367 / #374）の検証と、
// 起動コマンドの組み立て（issue #310）。HTTP 受け口と terminal:create の両方で使い、
// 片方を通らない経路が増えても素通りさせない。
const {
  isValidModelForEngine,
  isValidEngine,
  buildEngineAwareLaunchCommand,
} = require('./renderer/claudeModel');
const { resolveInstanceId, buildHealthResponse } = require('./utils/instanceId');
const {
  describeSettingsValues,
  describeTargetPaths,
  isValidSettingsDescriptor,
  resolveSavedFieldValues,
  saveSettingsToTargets,
  readJsonObject,
} = require('./settingsTargets');
const { buildBuiltinSettingsDescriptor } = require('./settingsSchema');
// HTTP API のアクセストークン認証（issue #313）。トークン生成・timing-safe 比較・
// 認証要否判定・Cookie 組み立ては utils/apiAuth.js に切り出し、単体テストしやすくしてある。
const {
  generateApiToken,
  isValidApiTokenFormat,
  shouldRequireAuth,
  isAuthorizedRequest,
  extractTokenFromRequest,
  buildAuthCookieHeader,
  isAuthExemptPath,
  evaluateTokenRegistration,
} = require('./utils/apiAuth');
const { isAllowedApiHost } = require('./utils/apiHostAllowlist');
// mobile.html（HTTP 配信）向け CSP ヘッダーの組み立て（issue #324）。
const { buildMobileCsp } = require('./utils/csp');
// clipboard へ書き込んでよい文字列の上限（issue #325）。定義はここ（utils/clipboardLimits.js）
// の 1 箇所のみで、preload.js へは BrowserWindow 生成時に additionalArguments で渡す
// （理由は utils/clipboardLimits.js のコメントを参照）。
const { MAX_CLIPBOARD_TEXT_LENGTH, CLIPBOARD_MAX_LENGTH_ARG_PREFIX } = require('./utils/clipboardLimits');
// POST /api/set-title の prMerged / waitingMerge（issue #44 / #363）共通の真偽値パーサ。
const { parseStrictBoolFlag } = require('./utils/strictBoolFlag');
const execFileAsync = promisify(execFile);

let win;
const ptys = new Map();
let nextId = 1;
let firstTerminalCreated = false;

// CLI フラグ: `--no-claude`（または `--plain`）が指定された場合、
// 新規ペインで claude を自動起動せず素のシェルとして開く。
// 起動方法: `npm start -- --no-claude` または `electron . --no-claude`
const globalPlainMode = process.argv.includes('--no-claude') || process.argv.includes('--plain');

// /api/new-pane の HTTP レスポンスを待つコールバック（requestId → resolver）
// 並行リクエストでも取り違えが起きないように requestId で相関付ける
const pendingNewPaneCallbacks = new Map();
let nextNewPaneRequestId = 1;
const pendingClosePaneCallbacks = new Map();
let nextClosePaneRequestId = 1;

// ─── Terminal state & HTTP API ───────────────────────────────────────────────
const DATA_DIR = path.join(os.homedir(), '.vk-terminals');
const STATE_FILE = path.join(DATA_DIR, 'states.json');
const LOG_PREFIX = '[vk-terminals]';

// 信頼確認プロンプトの自動応答に関わる2つの時間窓を、e2e から「短縮」できるようにする
// 入口（issue #371。安藤のセキュリティレビュー・必須2）。未設定・不正値（0以下・NaN・
// Infinity・空文字等）は utils/trustPromptGate.js の既定値へ倒す（resolvePositiveFiniteMs）。
// 実時間で 30 秒（TRUST_WINDOW_MS）待つテストを避けるための調整用で、通常起動では
// 環境変数を設定しないため既定値のまま動く。
//
// max に各既定値を渡し、既定より大きい値は既定値へ切り詰める（安藤の指摘・MEDIUM・
// 必須1）。上限を設けないと、この2つの環境変数が「時間窓を延長して自動応答の防御を
// 無効化する」経路にもなってしまう（例: dotfile に export で極端に大きい値を設定される
// と、以後そのマシンでは信頼確認プロンプトへの自動応答をいつまでも許可し続ける）。
// e2e が必要としているのは短縮だけなので、上書きを短縮方向のみに制限する。
const RESOLVED_TRUST_WINDOW_MS = resolvePositiveFiniteMs(
  process.env.VK_TERMINALS_TRUST_WINDOW_MS, DEFAULT_TRUST_WINDOW_MS, { max: DEFAULT_TRUST_WINDOW_MS }
);
const RESOLVED_READY_GRACE_MS = resolvePositiveFiniteMs(
  process.env.VK_TERMINALS_READY_GRACE_MS, DEFAULT_READY_GRACE_MS, { max: DEFAULT_READY_GRACE_MS }
);
// 既定値と異なる値が採用されたときは警告ログを残す（後から切り分けやすくするため）。
if (RESOLVED_TRUST_WINDOW_MS !== DEFAULT_TRUST_WINDOW_MS) {
  console.warn(`${LOG_PREFIX} VK_TERMINALS_TRUST_WINDOW_MS override in effect: ${RESOLVED_TRUST_WINDOW_MS}ms (default ${DEFAULT_TRUST_WINDOW_MS}ms)`);
}
if (RESOLVED_READY_GRACE_MS !== DEFAULT_READY_GRACE_MS) {
  console.warn(`${LOG_PREFIX} VK_TERMINALS_READY_GRACE_MS override in effect: ${RESOLVED_READY_GRACE_MS}ms (default ${DEFAULT_READY_GRACE_MS}ms)`);
}

// ウィンドウタイトルバーおよびヘッダーに表示するアプリ名。既定は 'VK Terminals'。
// 呼び出し側（例: vk-orchestrator）が env VK_TERMINALS_APP_TITLE を渡すと、その名称
// （例: 'VK Orchestrator'）を表示する。renderer には app:get-config 経由で伝える。
const APP_TITLE = (() => {
  const t = process.env.VK_TERMINALS_APP_TITLE;
  return typeof t === 'string' && t.trim() ? t.trim() : 'VK Terminals';
})();
// 呼び出し側（例: vk-orchestrator）が起動時に渡した GUI インスタンス識別子。
// /api/health で同じポート上の別インスタンスとの取り違えを検出できるようにする。
// 未指定・空文字の場合は後方互換のため health レスポンスへ instanceId を含めない。
const INSTANCE_ID = resolveInstanceId(process.env);
// /api/send で「本文 + 末尾 Enter」を 1 リクエストで受け取ったとき、本文と Enter を
// 分割して送るまでの待機時間（ms）。本文と \r を 1 回の write でまとめて流すと、
// Claude Code の TUI がペースト（複数行入力）扱いして末尾 \r を入力欄の改行として
// 吸収し Enter 確定にならない（URL のような長い入力で特に再現しやすい）。
// 本文を先に流して TUI の再描画が落ち着いてから Enter を送ることで確実に確定させる。
const SEND_ENTER_SPLIT_DELAY_MS = 150;
let cachedStates = {};  // renderer から受け取った状態キャッシュ
let httpServer = null;
let apiServerRuntimeStatus = {
  phase: 'pending',
  startupHost: '',
  actualHost: '',
  errorCode: '',
  fellBack: false,
};

const MENU_ACTION_TYPES = new Set(['open-settings', 'open-url']);
const MENU_MAX_SECTIONS = 20;
const MENU_MAX_ITEMS = 50;
const MENU_MAX_CHILDREN = 20;
const MENU_MAX_TEXT = 200;
const MENU_MAX_SOURCE = 100;
const MENU_MAX_ICON = 8;
const menuSources = new Map();

// 宣言的ウィジェット（tasks-widget.json）の監視。旧 tasks-view.json とは別系統で監視し、
// dual-write 期間は新パス（widget）を優先する。
const WIDGET_POLL_INTERVAL_MS = 3000;
const WIDGET_WATCH_DEBOUNCE_MS = 150;
let widgetFilePath = '';
let widgetWatch = null;
let widgetPollTimer = null;
let widgetDebounceTimer = null;
let widgetLastRaw = Symbol('widgetLastRaw:init');
let widgetPayload = null;

function validateUrlField(raw, fieldName) {
  if (raw === '' || raw == null) {
    return { ok: true, value: '' };
  }
  if (typeof raw !== 'string') {
    return { ok: false, error: `${fieldName} must be a string` };
  }
  if (raw.length > 2048) {
    return { ok: false, error: `${fieldName} too long (max 2048 chars)` };
  }
  let parsedUrl;
  try {
    parsedUrl = new URL(raw);
  } catch (_e) {
    return { ok: false, error: `invalid ${fieldName}` };
  }
  if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
    return { ok: false, error: `${fieldName} must be http(s)` };
  }
  return { ok: true, value: raw };
}

function isSafeMenuIcon(icon) {
  if (typeof icon !== 'string') return false;
  const value = icon.trim();
  if (!value || value.length > MENU_MAX_ICON || /[<>&]/.test(value)) return false;
  return /^(?:\p{Extended_Pictographic}(?:\uFE0F|\uFE0E)?)(?:\s?(?:\p{Extended_Pictographic}(?:\uFE0F|\uFE0E)?))?$/u.test(value);
}

function validateMenuItem(raw, source, depth, seenIds) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, error: 'menu item must be an object' };
  }
  if (typeof raw.id !== 'string' || !raw.id.trim()) {
    return { ok: false, error: 'menu item id required' };
  }
  if (raw.id.length > MENU_MAX_TEXT) {
    return { ok: false, error: 'menu item id too long' };
  }
  const itemKey = `${source}:${raw.id}`;
  if (seenIds.has(itemKey)) {
    return { ok: false, error: `duplicate menu item id "${raw.id}"` };
  }
  seenIds.add(itemKey);

  if (typeof raw.label !== 'string' || !raw.label.trim()) {
    return { ok: false, error: 'menu item label required' };
  }
  if (raw.label.length > MENU_MAX_TEXT) {
    return { ok: false, error: 'menu item label too long' };
  }

  const item = {
    id: raw.id.trim(),
    label: raw.label,
  };
  if (raw.icon != null && raw.icon !== '') {
    if (!isSafeMenuIcon(raw.icon)) {
      return { ok: false, error: 'menu item icon must be emoji only' };
    }
    item.icon = raw.icon.trim();
  }

  if (raw.action != null) {
    if (!raw.action || typeof raw.action !== 'object' || Array.isArray(raw.action)) {
      return { ok: false, error: 'menu item action must be an object' };
    }
    if (!MENU_ACTION_TYPES.has(raw.action.type)) {
      return { ok: false, error: `unsupported menu action "${raw.action.type}"` };
    }
    if (raw.action.type === 'open-settings') {
      item.action = { type: 'open-settings' };
    } else if (raw.action.type === 'open-url') {
      const r = validateUrlField(raw.action.url, 'action.url');
      if (!r.ok || !r.value) {
        return { ok: false, error: r.error || 'action.url required' };
      }
      item.action = { type: 'open-url', url: r.value };
    }
  }

  if (raw.children != null) {
    if (!Array.isArray(raw.children)) {
      return { ok: false, error: 'menu item children must be an array' };
    }
    if (depth >= 1) {
      return { ok: false, error: 'menu item children depth exceeded' };
    }
    if (raw.children.length > MENU_MAX_CHILDREN) {
      return { ok: false, error: `menu item children too many (max ${MENU_MAX_CHILDREN})` };
    }
    const children = [];
    for (const child of raw.children) {
      const r = validateMenuItem(child, source, depth + 1, seenIds);
      if (!r.ok) return r;
      children.push(r.item);
    }
    item.children = children;
  }

  return { ok: true, item };
}

function validateMenuSection(raw, options = {}) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, error: 'menu section must be an object' };
  }
  const sourceRaw = typeof raw.source === 'string' ? raw.source : options.defaultSource;
  if (typeof sourceRaw !== 'string' || !sourceRaw.trim()) {
    return { ok: false, error: 'source required' };
  }
  if (sourceRaw.length > MENU_MAX_SOURCE) {
    return { ok: false, error: `source too long (max ${MENU_MAX_SOURCE} chars)` };
  }
  if (!Array.isArray(raw.items)) {
    return { ok: false, error: 'items array required' };
  }
  if (raw.items.length > MENU_MAX_ITEMS) {
    return { ok: false, error: `items too many (max ${MENU_MAX_ITEMS})` };
  }
  const source = sourceRaw.trim();
  const section = { source, items: [] };
  if (raw.title != null) {
    if (typeof raw.title !== 'string') {
      return { ok: false, error: 'title must be a string' };
    }
    if (raw.title.length > MENU_MAX_TEXT) {
      return { ok: false, error: 'title too long' };
    }
    section.title = raw.title;
  }

  const seenIds = new Set();
  for (const item of raw.items) {
    const r = validateMenuItem(item, source, 0, seenIds);
    if (!r.ok) return r;
    section.items.push(r.item);
  }
  return { ok: true, section };
}

function getConfigMenuSections() {
  const config = loadUserConfig();
  const rawSections = Array.isArray(config.menuItems) ? config.menuItems : [];
  if (!rawSections.length) return [];
  if (rawSections.length > MENU_MAX_SECTIONS) {
    console.error(`${LOG_PREFIX} config menuItems too many (max ${MENU_MAX_SECTIONS})`);
    return [];
  }
  const sections = [];
  for (const raw of rawSections) {
    const r = validateMenuSection(raw, { defaultSource: 'config' });
    if (!r.ok) {
      console.error(`${LOG_PREFIX} invalid config menu item: ${r.error}`);
      return [];
    }
    sections.push(r.section);
  }
  return sections;
}

function mergedMenuSections() {
  return [
    ...getConfigMenuSections(),
    ...Array.from(menuSources.values()),
  ];
}

function pushMenuUpdate() {
  if (win && !win.isDestroyed()) {
    win.webContents.send('menu:update', mergedMenuSections());
  }
}

function normalizeAbsoluteConfigPath(config, keys) {
  for (const key of keys) {
    const raw = config && typeof config[key] === 'string' ? config[key].trim() : '';
    if (raw && path.isAbsolute(raw)) return raw;
  }
  return '';
}

// 新 tasks-widget.json（宣言的ウィジェット）の絶対パス。widgetFile 優先、tasksWidgetPath も受け付ける。
function normalizeTasksWidgetFile(config) {
  return normalizeAbsoluteConfigPath(config, ['widgetFile', 'tasksWidgetPath', 'tasksWidgetFile']);
}

// 旧 tasks-view.json の絶対パス。dual-write 期間の後方互換注記（legacyNotice）判定にのみ使う。
function normalizeTasksFile(config) {
  return normalizeAbsoluteConfigPath(config, ['tasksFile', 'tasksViewPath']);
}

function normalizeCommandsFile(config) {
  return normalizeAbsoluteConfigPath(config, ['commandsPath', 'tasksCommandFile']);
}

// tasks-widget.json を読み、契約に沿ってサニタイズしたウィジェットを返す。
// ファイルが無い・JSON が壊れている・kind が契約外のときは widget: null を返す。
function readWidgetFromFile(filePath) {
  let raw = null;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch (_e) {
    return { raw: null, widget: null };
  }
  try {
    const parsed = JSON.parse(raw);
    // サーバー側の検証（防御的サニタイズ）。tone/field/action/rel の allowlist・文字長上限・
    // URL の http(s) 検証・payload のプリミティブ化をここで行い、renderer へ渡す前に安全化する。
    const widget = widgetContract.sanitizeWidget(parsed);
    return { raw, widget };
  } catch (e) {
    console.error(`${LOG_PREFIX} Failed to parse tasks widget: ${filePath}`, e.message);
    return { raw, widget: null };
  }
}

// renderer / モバイルへ配る中継ペイロードを組み立てる。
// dual-write 期間: 新 widget があればそれを描画。無く旧 tasks-view.json だけがある場合は
// タスク語彙を復活させず legacyNotice のみ立てる（意味論には踏み込まない）。
function buildWidgetPayload(widget) {
  const config = loadUserConfig();
  const legacyConfigured = !!normalizeTasksFile(config);
  const legacyNotice = !widget && legacyConfigured;
  return {
    widget: widget || null,
    legacyNotice,
    commandsConfigured: !!normalizeCommandsFile(config),
  };
}

// commands.jsonl へ 1 行追記する共通機構（新 action は増やさない）。
async function appendTaskCommand(command, commandsFile = normalizeCommandsFile(loadUserConfig())) {
  if (!commandsFile) {
    return { ok: false, error: 'commands-file-not-configured' };
  }
  await fs.promises.mkdir(path.dirname(commandsFile), { recursive: true });
  await fs.promises.appendFile(commandsFile, `${JSON.stringify(command)}\n`, 'utf8');
  return { ok: true, id: command.id };
}

// 宣言のコマンド断片（単項目または apply-batch）を受け取り、契約 allowlist で検証してから
// 一意 id と requestedAt を付与し commands.jsonl へ追記する。ビューア（VK Terminals）が id と
// requestedAt を付与する契約なので、ここで crypto.randomUUID と ISO8601 を採番する。
async function submitWidgetCommand(fragment) {
  try {
    const commandsFile = normalizeCommandsFile(loadUserConfig());
    if (!commandsFile) {
      return { ok: false, error: 'commands-file-not-configured' };
    }
    const meta = {
      id: crypto.randomUUID(),
      requestedAt: new Date().toISOString(),
    };
    const command = (fragment && fragment.action === 'apply-batch')
      ? widgetContract.buildBatchCommandLine(fragment, meta)
      : widgetContract.buildCommandLine(fragment, meta);
    if (!command) {
      return { ok: false, error: 'invalid-command' };
    }
    return appendTaskCommand(command, commandsFile);
  } catch (e) {
    console.error(LOG_PREFIX, e);
    return { ok: false, error: 'internal-error' };
  }
}

function widgetCommandHttpStatus(result) {
  if (!result || result.ok) return 200;
  if (result.error === 'commands-file-not-configured') return 409;
  if (result.error === 'invalid-command') return 400;
  return 500;
}

function currentWidgetPayload() {
  if (widgetPayload) return widgetPayload;
  const config = loadUserConfig();
  const filePath = normalizeTasksWidgetFile(config);
  const widget = filePath ? readWidgetFromFile(filePath).widget : null;
  widgetPayload = buildWidgetPayload(widget);
  return widgetPayload;
}

function pushWidgetUpdate() {
  if (!win || win.isDestroyed()) return;
  win.webContents.send('widgets:update', currentWidgetPayload());
}

function refreshWidgetSnapshot(forceSend = false) {
  const config = loadUserConfig();
  widgetFilePath = normalizeTasksWidgetFile(config);
  const next = widgetFilePath ? readWidgetFromFile(widgetFilePath) : { raw: null, widget: null };
  const changed = next.raw !== widgetLastRaw;
  widgetLastRaw = next.raw;
  widgetPayload = buildWidgetPayload(next.widget);
  if (changed || forceSend) pushWidgetUpdate();
}

function scheduleWidgetRefresh() {
  if (widgetDebounceTimer) clearTimeout(widgetDebounceTimer);
  widgetDebounceTimer = setTimeout(() => {
    widgetDebounceTimer = null;
    refreshWidgetSnapshot(true);
  }, WIDGET_WATCH_DEBOUNCE_MS);
}

function startWidgetWatcher() {
  widgetFilePath = normalizeTasksWidgetFile(loadUserConfig());
  refreshWidgetSnapshot(false);
  if (!widgetFilePath) return;

  try {
    const dir = path.dirname(widgetFilePath);
    const base = path.basename(widgetFilePath);
    widgetWatch = fs.watch(dir, (eventType, filename) => {
      if (!filename || String(filename) === base) scheduleWidgetRefresh();
    });
    widgetWatch.on('error', (e) => {
      console.error(`${LOG_PREFIX} widget watcher failed:`, e && e.message);
    });
  } catch (e) {
    console.error(`${LOG_PREFIX} Failed to watch widget file: ${widgetFilePath}`, e && e.message);
  }

  widgetPollTimer = setInterval(() => refreshWidgetSnapshot(false), WIDGET_POLL_INTERVAL_MS);
}

function stopWidgetWatcher() {
  if (widgetDebounceTimer) clearTimeout(widgetDebounceTimer);
  widgetDebounceTimer = null;
  if (widgetPollTimer) clearInterval(widgetPollTimer);
  widgetPollTimer = null;
  if (widgetWatch) {
    try { widgetWatch.close(); } catch (_e) {}
  }
  widgetWatch = null;
}

// loadUserConfig() / resolveTokenConfigPath()（アクセストークン専用パス解決）が
// 共有する設定ファイルの探索候補。両者の探索順がずれると、一方だけが後方互換パスを
// 見つけて他方が見つけない、という事故が起きる（issue #313 レビュー対応・中-1/中-2）ため、
// 候補配列そのものをこの 1 か所で共有する。
function userConfigCandidatePaths() {
  return [
    path.join(DATA_DIR, 'config.json'),
    path.join(__dirname, 'config.json'),
    path.join(os.homedir(), '.claude', 'terminals-config.json'), // 後方互換
  ];
}

/**
 * ユーザー設定を読み込む。
 * 読み込み順:
 *   1. ~/.vk-terminals/config.json（ユーザー固有設定）
 *   2. {appDir}/config.json（リポジトリローカル設定）
 *   3. ~/.claude/terminals-config.json（後方互換）
 * どちらも存在しない場合は空オブジェクトを返す。
 *
 * @returns {{ initialCommand?: string, additionalPanes?: Array<{cwd: string}>, waitingExcludeCwdPatterns?: string[], tasksFile?: string }} 設定オブジェクト
 */
function loadUserConfig() {
  const candidates = userConfigCandidatePaths();

  for (const configPath of candidates) {
    if (fs.existsSync(configPath)) {
      try {
        const raw = fs.readFileSync(configPath, 'utf8');
        return JSON.parse(raw);
      } catch (e) {
        console.error(`${LOG_PREFIX} Failed to parse config: ${configPath}`, e);
      }
    }
  }

  return {};
}

// app が ready になる前に GPU スイッチを適用する（appendSwitch は ready 前に呼ぶ必要がある）。
// config.json の gpu も見るため loadUserConfig 定義後に実行する（env 未指定時に config を採用）。
const appliedGpuMode = applyGpuMode(app, { configMode: loadUserConfig().gpu });
if (appliedGpuMode) console.log(`${LOG_PREFIX} GPU mode: ${appliedGpuMode}`);

// テストや並列起動時は環境変数で上書きし、未指定時は config.json の port を採用する。
// loadUserConfig() は DATA_DIR を参照するため、DATA_DIR / loadUserConfig 定義後に算出する。
const API_PORT = (() => {
  const raw = Number(process.env.VK_TERMINALS_API_PORT ?? loadUserConfig().port);
  return Number.isInteger(raw) && raw >= 1 && raw <= 65535 ? raw : 13847;
})();

// ─── アクセストークン（issue #313）────────────────────────────────────────────
// 初回起動時に暗号論的に安全な乱数でトークンを生成し、config.json の apiToken へ
// 保存する（利用者に安全な文字列を考えさせない）。永続化に失敗した場合はメモリ上
// だけの一時トークンで起動する（この場合、次回起動でトークンが変わり、登録済みの
// 端末はすべて再登録が必要になる。apiHost が 127.0.0.1 のまま＝認証不要な状態なら
// 実害が無いため、警告ログのみでそのまま起動する）。
// ensureApiToken / persistApiToken は resolveOwnConfigTargetPath 定義の直後にある
// （関数宣言は巻き上げられるため、定義位置がここより下でも呼び出せる）。
let { token: API_TOKEN, persisted: apiTokenPersisted } = ensureApiToken();
if (!apiTokenPersisted) {
  console.warn(`${LOG_PREFIX} Failed to persist API token to config.json. Using an in-memory token for this session only; it will change (and re-registration will be required on mobile) after the next restart.`);
}

function normalizeApiHost(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : '127.0.0.1';
}

// 設定パネルへ渡す API サーバー状態。bind 結果は起動処理が確定した値を保持し、
// savedHost だけは呼び出し時点の設定ファイルを読む。これにより「フォールバック」と
// 「保存したが未再起動」を、起動時・現在・実 bind の 3 値で renderer が判別できる。
// fellBack は文字列比較では分からない「EADDRNOTAVAIL 後にループバックへ切り替えた」
// という起動処理の事実を伝える。
function describeApiServerRuntimeStatus() {
  return {
    ...apiServerRuntimeStatus,
    port: API_PORT,
    savedHost: normalizeApiHost(loadUserConfig().apiHost),
  };
}

// ─── トークン使用量（issue #69）────────────────────────────────────────────────
// GET /api/states（モバイルページが ~2s ごとにポーリング）のホットパスで usage 判定の
// たびに loadUserConfig() の同期 I/O（readFileSync + JSON.parse）を走らせないよう、
// usage 系ヘルパー専用に config を短TTL（5s）でメモ化する（CR-1）。
//   - このメモは usage 判定（usageEnabled / usageProjectsDirs）だけが使う。settings:describe /
//     settings:save / app:get-config は従来どおり loadUserConfig() を直接呼ぶ（設定変更を即時反映
//     させるため、loadUserConfig 自体はグローバルキャッシュしない）。
//   - TTL 5s なので、設定変更後も遅くとも 5 秒で usage 表示に反映される。
const USAGE_CONFIG_TTL_MS = 5000;
const usageConfig = createTtlMemo(loadUserConfig, USAGE_CONFIG_TTL_MS);

// showUsage は opt-out（既定 ON）。config.json で明示的に false のときだけ無効化する。
// （settings descriptor 側でも default:true を持たせ、GUI の未設定→false 化を防ぐ。）
function usageEnabled() {
  return usageConfig().showUsage !== false;
}

function codexUsageEnabled() {
  return usageConfig().showCodexUsage !== false;
}

// 集計対象の Claude projects ディレクトリ。複数アカウントは config.claudeProjectsDirs で
// 複数指定できる。未指定なら usageTracker 側の既定（~/.claude/projects）を使う。
function usageProjectsDirs() {
  const raw = usageConfig().claudeProjectsDirs;
  if (Array.isArray(raw)) {
    const dirs = raw.filter((d) => typeof d === 'string' && d.trim());
    if (dirs.length) return dirs;
  }
  return null; // null → usageTracker のデフォルト
}

// トラッカーは 1 個だけ生成し、差分読み・SWR キャッシュを内包させる。
const usageTracker = createUsageTracker({
  getDirs: () => usageProjectsDirs(),
});

// 表示用に整形したスナップショットを返す。無効時・失敗時は null（アプリ本体に影響させない）。
function getUsageForDisplay() {
  try {
    if (!usageEnabled()) return null;
    return usageTracker.getDescribed();
  } catch (e) {
    console.error(`${LOG_PREFIX} usage snapshot failed:`, e && e.message);
    return null;
  }
}

// 公式 usage API のプロバイダ（issue #73）。60 秒 TTL キャッシュを内包し、renderer の
// ポーリング（設定モーダルの使用状況ビュー・歯車バッジ）やモバイルページの /api/states
// ポーリングが重なっても API / Keychain への問い合わせは 60 秒に 1 回に抑えられる。
const oauthUsage = createOauthUsageProvider();
const codexUsage = createCodexUsageProvider();
const codexUsageTracker = createCodexUsageTracker();

// 使用状況の統一構造を返す（issue #73）。
//   - 公式 usage API（source: 'oauth'、session / weekly の % とリセット時刻）を主とする。
//   - 取得不可（未ログイン・期限切れ・オフライン・Keychain 拒否・API 変更等）のときは
//     既存のトランスクリプト集計（source: 'transcript'、describeUsage の整形済み値）へ
//     フォールバックする。どちらも無ければ null。
//   - opt-out 設定 showUsage=false のときは常に null。
async function getUsageUnified() {
  if (!usageEnabled()) return null;
  try {
    const oauth = await oauthUsage.get();
    if (oauth) return oauth;
  } catch (e) {
    // oauthUsage 側で握りつぶしているため通常ここには来ないが、念のための保険。
    // トークン等の秘匿情報はエラーメッセージに含まれない設計（oauthUsage.js 参照）。
    console.error(`${LOG_PREFIX} oauth usage failed:`, e && e.message);
  }
  return getUsageForDisplay();
}

async function getCodexUsageUnified() {
  if (!codexUsageEnabled()) return null;
  let limits = null;
  try {
    limits = await codexUsage.get();
  } catch (e) {
    console.error(`${LOG_PREFIX} codex usage failed:`, e && e.message);
  }

  let tokens = null;
  try {
    tokens = codexUsageTracker.getDescribed();
  } catch (e) {
    console.error(`${LOG_PREFIX} codex token usage failed:`, e && e.message);
  }

  if (!limits && !tokens) {
    return {
      source: 'codex',
      session: null,
      weekly: null,
      tokens: null,
      fetchedAtMs: Date.now(),
      empty: true,
    };
  }
  return {
    source: 'codex',
    session: limits && limits.session ? limits.session : null,
    weekly: limits && limits.weekly ? limits.weekly : null,
    stale: limits && limits.stale === true ? true : undefined,
    fetchedAtMs: limits && Number.isFinite(limits.fetchedAtMs)
      ? limits.fetchedAtMs
      : (tokens && tokens.fetchedAtMs) || Date.now(),
    tokens,
  };
}

/**
 * semver文字列を比較する（v接頭辞あり/なし両対応）
 * @param {string} a
 * @param {string} b
 * @returns {number} a > b なら正、a < b なら負、同じなら0
 */
function compareSemver(a, b) {
  const normalize = (v) => v.replace(/^v/, '').split('.').map(Number);
  const [aMajor, aMinor, aPatch] = normalize(a);
  const [bMajor, bMinor, bPatch] = normalize(b);
  return (aMajor - bMajor) || (aMinor - bMinor) || (aPatch - bPatch);
}

/** すべての PTY プロセスを終了する */
function cleanupPtys() {
  for (const [, p] of ptys) {
    try { p.kill(); } catch (e) {}
  }
}

/**
 * 起動時に新バージョンがあるか確認し、あれば git pull して再起動を促す
 */
async function checkAndUpdate() {
  const appDir = __dirname;
  const opts = { cwd: appDir };
  try {
    await execFileAsync('git', ['fetch', '--tags'], { ...opts, timeout: 10000 });

    // リモートタグのみを取得して最新バージョンを確認する（ローカル専用タグを除外）
    const { stdout: lsRemoteOut } = await execFileAsync(
      'git', ['ls-remote', '--tags', 'origin'], { ...opts, timeout: 10000 }
    );
    // `v` プレフィックスは任意。リリースタグは v なし（例: 1.4.1）と v あり（例: v1.1.0）が
    // 混在しているため、両形式を拾う。バージョン比較は compareSemver が `v` を除去して行う。
    const latestTag = lsRemoteOut
      .split('\n')
      .map((l) => l.match(/refs\/tags\/(v?\d+\.\d+\.\d+)$/)?.[1])
      .filter(Boolean)
      .sort((a, b) => compareSemver(b, a))[0];

    if (!latestTag) return;

    // package.json の version をバージョンの正とする
    const pkg = require('./package.json');
    const currentTag = `v${pkg.version}`;

    if (compareSemver(latestTag, currentTag) <= 0) return;

    // 作業ツリーが汚れていれば pull をスキップ
    const { stdout: statusOut } = await execFileAsync(
      'git', ['status', '--porcelain'], opts
    );
    if (statusOut.trim().length > 0) {
      console.warn(`${LOG_PREFIX} Working tree is dirty, skipping pull.`);
      return;
    }

    // fast-forward のみで git pull（マージコミットを防ぐ）
    await execFileAsync('git', ['pull', '--ff-only'], { ...opts, timeout: 30000 });

    const { response } = await dialog.showMessageBox({
      type: 'info',
      title: 'アップデート完了',
      message: `VK Terminals を ${currentTag} → ${latestTag} に更新しました。`,
      detail: '変更を反映するにはアプリを再起動してください。',
      buttons: ['今すぐ再起動', 'あとで'],
      defaultId: 0,
    });

    if (response === 0) {
      // app.exit(0) は通常の終了フックを通らないため、PTY を明示的にクリーンアップする
      cleanupPtys();
      app.relaunch();
      app.exit(0);
    }
  } catch (e) {
    // ネットワーク不通などは無視
    console.error(`${LOG_PREFIX} Update check failed:`, e.message);
  }
}

// ─── renderer 起動時リソースの解決（issue #268 → #323） ───────────────────────
// xterm 実体の絶対パス・xterm.css の中身・エージェントルームのスプライト SVG は、
// 以前は preload.js が fs / require.resolve で直接解決していた。sandbox: true では
// preload から Node のファイル読み取りが使えなくなるため、この解決は main プロセス側で
// 行い、renderer へは IPC（invoke）で渡す（ipcMain.handle('app:get-xterm-resources') /
// ('app:get-agent-room-sprites')。呼び出し元は renderer/bootstrap.js）。

// require.resolve で絶対パスを取り、file:// URL にして renderer へ渡す。
// renderer からは相対パスで辿れない（vk-terminals が npm 依存として上位の
// node_modules へホイストされた構成だと 404 になる）ため、解決はここで行う。
function resolveScriptUrl(request) {
  try {
    return pathToFileURL(require.resolve(request)).href;
  } catch (e) {
    console.error(`${LOG_PREFIX} failed to resolve ${request}`, e);
    return '';
  }
}

function readXtermCss() {
  try {
    return fs.readFileSync(require.resolve('@xterm/xterm/css/xterm.css'), 'utf8');
  } catch (e) {
    // 読み込み失敗時もアプリ自体は起動させる（従来の <link> 404 と同等の状態に留める）。
    console.error(`${LOG_PREFIX} xterm.css の読み込みに失敗しました`, e);
    return '';
  }
}

// エージェントルーム（issue #58）のドット絵スプライト。renderer/sprites/*.svg は
// アプリ同梱の静的ファイルだが、renderer からは fs で読めないのでここで読んで渡す。
// 読めなかったものは載せない（renderer/agentRoom.js が手続き生成へフォールバックする）。
function readAgentRoomSprites() {
  const dir = path.join(__dirname, 'renderer', 'sprites');
  const sprites = {};
  let files = [];
  try {
    files = fs.readdirSync(dir);
  } catch (_e) {
    return sprites;
  }
  for (const file of files) {
    if (!file.endsWith('.svg')) continue;
    try {
      sprites[file] = fs.readFileSync(path.join(dir, file), 'utf8');
    } catch (_e) { /* 読めないものは黙って落とす */ }
  }
  return sprites;
}

// renderer/bootstrap.js が起動時に await して使う。読み込み順は bootstrap.js 側が保証する
//（xterm → addon-fit → xterm.css → app.js）。
ipcMain.handle('app:get-xterm-resources', () => ({
  scriptUrls: [
    resolveScriptUrl('@xterm/xterm/lib/xterm.js'),
    resolveScriptUrl('@xterm/addon-fit/lib/addon-fit.js'),
  ].filter(Boolean),
  css: readXtermCss(),
}));

ipcMain.handle('app:get-agent-room-sprites', () => readAgentRoomSprites());

function createWindow() {
  const { workAreaSize } = screen.getPrimaryDisplay();
  const winW = Math.min(1400, workAreaSize.width);
  const winH = Math.min(900, workAreaSize.height);
  const x = Math.round((workAreaSize.width - winW) / 2);
  const y = Math.round((workAreaSize.height - winH) / 2);

  // e2e（Playwright）実行時はウィンドウを画面に表示しないことで、実行中に OS のフォーカスを
  // 奪って PC 操作を妨げないようにする。Playwright は CDP 経由で操作するため OS 上の表示は不要。
  // ただし描画/スクリーンショットに依存するテスト向けに VK_TERMINALS_E2E_SHOW=1 で表示に opt-out できる。
  // 通常起動（env 未設定）では従来どおり表示する。
  const showWindow = process.env.VK_TERMINALS_E2E === '1'
    ? process.env.VK_TERMINALS_E2E_SHOW === '1'
    : true;

  win = new BrowserWindow({
    width: winW,
    height: winH,
    x,
    y,
    show: showWindow,
    minWidth: 600,
    minHeight: 400,
    webPreferences: {
      // renderer から Node / Electron の API へ直接触らせない（issue #268）。
      // renderer が必要とする機能は preload.js が contextBridge で名前付き API として渡す。
      // 表示処理のどこか 1 箇所でエスケープが漏れても任意コード実行に至らないようにするため。
      nodeIntegration: false,
      contextIsolation: true,
      // sandbox は明示指定しない。Electron 20 以降の既定（true）のまま使う（issue #323）。
      // 以前は preload が fs / require.resolve で xterm 実体と xterm.css を直接解決して
      // おり、sandbox: true にすると preload から Node の require が使えず解決できなかった。
      // 現在はその解決を main プロセス側（本ファイルの ipcMain.handle('app:get-xterm-resources')
      // 等）へ移し、preload は IPC 経由で受け取るだけにしたため、sandbox を有効にできる。
      preload: path.join(__dirname, 'preload.js'),
      // clipboard 書き込み上限（issue #325）を preload へ渡す。sandbox: true の preload は
      // ローカルファイルの相対 require ができず utils/clipboardLimits.js を直接 require
      // できないため、Electron が公式に用意している「preload へ小さな値を渡す」仕組み
      // （additionalArguments。渡した文字列は renderer プロセスの process.argv 末尾に
      // 追加される）で渡す。preload 側はこれを process.argv から読み取る。
      additionalArguments: [`${CLIPBOARD_MAX_LENGTH_ARG_PREFIX}${MAX_CLIPBOARD_TEXT_LENGTH}`],
      // ウィンドウがオクルード（背面/最小化）状態になっても renderer のタイマーを
      // 間引かせない。スマホ等から監視している間 Mac 側ウィンドウは背面になりがちで、
      // 既定の backgroundThrottling: true だと状態レポート用 setInterval(2s) が約1分に1回まで
      // 間引かれ、cachedStates が古いまま固定 → モバイルページの同期が止まるため無効化する。
      backgroundThrottling: false,
    },
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 12 },
    backgroundColor: '#0d1117',
    title: APP_TITLE,
  });

  // ─── ナビゲーション封鎖（issue #268） ──────────────────────────────────────
  // preload は BrowserWindow ではなく webContents の属性なので、この webContents が
  // 読み込む「あらゆるドキュメント」で動く。つまり renderer にスクリプト実行を許して
  // しまうと、location.href = 'https://attacker.example/' の 1 行で攻撃者のオリジンの
  // ページに vkBridge がそのまま生える。許可リストで絞ってあるとはいえ IPC の窓口を
  // 攻撃者のサーバへ渡すことになり、任意のコードを継続的に流し込まれる状態になる。
  //
  // このアプリの renderer が別ドキュメントへ遷移する正当な理由は一つも無い
  // （画面はすべて renderer/index.html 内で組み立てる）。ページ起因の遷移と
  // 新規ウィンドウの生成はまとめて拒否し、上記の足がかりを潰す。
  // 外部リンクは shell.openExternal（ipcMain の 'shell:open-external'）へ寄せてあるので、
  // ここを塞いでも外部サイトを開く導線は壊れない。
  win.webContents.on('will-navigate', (event) => { event.preventDefault(); });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  win.webContents.on('did-finish-load', () => {
    pushMenuUpdate();
    pushWidgetUpdate();
  });
  win.loadFile('renderer/index.html');
  // win.webContents.openDevTools(); // uncomment to debug
}

app.whenReady().then(async () => {
  createWindow();
  startWidgetWatcher();
  await checkAndUpdate();
  startHttpApi();
  // 使用量スナップショットを起動時に温めておく（初回ポーリングで null が返るのを避ける）。
  if (usageEnabled()) usageTracker.warmup().catch(() => {});
  if (codexUsageEnabled()) Promise.all([codexUsage.get(), codexUsageTracker.warmup()]).catch(() => {});
});

app.on('window-all-closed', () => {
  cleanupPtys();
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  cleanupPtys();
  stopWidgetWatcher();
  try { fs.unlinkSync(STATE_FILE); } catch (e) {}
  if (httpServer) httpServer.close();
});

// renderer がエージェントルーム（issue #58）の有効/無効を知るための設定取得。
//   本来は config.json の `agentroom: true` のときだけ各ペイン下部にアコーディオンを
//   表示するが、issue #70 でエージェントルーム（β）を一旦無効化するため、config.json の
//   値によらず agentroom は常に false を返す。復帰時は agentroom の返却値だけ
//   `config.agentroom === true` に戻せばよい。
ipcMain.handle('app:get-config', () => {
  const config = loadUserConfig();
  // waitingExcludeCwdPatterns は設定 GUI には出さず、config.json 直編集専用にする（#192）。
  // 読み込み・除外判定の機能は維持し、GUI 項目だけ settings-schema.json から削除した。
  const waitingExcludeCwdPatterns = Array.isArray(config.waitingExcludeCwdPatterns)
    ? config.waitingExcludeCwdPatterns.filter((pattern) => typeof pattern === 'string')
    : [];
  const widgetFile = normalizeTasksWidgetFile(config);
  const tasksFile = normalizeTasksFile(config);
  const commandsFile = normalizeCommandsFile(config);
  return {
    agentroom: false,
    appTitle: APP_TITLE,
    newPaneStartupDir: typeof config.newPaneStartupDir === 'string' ? config.newPaneStartupDir.trim() : '',
    newPaneAutoLaunchClaude: config.newPaneAutoLaunchClaude === true,
    // ペインを閉じる時の確認（issue #184）。不正値・未指定は既定 'busy' に正規化して渡す。
    confirmClose: normalizeConfirmClose(config.confirmClose),
    // ペイン内 URL のクリック挙動（issue #385）。不正値・未指定は既定 'click' に正規化して渡す。
    terminalLinkClickMode: normalizeTerminalLinkClickMode(config.terminalLinkClickMode),
    waitingExcludeCwdPatterns,
    widgetFile,
    // tasksFile（旧 tasks-view.json）は dual-write 期間の後方互換注記判定に残す。
    tasksFile,
    commandsFile,
  };
});

// 宣言的ウィジェットのコマンド中継（汎用）。renderer は宣言に載っていたコマンド断片
// { action, taskId, to, expected } をそのまま渡し、main が検証・id/requestedAt 付与・追記する。
ipcMain.handle('widgets:command', async (_event, fragment) => {
  return submitWidgetCommand(fragment);
});

// 使用状況の取得（issue #69 → #73 で公式 API 主・トランスクリプト従の統一構造に変更）。
// renderer（設定モーダルの使用状況ビュー: 表示中のみ初回即時＋60秒間隔 / 歯車の警告
// ドットバッジ: 60秒間隔）がポーリングする。main 側 60 秒 TTL キャッシュに相乗りするため
// 実際の API 問い合わせは増えない。無効時・データ無し・失敗時は null。
ipcMain.handle('usage:get', () => getUsageUnified());
ipcMain.handle('codex-usage:get', () => getCodexUsageUnified());

// ─── 設定パネル（汎用）────────────────────────────────────────────────────────
// 呼び出し側（例: vk-orchestrator）が環境変数 VK_TERMINALS_SETTINGS に「設定ディスク
// リプタ JSON」のパスを渡すと、renderer の設定パネルからそのディスクリプタが指す
// config ファイルを GUI 上で編集・保存できる。vk-terminals 自身は特定ツールの設定
// 内容を知らず、ディスクリプタ（項目スキーマ + targetPath）に従って読み書きするだけの
// 汎用実装にすることで、スタンドアロン利用時は影響を受けない（env 未指定なら
// settings:describe が available:false を返し、ボタンごと非表示になる）。
function settingsDescriptorPath() {
  const p = process.env.VK_TERMINALS_SETTINGS;
  return p && p.trim() ? p : null;
}

// 組み込みディスクリプタが編集する「vk-terminals 自身の config.json」のパスを解決する。
// loadUserConfig() の読み込み順に合わせ、既存の候補があればそれを、無ければ appDir 直下
// （README の `cp config.example.json config.json` の既定先）を対象にする。
function resolveOwnConfigTargetPath() {
  const candidates = [
    path.join(DATA_DIR, 'config.json'),
    path.join(__dirname, 'config.json'),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return path.join(__dirname, 'config.json');
}

// アクセストークン専用のパス解決（issue #313）。loadUserConfig() と探索順を完全に
// 一致させる（userConfigCandidatePaths() を共有）ことで、次の 2 つの事故を防ぐ。
//   - 中-1: 既存の設定ファイルがあればそこへトークンを書き込む。resolveOwnConfigTargetPath()
//     は候補が 2 つしか無いため、利用者が後から ~/.vk-terminals/config.json を作ると
//     保存先が切り替わり、新しいトークンが生成されて登録済み端末が全部無効になりうる。
//   - 中-2: どの候補も存在しない場合のフォールバックを {appDir}/config.json ではなく
//     README の記述どおり DATA_DIR/config.json（~/.vk-terminals/config.json）にする。
//     {appDir} が書き込めないパッケージ化環境で毎起動トークンが変わる事故も防ぐ。
// 設定パネルの保存経路が使う resolveOwnConfigTargetPath() 自体は変更しない
// （このトークン専用の解決とは独立させ、既存の保存挙動に影響させないため）。
//
// 【既知の残存リスク（PR #315 安藤のセキュリティレビュー指摘・コメントのみ対応）】
// この 2 つの解決は候補リストが非対称（こちらは後方互換の
// ~/.claude/terminals-config.json も候補に含むが、resolveOwnConfigTargetPath() は
// 含まない）。そのため、レガシーファイルだけが存在する環境で設定パネルから保存すると
// {appDir}/config.json が新規作成され、次回起動時の resolveTokenConfigPath() は
// 優先順位（DATA_DIR → appDir → legacy）どおりその新しい {appDir}/config.json を
// 選ぶ。そこには apiToken が無いため ensureApiToken() が新トークンを発行し、
// 登録済みの端末が全部無効になる（個別無効化はできない仕様なので再登録が必要になる）。
// 影響は可用性（再登録の手間）のみでトークン漏えい等のセキュリティ上の実害はなく、
// レガシーパスだけが存在する状態自体がまれなため、今回は解決の対称化はスコープ外と
// している（対称化すると resolveOwnConfigTargetPath() 側の既存の保存挙動を変えてしまう）。
function resolveTokenConfigPath() {
  const candidates = userConfigCandidatePaths();
  for (const configPath of candidates) {
    if (fs.existsSync(configPath)) return configPath;
  }
  return path.join(DATA_DIR, 'config.json');
}

// アクセストークン（issue #313）を config.json の apiToken へ書き込む。
// 既存の atomicWriteJsonFile（settingsTargets.js）は「既存ファイルの権限を引き継ぐ」
// 実装のため、既に緩い権限（例: 0644）で config.json が存在する環境だとトークンが
// そのまま緩い権限で保存されてしまう。トークンはパスワード相当の秘密情報のため、
// この書き込み経路だけは既存権限を無視し、明示的に 0600（所有者のみ読み書き可）を
// 強制する。一時ファイルは flag: 'wx'（既存なら失敗）で作成し、失敗時は
// atomicWriteJsonFile（settingsTargets.js）と同様に unlink して残骸を残さない。
// @param {string} token 書き込むアクセストークン
// @returns {boolean} 書き込みに成功したか
function persistApiToken(token) {
  const targetPath = resolveTokenConfigPath();
  const dir = path.dirname(targetPath);
  const tmpPath = path.join(dir, `.${path.basename(targetPath)}.${process.pid}.${Date.now()}.token.tmp`);
  try {
    const config = readJsonObject(targetPath);
    config.apiToken = token;
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(tmpPath, JSON.stringify(config, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
    fs.chmodSync(tmpPath, 0o600); // umask の影響を受けないよう明示的に付け直す
    fs.renameSync(tmpPath, targetPath);
    fs.chmodSync(targetPath, 0o600); // rename 後の最終ファイルにも念のため明示適用
    return true;
  } catch (e) {
    console.error(`${LOG_PREFIX} Failed to persist API token: ${targetPath}`, e);
    try {
      if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
    } catch (_cleanupError) {
      // 元の保存エラーを優先し、後始末の失敗は握りつぶす。
    }
    return false;
  }
}

// 起動時にアクセストークンを確保する。既に config.json に apiToken があり、かつ
// generateApiToken() の出力形式（16進64文字）に一致すればそれを使い続け（再起動の
// たびに変わると登録済み端末が全部使えなくなるため）、無ければ新規生成して保存する。
// 形式が不正な値（利用者が手で短い文字列に書き換えた場合等）を検出したときは、
// 総当たりで突破されうる弱いトークンをそのまま使わず、警告したうえで再発行する
// （issue #313 レビュー対応・中-4）。
// @returns {{ token: string, persisted: boolean }} persisted は「今回・過去いずれかの
//   保存に成功しているか」（既存トークンの読み込みは常に persisted:true 扱い）
function ensureApiToken() {
  const targetPath = resolveTokenConfigPath();
  let existing = '';
  try {
    const config = readJsonObject(targetPath);
    if (typeof config.apiToken === 'string' && config.apiToken.trim()) {
      existing = config.apiToken.trim();
    }
  } catch (e) {
    console.error(`${LOG_PREFIX} Failed to read existing API token: ${targetPath}`, e);
  }
  if (existing) {
    if (isValidApiTokenFormat(existing)) return { token: existing, persisted: true };
    console.warn(`${LOG_PREFIX} apiToken in ${targetPath} does not match the generated format (16進64文字); it was likely edited by hand into a weak value. Re-issuing a new token.`);
    // 形式不正の再発行はここで即座に持続化する（既存の弱いトークンを一瞬でも
    // 有効なままにしないため）。
    const replacement = generateApiToken();
    const persisted = persistApiToken(replacement);
    return { token: replacement, persisted };
  }

  const token = generateApiToken();
  const persisted = persistApiToken(token);
  return { token, persisted };
}

// env 未指定（スタンドアロン起動）時に使う組み込みディスクリプタ。静的な項目定義は
// settings-schema.json に置き、実行時に決まる targetPath だけをここで合成する。
function builtinSettingsDescriptor() {
  return buildBuiltinSettingsDescriptor({
    targetPath: resolveOwnConfigTargetPath(),
    onError: (error, schemaPath) => {
      console.error(`${LOG_PREFIX} Failed to load built-in settings schema: ${schemaPath}`, error);
    },
  });
}

// ディスクリプタを解決する。env VK_TERMINALS_SETTINGS が指す有効なディスクリプタが
// あればそれを優先し（vk-orchestrator など呼び出し側の設定を編集）、無い／不正な場合は
// 組み込みディスクリプタ（vk-terminals 自身の config.json を編集）にフォールバックする。
// これにより単体起動でも常に設定パネルを表示できる。
function loadSettingsDescriptor() {
  const p = settingsDescriptorPath();
  if (p && fs.existsSync(p)) {
    try {
      const d = JSON.parse(fs.readFileSync(p, 'utf8'));
      if (isValidSettingsDescriptor(d)) {
        return d;
      }
      console.error(`${LOG_PREFIX} Invalid settings descriptor (unresolved targetPath / duplicate or unsafe key): ${p}`);
    } catch (e) {
      console.error(`${LOG_PREFIX} Failed to parse settings descriptor: ${p}`, e);
    }
    // env 指定が不正でも、単体編集用の組み込みディスクリプタにフォールバックする。
  }
  return builtinSettingsDescriptor();
}

// renderer 用: ディスクリプタと targetPath の現在値を返す。VK_TERMINALS_SETTINGS が
// 未設定なら available:false（renderer 側は設定ボタンを表示しない）。
ipcMain.handle('settings:describe', () => {
  const descriptor = loadSettingsDescriptor();
  if (!descriptor) return { available: false };

  const values = describeSettingsValues(descriptor, {
    onReadError: (targetPath, e) => {
      console.error(`${LOG_PREFIX} Failed to read target config: ${targetPath}`, e);
    },
  });
  const targetInfo = describeTargetPaths(descriptor);
  const groups = descriptor.groups.map((group, index) => ({
    ...group,
    targetPaths: targetInfo.groupTargets[index] || [],
  }));
  return {
    available: true,
    title: descriptor.title || '設定',
    note: descriptor.note || '',
    tabs: Array.isArray(descriptor.tabs) ? descriptor.tabs : [],
    targetPath: targetInfo.targetPath,
    groups,
    values,
    appVersion: require('./package.json').version,
    apiServerStatus: describeApiServerRuntimeStatus(),
    // アクセストークンの永続化に失敗しているか（issue #313）。トークン本体は含めず
    // 真偽値だけを渡すため、パネルを開いた時点（「表示」を押す前）でも警告を出せる。
    apiTokenPersisted,
    targetPaths: targetInfo.allTargets,
    hasMultipleTargets: targetInfo.hasMultipleTargets,
  };
});

// 起動直後、API サーバーがまだ確定していない間だけ renderer が状態を取り直すための
// 軽量経路。静的な設定ディスクリプタ全体は再構築せず、状態スナップショットだけを返す。
ipcMain.handle('settings:api-server-status', () => describeApiServerRuntimeStatus());

// renderer からの保存。ディスクリプタに載っているキーだけを型変換して書き戻す
// （未知のキーは既存 config から保持する。書き込み先は field/group/descriptor の targetPath）。
ipcMain.handle('settings:save', (event, incoming) => {
  const descriptor = loadSettingsDescriptor();
  if (!descriptor) return { ok: false, error: '設定ディスクリプタが見つかりません' };

  return saveSettingsToTargets(descriptor, incoming);
});

// 設定コンテンツテーブルの savedValue セル（issue #380）用。キーの配列を 1 回で受け、
// 「設定ファイルに実際に保存されている値」をキーごとにまとめて返す（バッチ IPC）。
// 表の行数だけ IPC を往復させると、行の多い表でメインプロセス（pty・HTTP API も
// 同じスレッドで抱えている）が同期 I/O の直列実行で固まるため、1 回の呼び出しに
// まとめている（安藤のセキュリティレビュー指摘・issue #380）。読めるキーの許可判定
// （groups[].fields[].key として宣言されているか・危険なキーセグメントを含まないか・
// password 型でないか）と targetPath ごとの読み込みキャッシュは resolveSavedFieldValues
// （settingsTargets.js）に集約してある（VK_TERMINALS_SETTINGS は外部から差し替えられる
// 信頼できない入力のため、任意のキー・任意のパスを読み出せる窓口にしないための必須要件）。
ipcMain.handle('settings:content-table-saved-value', (_event, keys) => {
  const descriptor = loadSettingsDescriptor();
  if (!descriptor) {
    const error = '設定ディスクリプタが見つかりません';
    const result = Object.create(null);
    (Array.isArray(keys) ? keys : []).forEach((key) => {
      if (typeof key === 'string') result[key] = { ok: false, error };
    });
    return result;
  }
  return resolveSavedFieldValues(descriptor, keys);
});

// ─── アクセストークン（issue #313）: 設定パネルからの表示・再発行 ─────────────
// トークン自体は apiToken フィールドとして settings-schema.json の group/field には
// 載せない（generic な field 保存経路に乗せると、マスク表示中の値をそのまま
// settings:save で書き戻して破壊する事故になりうるため）。表示・再発行専用の
// IPC を用意し、renderer 側は必要になった時だけ呼ぶ（既定で伏せておくため）。

// 現在の待ち受けアドレスを元に、スマホの初回登録用 URL のベースを組み立てる。
// 実際に bind できたアドレス（apiServerRuntimeStatus.actualHost）を優先し、
// 未確定なら設定値、それも無ければ 127.0.0.1 にフォールバックする。
function currentApiBaseUrl() {
  const actualHost = apiServerRuntimeStatus && apiServerRuntimeStatus.actualHost;
  const host = (typeof actualHost === 'string' && actualHost) || normalizeApiHost(loadUserConfig().apiHost);
  return `http://${host}:${API_PORT}`;
}

// トークン込みの初回登録用 URL（GET /?token=... 形式）を返す。設定パネルの
// 「表示」「コピー」ボタン押下時にだけ呼ばれる想定（既定で伏せるため）。
// トークン本体は返さない。設定パネルはトークン単体を表示しなくなったため
// （手で curl を叩く場合は config.json の apiToken を直接参照する）。
ipcMain.handle('settings:api-token-info', () => ({
  persisted: apiTokenPersisted,
  registrationUrl: `${currentApiBaseUrl()}/?token=${encodeURIComponent(API_TOKEN)}`,
}));

// トークンを再発行する。登録済みの端末（Cookie）はすべて無効になる（個別無効化は
// できない仕様）。永続化に失敗した場合は既存トークンを維持したまま失敗を返す
// （再発行の失敗で現在使えている認証まで壊さないため）。
//
// 【既知の残存リスク（PR #315 再レビュー指摘・修正-5・コメントのみ対応）】
// persistApiToken() は対象ファイルを丸ごと読み → apiToken だけ書き換え → 丸ごと
// 書き戻す実装で、settings:save（設定パネルの保存）も同じファイルに対して同様の
// 読み→書きを行う。この 2 つの ipcMain.handle は同期処理で同一プロセス・同一
// スレッド上で完走するため、同一プロセス内では割り込まない（片方の途中でもう
// 片方が挟まることはない）。加えて saveSettingsToTargets は保存時に対象ファイルを
// 読み直す（settingsTargets.js の readJsonObject 経由）ため、再発行の直後に設定
// パネルの保存が走っても、保存処理は再発行済みの新トークンを読んだうえで書き戻す。
// 実際に上書きが起こりうるのは、同じ HOME で vk-terminals を 2 プロセス同時に
// 起動し、双方から同じファイルへほぼ同時に書き込んだ場合だけである（後から
// 書き込んだプロセスが先の変更を丸ごと上書きする）。ファイルロックや楽観的並行
// 制御を入れていないのは、影響が可用性（一方の変更が消える・再登録が要る）に
// とどまり、トークン漏えい等のセキュリティ上の実害が無いうえ、同じ HOME を複数
// プロセスで同時に使う運用自体がまれなため。今回のスコープでは対応しない。
ipcMain.handle('settings:reissue-api-token', () => {
  const newToken = generateApiToken();
  const persisted = persistApiToken(newToken);
  if (!persisted) {
    return {
      ok: false,
      error: 'トークンの保存に失敗しました（ディスク容量や権限をご確認ください）。既存のトークンは維持されています。',
      persisted: apiTokenPersisted,
    };
  }
  API_TOKEN = newToken;
  apiTokenPersisted = true;
  return {
    ok: true,
    persisted: apiTokenPersisted,
    registrationUrl: `${currentApiBaseUrl()}/?token=${encodeURIComponent(newToken)}`,
  };
});

// ─── renderer 向けの shell / clipboard 中継（issue #268） ─────────────────────
// renderer からは electron の shell / clipboard を直接触れない。preload が名前付き API
// として渡し、実行はこのプロセスで行う。

// 外部ブラウザで開く。preload 側でも同じ判定をしているが、最終防衛線はここ。
// renderer と preload が両方とも侵害された場合でも、http(s) 以外は開かない。
ipcMain.handle('shell:open-external', async (_event, url) => {
  if (!isSafeHttpUrl(url)) {
    console.warn(`${LOG_PREFIX} rejected openExternal for unsafe url`);
    return false;
  }
  try {
    await electronShell.openExternal(url);
    return true;
  } catch (e) {
    console.error(`${LOG_PREFIX} openExternal failed:`, e.message);
    return false;
  }
});

// 入力待ち検知時の通知音。引数を取らないので検証対象は無い。
ipcMain.on('shell:beep', () => {
  electronShell.beep();
});

// クリップボードへ書き込む上限（MAX_CLIPBOARD_TEXT_LENGTH はファイル冒頭で
// utils/clipboardLimits.js から require 済み・issue #325）。preload を経由しない
// 呼び出しでも青天井にならないようにする最終防衛線。

// 設定パネルのコピーボタン（issue #262 / #266）用。成否を boolean で返す。
ipcMain.handle('clipboard:write-text', (_event, text) => {
  if (typeof text !== 'string' || !text) return false;
  if (text.length > MAX_CLIPBOARD_TEXT_LENGTH) return false;
  try {
    clipboard.writeText(text);
    return true;
  } catch (e) {
    console.error(`${LOG_PREFIX} clipboard.writeText failed:`, e.message);
    return false;
  }
});

ipcMain.handle('terminal:create', (event, cwd, options = {}) => {
  const id = String(nextId++);
  const shell = process.env.SHELL || (process.platform === 'win32' ? (process.env.COMSPEC || 'powershell.exe') : '/bin/zsh');
  let resolvedCwd = cwd || process.env.HOME || process.env.USERPROFILE || os.tmpdir();
  try {
    if (!fs.existsSync(resolvedCwd) || !fs.statSync(resolvedCwd).isDirectory()) {
      resolvedCwd = process.env.HOME || process.env.USERPROFILE || os.tmpdir();
    }
  } catch (_e) {
    resolvedCwd = process.env.HOME || process.env.USERPROFILE || os.tmpdir();
  }

  // `options.noClaude` が明示指定されていればそれを優先、未指定なら CLI フラグの値を継承。
  // `noClaude` が true の場合、claude を自動起動せず素のシェルとして開く。
  const noClaude = typeof options.noClaude === 'boolean' ? options.noClaude : globalPlainMode;

  // `options.engine` の再検証（issue #367）。HTTP 受け口（/api/new-pane）でも検証済みだが、
  // ここでも isValidEngine が再検証する（model と同じ二重化構造・#310 の前例）。
  // 未指定・不正値では例外を投げず、従来どおりの 'claude' へ倒す（安全側の既定。
  // buildClaudeLaunchCommand のコメントと同じ考え方）。
  const resolvedEngine = isValidEngine(options.engine) ? options.engine : 'claude';

  const ptyProcess = pty.spawn(shell, [], {
    name: 'xterm-256color',
    cols: 80,
    rows: 24,
    cwd: resolvedCwd,
    env: { ...process.env, TERM_PROGRAM: 'VKTerminals' },
  });

  // ペイン作成（pty spawn）時刻。信頼確認プロンプトへの自動 Enter 送信を許可する
  // 時間窓（TRUST_WINDOW_MS。issue #371）の起点として utils/trustPromptGate.js へ渡す。
  // Date.now()（システム時刻）ではなく performance.now()（単調増加時計）を使う。
  // NTP のステップ補正・手動での時刻変更・VM のサスペンド復帰などでシステム時刻が
  // 巻き戻ると、Date.now() 基準では経過時間が負になり時間窓が開きっぱなしになる
  // 事故があるため（安藤の指摘・MEDIUM）。
  const spawnTime = performance.now();

  // initialCommand は最初の 1 ターミナルのみ送信
  const isFirstTerminal = !firstTerminalCreated;
  if (isFirstTerminal) firstTerminalCreated = true;

  let promptWatcher = null;
  let promptWatcherTimeoutId = null;

  // AI エンジンが入力受付状態になったことを検知するパターン。
  // resolvedEngine で分ける（安藤の指摘 LOW・対応8）: "OpenAI Codex" をエンジン問わず
  // 全ペインへ適用すると、Claude ペインの出力（会話文・ツール結果等）にたまたま
  // "OpenAI Codex" という文字列が含まれただけで ready と誤検知し、initialCommand が
  // 想定より早く送られてしまう。resolvedEngine ごとに別パターンを使うことで、
  // Claude ペインには従来どおり CLAUDE_READY_PATTERN だけを適用する。
  //
  // 三項演算子で分岐する（安藤の指摘 LOW・修正1）: 当初はオブジェクトマップ
  // （{ claude: ..., codex: ... }）で分けていたが、これは renderer/claudeModel.js の
  // ENGINE_LAUNCH_COMMANDS で今まさに塞いだのと同じ「素のオブジェクトリテラルへの
  // 変数添字アクセス」だった。resolvedEngine は isValidEngine 済みで到達不能とはいえ、
  // 仮に未検証の値が来ると Object.prototype 側のメンバー（関数）が返り、
  // READY_PATTERN.test(buffer) が ptyProcess.onData のたびに TypeError を投げる
  // （安藤の実測）。エンジンが 'claude' / 'codex' の2つしか無い現状では、素のオブジェクト
  // アクセスを経由しない三項演算子の方が安全かつ素直。3つ目以降のエンジンを足す際は
  // ここを見直すこと（未登録の engine は CLAUDE_READY_PATTERN へ倒れる＝安全側）。
  const CLAUDE_READY_PATTERN = /\?\s*for\s*shortcuts|\?\s*to\s*show\s*shortcuts|for\s*shortcuts|Welcome to Claude|Try\s*["']?\/help|Bypass(ing)?\s*Permissions|accept edits/i;
  // Codex（issue #367。codex-cli 0.147.0 実機確認）: 起動完了バナーに "OpenAI Codex" が
  // 出る。vk-orchestrator 側の CODEX_READY_PATTERN（setup-entry-autostart.js）と同じ
  // パターンを採用する。
  const CODEX_READY_PATTERN = /OpenAI Codex/i;
  const READY_PATTERN = resolvedEngine === 'codex' ? CODEX_READY_PATTERN : CLAUDE_READY_PATTERN;

  const WATCH_TIMEOUT_MS = 10000;

  // 素のターミナルモードでは claude を起動しないため、信頼確認や initialCommand の監視も不要
  if (!noClaude) {
    const config = isFirstTerminal ? loadUserConfig() : {};
    let sent = false;
    // 非 claude エンジンで initialCommand が設定されている場合、ready を検知できないまま
    // WATCH_TIMEOUT_MS の「警告のみ」タイマー（対応7）が発火すると、盲打ちフォールバックを
    // 行わない設計上 sent は永久に false のまま確定する。initialCommandPending の算出が
    // sent だけを見ていると「もう二度と送られない」ことを表現できず、promptWatcher が
    // 一生止まらなくなる（安藤の指摘・LOW）。警告のみで諦めたことを示すこのフラグを
    // 別に持ち、initialCommandPending の算出に加える。
    let initialCommandGaveUp = false;
    let buffer = '';

    // 信頼確認プロンプトへの自動 Enter 送信を許可する条件（ペイン作成からの経過時間が
    // TRUST_WINDOW_MS 以内、かつ ready 検知から READY_GRACE_MS 以内）を判定するゲート
    // （issue #371。utils/trustPromptGate.js）。時刻は呼び出し側（performance.now()）を
    // 都度渡し、内部では時刻を取得しない。時間窓・猶予は e2e から短縮できるよう
    // 環境変数（VK_TERMINALS_TRUST_WINDOW_MS / VK_TERMINALS_READY_GRACE_MS）で
    // 上書き可能にしている（モジュール冒頭の RESOLVED_TRUST_WINDOW_MS 等を参照）。
    const trustGate = createTrustPromptGate({
      spawnTime,
      trustWindowMs: RESOLVED_TRUST_WINDOW_MS,
      readyGraceMs: RESOLVED_READY_GRACE_MS,
    });

    // 自動応答の窓が閉じ（経過時間超過、または ready 検知から猶予超過）、かつ
    // initialCommand の送信ももう起こらない（送信済み・警告のみで諦めた・最初のペイン
    // でない・initialCommand 未設定のいずれか）場合、promptWatcher を無効化して
    // 以降の走査を止める。now は呼び出し側から渡す（未指定時のみ performance.now() を
    // 読む）。promptWatcher 内は既に読んだ now をそのまま渡すことで、1回の呼び出しで
    // 時刻を二重に読まないようにしている（安藤の指摘・LOW）。
    const stopWatchingIfDone = (now = performance.now()) => {
      const initialCommandPending = isFirstTerminal && !!config.initialCommand && !sent && !initialCommandGaveUp;
      if (trustGate.shouldStopWatching(now, { initialCommandPending })) {
        if (promptWatcherTimeoutId) {
          clearTimeout(promptWatcherTimeoutId);
          promptWatcherTimeoutId = null;
        }
        promptWatcher = null;
      }
    };

    const sendInitialCommand = (reason) => {
      if (sent || !config.initialCommand) return;
      sent = true;
      if (ptys.has(id)) {
        ptyProcess.write(config.initialCommand + '\r');
        console.log(`${LOG_PREFIX} initialCommand sent (${reason})`);
      }
      stopWatchingIfDone();
    };

    // タイムアウトによる initialCommand の盲打ちフォールバックは engine が 'claude' の
    // ときだけ行う（issue #367）。Codex 等は READY_PATTERN 検知（OpenAI Codex）でのみ
    // 送信し、起動途中に initialCommand を打ち込んでしまう事故を避ける。
    //
    // ただし claude 以外でも、タイムアウト自体（＝ここまで warn だけ出して盲打ちしない）
    // は残す（安藤の指摘 LOW・対応7）。盲打ちを完全に止めた結果、例えば codex が未
    // インストールで `command not found` になった場合など、initialCommand が永久に
    // 送られないケースで警告ログも一切出ないと、司や利用者が切り分けにくくなる。
    // 従来（claude 専用実装）は必ず warn が残っていたのと同じ可観測性を保つため、
    // 「送信はしない・警告だけ出す」タイマーを engine 問わず設定する。
    if (isFirstTerminal && config.initialCommand) {
      if (resolvedEngine === 'claude') {
        promptWatcherTimeoutId = setTimeout(() => {
          if (!sent) {
            console.warn(`${LOG_PREFIX} Claude ready prompt not detected within ${WATCH_TIMEOUT_MS}ms, sending initialCommand as fallback`);
            sendInitialCommand('timeout fallback');
          }
          stopWatchingIfDone();
        }, WATCH_TIMEOUT_MS);
      } else {
        promptWatcherTimeoutId = setTimeout(() => {
          if (!sent) {
            console.warn(`${LOG_PREFIX} ready prompt not detected within ${WATCH_TIMEOUT_MS}ms for engine '${resolvedEngine}'; initialCommand was not sent (blind fallback is disabled for non-claude engines)`);
            // 盲打ちを諦めた（＝以後 initialCommand が送られる見込みが無い）ことを記録する。
            initialCommandGaveUp = true;
          }
          stopWatchingIfDone();
        }, WATCH_TIMEOUT_MS);
      }
    }

    promptWatcher = (data) => {
      const stripped = stripAnsiForPattern(data);
      buffer = (buffer + stripped).slice(-4096);

      const now = performance.now();

      // 信頼確認プロンプト → Enter で承認（全ターミナル共通）。ただし自動応答の窓
      // （ペイン作成から TRUST_WINDOW_MS 以内 かつ ready 検知から READY_GRACE_MS 以内）の
      // 内側で、信頼確認の文脈があり、まだ発火していない場合のみ。文脈判定は
      // isTrustPrompt（issue #373）、時間・回数の判定は trustGate（issue #371）へ委譲する。
      if (isTrustPrompt(buffer) && trustGate.canAutoRespond(now)) {
        trustGate.markTrustHandled();
        buffer = '';
        console.log(`${LOG_PREFIX} trust prompt detected, sending Enter (terminal ${id})`);
        if (ptys.has(id)) {
          ptyProcess.write('\r');
        }
        // 信頼承認後はタイムアウトをリセット（initialCommand 待ち継続）。
        // ここも engine が 'claude' のときだけ盲打ちフォールバックを再設定する（issue #367）。
        // claude 以外は対応7と同じ理由で「送信はしない・警告だけ出す」タイマーを設定する。
        if (isFirstTerminal && config.initialCommand && !sent) {
          clearTimeout(promptWatcherTimeoutId);
          promptWatcherTimeoutId = null;
          if (resolvedEngine === 'claude') {
            promptWatcherTimeoutId = setTimeout(() => {
              if (!sent) {
                console.warn(`${LOG_PREFIX} Claude ready prompt not detected after trust confirmation, sending initialCommand as fallback`);
                sendInitialCommand('timeout fallback after trust');
              }
              stopWatchingIfDone();
            }, WATCH_TIMEOUT_MS);
          } else {
            promptWatcherTimeoutId = setTimeout(() => {
              if (!sent) {
                console.warn(`${LOG_PREFIX} ready prompt not detected after trust confirmation for engine '${resolvedEngine}'; initialCommand was not sent (blind fallback is disabled for non-claude engines)`);
                initialCommandGaveUp = true;
              }
              stopWatchingIfDone();
            }, WATCH_TIMEOUT_MS);
          }
        }
        stopWatchingIfDone(now);
        return;
      }

      // AI エンジンの起動完了検知（READY_PATTERN）は全ペインで行う（issue #371）。
      // 信頼確認は起動完了の直前後に出るため、ready を検知したら trustGate 側で
      // READY_GRACE_MS の猶予後に自動 Enter 送信を無効化する。ただし initialCommand の
      // 送信は従来どおり最初のペインのみに限定したまま（ここを崩すと別の回帰になる）。
      // 同一チャンクで READY_PATTERN.test(buffer) を2回評価しないよう、結果を変数へ
      // まとめて使い回す（安藤の指摘・LOW）。
      const ready = READY_PATTERN.test(buffer);
      if (ready) {
        trustGate.markReadyDetected(now);
      }

      // initialCommand 送信（最初のターミナルのみ）
      if (ready && isFirstTerminal && !sent) {
        clearTimeout(promptWatcherTimeoutId);
        promptWatcherTimeoutId = null;
        sendInitialCommand('ready detected');
      }

      stopWatchingIfDone(now);
    };
  }

  ptyProcess.onData((data) => {
    if (promptWatcher) promptWatcher(data);
    if (win && !win.isDestroyed()) {
      win.webContents.send('terminal:data', id, data);
    }
  });

  ptyProcess.onExit(() => {
    // ターミナル終了時に未発火のタイムアウトが残らないようクリアする
    if (promptWatcherTimeoutId) {
      clearTimeout(promptWatcherTimeoutId);
      promptWatcherTimeoutId = null;
    }
    ptys.delete(id);
    if (win && !win.isDestroyed()) {
      win.webContents.send('terminal:exit', id);
    }
  });

  ptys.set(id, ptyProcess);

  // 起動後に自動で AI エンジンを実行（素のターミナルモード時はスキップ）
  // resolvedEngine が 'claude'（省略時含む）なら従来どおり options.model が指定されて
  // いれば --model を付けて起動する（issue #310）。HTTP 受け口でも検証済みだが、
  // ここでも buildEngineAwareLaunchCommand（内部で buildClaudeLaunchCommand）が
  // 再検証する。未指定・不正値では素の `claude` になり、従来と完全に同一の文字列を
  // 書き込む＝既存の呼び出し元は非影響（issue #367）。
  //
  // Codex でも専用の許可リストで再検証し、正常値だけを --model として渡す。
  const { command: launchCommand, modelIgnored } = buildEngineAwareLaunchCommand(resolvedEngine, options.model);
  if (modelIgnored) {
    console.warn(`${LOG_PREFIX} model is ignored for engine '${resolvedEngine}'`);
  }
  if (!noClaude) {
    setTimeout(() => {
      if (ptys.has(id)) {
        ptyProcess.write(`${launchCommand}\r`);
      }
    }, 200);
  }

  return { id, cwd: resolvedCwd };
});

ipcMain.on('terminal:input', (event, id, data) => {
  const p = ptys.get(id);
  if (p) p.write(data);
});

ipcMain.on('terminal:resize', (event, id, cols, rows) => {
  const p = ptys.get(id);
  if (p) {
    try { p.resize(Math.max(2, cols), Math.max(2, rows)); } catch (e) {}
  }
});

ipcMain.on('terminal:kill', (event, id) => {
  const p = ptys.get(id);
  if (p) {
    try { p.kill(); } catch (e) {}
    ptys.delete(id);
  }
});

// renderer が新規ペインを作成し終えたら HTTP レスポンスを返す
ipcMain.on('terminal:new-pane-created', (event, payload = {}) => {
  const { requestId, ...result } = payload;
  if (!requestId) return;
  const resolve = pendingNewPaneCallbacks.get(requestId);
  if (!resolve) return;
  pendingNewPaneCallbacks.delete(requestId);
  resolve(result);
});

ipcMain.on('terminal:close-pane-done', (event, payload = {}) => {
  const { requestId, ...result } = payload;
  if (!requestId) return;
  const resolve = pendingClosePaneCallbacks.get(requestId);
  if (!resolve) return;
  pendingClosePaneCallbacks.delete(requestId);
  resolve(result);
});

/**
 * 指定された cwd で追加ペインを 1 枚作成する。
 * 内部的には renderer の splitPane を呼び出すのと同じ経路（pendingNewPaneCallbacks）を使う。
 * options.noClaude が true の場合、新ペインで claude を自動起動しない。
 */
function createAdditionalPane(cwd, options = {}) {
  return new Promise((resolve) => {
    if (!win || win.isDestroyed()) {
      resolve({ error: 'window not available' });
      return;
    }
    const requestId = String(nextNewPaneRequestId++);
    const timeoutId = setTimeout(() => {
      if (pendingNewPaneCallbacks.has(requestId)) {
        pendingNewPaneCallbacks.delete(requestId);
        resolve({ error: 'timeout waiting for new pane' });
      }
    }, 15000);
    pendingNewPaneCallbacks.set(requestId, (result) => {
      clearTimeout(timeoutId);
      resolve(result);
    });
    const payload = { requestId, cwd };
    if (typeof options.noClaude === 'boolean') payload.noClaude = options.noClaude;
    win.webContents.send('terminal:request-new-pane', payload);
  });
}

// renderer 初期化完了 → config.additionalPanes に従って追加ペインを順次作成
let additionalPanesCreated = false;
ipcMain.on('terminal:renderer-ready', async () => {
  pushMenuUpdate();
  pushWidgetUpdate();
  if (additionalPanesCreated) return; // closePane で最後のペインを閉じて再 initApp された場合は再生成しない
  additionalPanesCreated = true;
  const config = loadUserConfig();
  const panes = Array.isArray(config.additionalPanes) ? config.additionalPanes : [];
  for (const pane of panes) {
    if (!pane || typeof pane.cwd !== 'string' || !pane.cwd.trim()) continue;
    // pane.noClaude が指定されていれば優先、未指定なら CLI フラグの値を使う（terminal:create 側で解決）
    const paneOptions = typeof pane.noClaude === 'boolean' ? { noClaude: pane.noClaude } : {};
    const result = await createAdditionalPane(pane.cwd, paneOptions);
    if (result && result.error) {
      console.warn(`${LOG_PREFIX} additionalPane (${pane.cwd}) failed: ${result.error}`);
    }
  }
});

// ─── State reporting from renderer ───────────────────────────────────────────
// データディレクトリを確保
fs.mkdirSync(DATA_DIR, { recursive: true });

ipcMain.on('terminal:report-states', (event, states) => {
  cachedStates = states;
  // 状態ファイルに書き出し（非同期、エラーは無視）
  const payload = JSON.stringify({ updatedAt: new Date().toISOString(), terminals: states }, null, 2);
  fs.writeFile(STATE_FILE, payload, 'utf8', () => {});
});

// ─── HTTP API ────────────────────────────────────────────────────────────────
function startHttpApi() {
  const apiConfig = loadUserConfig();
  const apiHost = normalizeApiHost(apiConfig.apiHost);
  // 「認証を必ず要求する」設定（issue #313）。tailscale serve --bg のように apiHost が
  // 127.0.0.1 のまま外部（tailnet）へ公開されるケースに対応するためのオプトイン。
  // 他の設定同様「保存後、次回の起動から反映」なので、起動時に一度だけ読めばよい
  // （毎リクエストで config.json を同期読みするのを避ける）。
  const requireAuthAlways = !!apiConfig.apiRequireAuthAlways;

  // ブラウザ起点の cross-origin リクエストを弾く CSRF 対策。
  //   Origin ヘッダはブラウザが cross-origin の POST 等で必ず送る。同一オリジンの
  //   モバイルページや、curl 等の非ブラウザクライアント（Origin なし）は素通りさせ、
  //   悪意あるサイトから http://<apiHost>:13847/api/send への CSRF だけを拒否する。
  //   Host ヘッダ（apiHost が 127.0.0.1 でも Tailscale IP でも実際の接続先が入る）と
  //   Origin のホストを突き合わせ、不一致なら拒否。
  const isForbiddenOrigin = (req) => {
    const origin = req.headers.origin;
    if (!origin) return false; // 非ブラウザ or 同一オリジン GET 等 → 許可
    let originHost;
    try {
      originHost = new URL(origin).host;
    } catch (_e) {
      return true; // パース不能な Origin は拒否
    }
    return originHost !== req.headers.host;
  };

  // POST リクエスト body を読み取り、UTF-8 文字列にして onBody(body) を呼ぶ。
  //   - chunk は Buffer のまま貯めて最後に一度だけ decode する（日本語がチャンク境界で
  //     割れて文字化け→JSON 破損するのを防ぐ）。
  //   - サイズ制限はバイト数で判定し、超過したら 413 を返して破棄する（onBody は呼ばない）。
  const readJsonBody = (req, res, maxBytes, onBody) => {
    const chunks = [];
    let size = 0;
    let aborted = false;
    req.on('data', chunk => {
      if (aborted) return;
      size += chunk.length; // chunk は Buffer なので length はバイト数
      if (size > maxBytes) {
        aborted = true;
        res.writeHead(413, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'payload too large' }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (aborted) return;
      onBody(Buffer.concat(chunks).toString('utf8'));
    });
  };

  httpServer = http.createServer((req, res) => {
    const url = new URL(req.url, `http://127.0.0.1:${API_PORT}`);
    const authRequired = shouldRequireAuth({
      actualHost: apiServerRuntimeStatus.actualHost,
      requireAlways: requireAuthAlways,
    });

    // ─── Host 許可リストゲート（issue #322）──────────────────────────────────
    // DNS リバインディングで Origin と Host が攻撃者の名前のまま一致する経路を防ぐ。
    // 認証免除ルートや初回登録経路も含む全リクエストが入口のこの 1 か所を通るよう、
    // トークン登録の分岐と認証ゲートのどちらよりも前で確認する。許可リスト照合は
    // 認証不要な構成でのみ行い、認証必須なら Host の形式だけを検証して認証側で守る。
    if (!isAllowedApiHost({
      hostHeader: req.headers.host,
      apiHost,
      actualHost: apiServerRuntimeStatus.actualHost,
      authRequired,
    })) {
      console.warn(`${LOG_PREFIX} 403 ${req.method} ${url.pathname} from ${req.socket?.remoteAddress || 'unknown'} (forbidden host)`);
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'forbidden host' }));
      return;
    }

    // GET /?token=<トークン> または GET /index.html?token=<トークン>
    // （issue #313・スマホ初回登録経路）
    //   トークン付きの初回登録用 URL を開いたときだけの特別経路。以下の認証ゲートより
    //   前に分岐する必要がある（このリクエスト自体はまだ Cookie を持っていないため）。
    //   正しいトークンなら Cookie を発行し、トークンを取り除いた `/` へリダイレクトする
    //   （ブックマーク・履歴にトークンが残らないようにするため）。`/index.html` も
    //   同じ経路として扱わないと、そちらで開かれた場合に登録が成立せず、アドレスバーに
    //   トークンが残ったままになってしまう（PR #315 レビュー指摘）。
    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html') && url.searchParams.has('token')) {
      const providedToken = url.searchParams.get('token') || '';
      const registration = evaluateTokenRegistration(providedToken, API_TOKEN);
      if (registration.authorized) {
        res.setHeader('Set-Cookie', buildAuthCookieHeader(API_TOKEN));
        res.writeHead(302, { Location: registration.redirectLocation });
        res.end();
      } else {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'unauthorized' }));
      }
      return;
    }

    // ─── 認証ゲート（issue #313）───────────────────────────────────────────────
    //   全リクエストを対象に、入口のここ 1 か所だけで認証を確認する。ルートごとに
    //   同じチェックをコピーすると、新しい API を追加した時に入れ忘れる事故が起きる
    //   ため（既存の CSRF 対策 isForbiddenOrigin が実際にそうなっている）、認証は
    //   ここへ集約する。判定は「設定ファイルの値」ではなく「実際に待ち受けに成功した
    //   アドレス」（apiServerRuntimeStatus.actualHost）で行う（issue #313 必須条件）。
    //   isAuthExemptPath に載っている経路（GET /api/health と、ページ本体を構成する
    //   静的ファイル）は免除する。「免除はここだけ」という前提を isAuthExemptPath 側の
    //   1 か所（と対応するテスト）に集約しているため、ここでは分岐を増やさない。
    //   免除されたページ本体はこの後の通常ルーティングでそのまま配信されるが、
    //   データを返す /api/* はここで弾かれない限りすべて認証対象のまま。
    if (!isAuthExemptPath(req.method, url.pathname) && authRequired) {
      if (!isAuthorizedRequest(req, API_TOKEN)) {
        console.warn(`${LOG_PREFIX} 401 ${req.method} ${url.pathname} from ${req.socket?.remoteAddress || 'unknown'}`);
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'unauthorized' }));
        return;
      }
      // 認証成功のたびに Cookie の有効期限を付け直す（ローリング更新・365日）。
      // Cookie 経由（スマホのブラウザ）で通った場合だけ付け直す。Authorization ヘッダ
      // 経由（curl・オーケストレーター等）にまで Set-Cookie を返すと、レスポンスヘッダを
      // ログするツールにトークンが平文で残りうるため、Cookie 認証時に限定する。
      const { source } = extractTokenFromRequest(req);
      if (source === 'cookie') {
        res.setHeader('Set-Cookie', buildAuthCookieHeader(API_TOKEN));
      }
    }

    // GET /api/health
    if (req.method === 'GET' && url.pathname === '/api/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(buildHealthResponse(INSTANCE_ID)));
      return;
    }

    // GET /  — スマホ等から状態確認・応答するモバイルページ
    //   tailscale serve 等で 127.0.0.1:13847 を tailnet に公開して使う想定。
    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
      fs.readFile(path.join(__dirname, 'renderer', 'mobile.html'), (err, data) => {
        if (err) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'mobile page not found' }));
          return;
        }
        // CSP（issue #324）。mobile.html は HTTP 配信なので、renderer/index.html の
        // <meta> ではなく実際のレスポンスヘッダーで指定できる（本来こちらが正で、
        // <meta> では無視される frame-ancestors もここでは持たせられる）。
        // index.html 側の script-src も 'self' のみで追加許可は無く、この点は
        // 両者で違いは無い（mobile.js 等はこのサーバーが同一オリジンの絶対パスで
        // 配信するため、xterm 実体のような file:// 越しの読み込みが発生しない）。
        // connect-src だけは index.html の 'none' と異なり 'self' にしている:
        // mobile.js が /api/states・/api/widgets・/api/send 等へ同一オリジン fetch する
        // （ポーリング描画・ペイン操作の実体）ため、'none' にすると画面が壊れる。
        // 文字列の組み立ては utils/csp.js の buildMobileCsp() へ切り出し、単体テスト
        // （タイプミス・ディレクティブの脱落）と e2e（実レスポンスヘッダーの検証）の
        // 両方から固定している。
        res.writeHead(200, {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-store',
          'Content-Security-Policy': buildMobileCsp(),
        });
        res.end(data);
      });
      return;
    }

    // GET /mobile.css — mobile.html は静的ファイルサーバーではないため、
    // CSS を外部化したファイルも明示的に配信する。
    if (req.method === 'GET' && url.pathname === '/mobile.css') {
      fs.readFile(path.join(__dirname, 'renderer', 'mobile.css'), (err, data) => {
        if (err) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'mobile css not found' }));
          return;
        }
        res.writeHead(200, { 'Content-Type': 'text/css; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end(data);
      });
      return;
    }

    // GET /shared.css — mobile.html は静的ファイルサーバーではないため、
    // PC / モバイル共通 CSS も明示的に配信する。
    if (req.method === 'GET' && url.pathname === '/shared.css') {
      fs.readFile(path.join(__dirname, 'renderer', 'shared.css'), (err, data) => {
        if (err) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'shared css not found' }));
          return;
        }
        res.writeHead(200, { 'Content-Type': 'text/css; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end(data);
      });
      return;
    }

    // GET /widgetContract.js / /widgetView.js / 共有 UMD / /mobile.js — モバイルは静的ファイルサーバーではないため、
    // 宣言的ウィジェットの共有描画モジュール（PC 版と共通）とモバイル用 JS を明示的に配信する。
    if (req.method === 'GET' && (
      url.pathname === '/widgetContract.js'
      || url.pathname === '/widgetView.js'
      || url.pathname === '/terminalDisplay.js'
      || url.pathname === '/urlSafety.js'
      || url.pathname === '/prBadge.js'
      || url.pathname === '/statusPresentation.js'
      || url.pathname === '/mobilePreviewText.js'
      || url.pathname === '/mobile.js'
    )) {
      const fileMap = {
        '/widgetContract.js': path.join(__dirname, 'utils', 'widgetContract.js'),
        '/widgetView.js': path.join(__dirname, 'renderer', 'widgetView.js'),
        '/terminalDisplay.js': path.join(__dirname, 'renderer', 'terminalDisplay.js'),
        '/urlSafety.js': path.join(__dirname, 'renderer', 'urlSafety.js'),
        '/prBadge.js': path.join(__dirname, 'renderer', 'prBadge.js'),
        '/statusPresentation.js': path.join(__dirname, 'renderer', 'statusPresentation.js'),
        '/mobilePreviewText.js': path.join(__dirname, 'renderer', 'mobilePreviewText.js'),
        '/mobile.js': path.join(__dirname, 'renderer', 'mobile.js'),
      };
      fs.readFile(fileMap[url.pathname], (err, data) => {
        if (err) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'widget module not found' }));
          return;
        }
        res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end(data);
      });
      return;
    }

    // GET /api/states
    if (req.method === 'GET' && url.pathname === '/api/states') {
      // usage（issue #69）はモバイルページの既存ポーリングに相乗りで additive に追加する。
      // issue #73 で公式 API（source:'oauth'）主・トランスクリプト（source:'transcript'）従の
      // 統一構造になった。oauth 取得は非同期（main 側 60s TTL キャッシュ済み）のため、
      // ここだけ Promise を待ってからレスポンスする。失敗時は usage: null（後方互換）。
      //
      // codexUsage（issue #218）も同様に additive に追加する。PC 版サイドバーと同じ
      // getCodexUsageUnified() の統一構造を返し、モバイルでも Codex 使用量カードを描画する。
      // usage と並行取得（Promise.all）し、片方が失敗しても他方に影響させない。失敗時は
      // codexUsage: null（後方互換）。showCodexUsage=false のときは main 側で null が返る。
      Promise.all([
        Promise.resolve(getUsageUnified()).catch(() => null),
        Promise.resolve(getCodexUsageUnified()).catch(() => null),
      ]).then(([usage, codexUsage]) => {
        res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify({
          updatedAt: new Date().toISOString(),
          terminals: cachedStates,
          usage,
          codexUsage,
          version: require('./package.json').version,
          appTitle: APP_TITLE,
        }));
      });
      return;
    }

    // GET /api/widgets
    //   モバイルページ向けに宣言的ウィジェット（tasks-widget.json）の中継ペイロードを返す。
    //   ステータス遷移・ラベル・確認文言などの語彙は持たず、サニタイズ済みの宣言をそのまま返す。
    if (req.method === 'GET' && url.pathname === '/api/widgets') {
      const config = loadUserConfig();
      const filePath = normalizeTasksWidgetFile(config);
      let payload = widgetPayload;
      if (!payload || filePath !== widgetFilePath) {
        const widget = filePath ? readWidgetFromFile(filePath).widget : null;
        payload = buildWidgetPayload(widget);
      }
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(payload));
      return;
    }

    // POST /api/send  { termId: "1", input: "y" }
    if (req.method === 'POST' && url.pathname === '/api/send') {
      if (isForbiddenOrigin(req)) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'forbidden origin' }));
        return;
      }
      const MAX_BODY = 10 * 1024; // 10KB
      readJsonBody(req, res, MAX_BODY, (body) => {
        try {
          const { termId, input } = JSON.parse(body);
          if (!termId || typeof input !== 'string') {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'termId and input required' }));
            return;
          }
          const p = ptys.get(String(termId));
          if (!p) {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: `terminal ${termId} not found` }));
            return;
          }
          // 「本文 + 末尾 Enter」を 1 リクエストで受け取った場合は、本文と Enter を
          // 別々の write に分割して送る（まとめて送ると Claude Code が末尾 \r を
          // ペーストの改行として吸収し Enter 確定にならないため。SEND_ENTER_SPLIT_DELAY_MS 参照）。
          const trailingNewline = input.match(/[\r\n]+$/);
          const hasBodyBeforeNewline = trailingNewline && input.length > trailingNewline[0].length;
          if (hasBodyBeforeNewline) {
            const bodyPart = input.slice(0, input.length - trailingNewline[0].length);
            p.write(bodyPart);
            setTimeout(() => {
              // 待機中にターミナルが閉じられている可能性があるので存在を再確認する
              if (ptys.get(String(termId)) === p) {
                p.write(trailingNewline[0]);
              }
            }, SEND_ENTER_SPLIT_DELAY_MS);
          } else {
            p.write(input);
          }
          // renderer に通知（バッジ表示用）
          if (win && !win.isDestroyed()) {
            win.webContents.send('terminal:auto-input', termId);
          }
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, termId }));
        } catch (e) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'invalid JSON' }));
        }
      });
      return;
    }

    // POST /api/widgets/command  { action, taskId, to, expected }
    //   宣言に載っていたコマンド断片をそのまま受け取り、契約 allowlist で検証してから
    //   id / requestedAt を付与し commands.jsonl へ追記する（サイドバー IPC widgets:command と同経路）。
    if (req.method === 'POST' && url.pathname === '/api/widgets/command') {
      if (isForbiddenOrigin(req)) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'forbidden origin' }));
        return;
      }
      readJsonBody(req, res, 10 * 1024, async (body) => {
        let parsed;
        try {
          parsed = JSON.parse(body);
        } catch (_e) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'invalid JSON' }));
          return;
        }
        const result = await submitWidgetCommand(parsed);
        res.writeHead(widgetCommandHttpStatus(result), { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result.ok ? result : { ok: false, error: result.error }));
      });
      return;
    }

    // POST /api/set-title  { termId: "1", title: "タスク名", url?: "https://...", prUrl?: "https://...", prMerged?: true, waitingMerge?: true }
    //   — ペイン上部のタスクタイトル行に表示する文字列を設定。
    //   空文字や null を title に指定するとタイトル行を非表示に戻す。
    //   url を指定するとタイトル全体をリンク化（クリックで OS の既定ブラウザで開く）。
    //   url を省略すると URL なし扱い、空文字 "" を渡すと既存 URL をクリアする扱い。
    //   url は http(s): スキームのみ許可・new URL() で parse 可能・2048 文字以内の制約あり。
    //   title と url はペアで都度送る置換セマンティクス（patch ではない）。
    //   prUrl（issue #44）: タイトル右側の独立した [ PR ↗ ] ボタンに紐づける URL。
    //   省略 → PR ボタンなし扱い、空文字 "" → 既存 prUrl をクリア。
    //   バリデーションは url と同一規約（http(s):・2048 文字以内・new URL() parse 可）。
    //   prMerged: PR ボタンをマージ済み表示にする真偽値。厳密な true のみ true、それ以外は false。
    //   waitingMerge（issue #363）: PR ボタンをマージ待ち表示（青）にする真偽値。フィールド名は
    //   送信側（vk-orchestrator#389）の実装に合わせている（`prWaitingMerge` ではない）。
    //   prMerged と同じく厳密な true のみ true、それ以外（false・未指定・文字列 "true" 等）は false。
    //   prMerged と waitingMerge が同時に true で来た場合は prMerged を優先する
    //   （マージ済みが最終状態のため）。未指定が false に倒れることで、Orchestrator 経由でない
    //   ペイン・古い Orchestrator からのリクエストは「PR が出ただけ（灰）」表示になる（後方互換）。
    if (req.method === 'POST' && url.pathname === '/api/set-title') {
      if (isForbiddenOrigin(req)) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'forbidden origin' }));
        return;
      }
      const MAX_BODY = 10 * 1024;
      readJsonBody(req, res, MAX_BODY, (body) => {
        try {
          const parsed = JSON.parse(body);
          const termId = parsed?.termId != null ? String(parsed.termId) : '';
          if (!termId) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'termId required' }));
            return;
          }
          if (!ptys.has(termId)) {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: `terminal ${termId} not found` }));
            return;
          }
          const title = typeof parsed?.title === 'string' ? parsed.title : '';

          // url / prUrl の共通バリデーション。
          //   - フィールド未指定（undefined）→ 後方互換のため URL なし扱い（空文字を送る）
          //   - 空文字 "" / null → クリア扱い（renderer 側で対応フィールドをクリア）
          //   - それ以外 → 文字列必須、長さ 2048 以内、new URL() parse 必須、http(s): のみ
          //
          // フィールド名（'url' / 'prUrl'）はエラーメッセージにも反映するため引数で受け取る。
          // 戻り値:
          //   { ok: true, value: string } バリデーション成功（value はそのままレンダラに渡す文字列）
          //   { ok: false, error: string } バリデーション失敗（error は 400 で返すエラーメッセージ）
          //   { ok: true, missing: true } フィールド未指定（このときは value を使わない）
          const validateUrlField = (raw, fieldName) => {
            if (raw === '' || raw == null) {
              return { ok: true, value: '' };
            }
            if (typeof raw !== 'string') {
              return { ok: false, error: `${fieldName} must be a string` };
            }
            if (raw.length > 2048) {
              return { ok: false, error: `${fieldName} too long (max 2048 chars)` };
            }
            let parsedUrl;
            try {
              parsedUrl = new URL(raw);
            } catch (_e) {
              return { ok: false, error: `invalid ${fieldName}` };
            }
            if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
              return { ok: false, error: `${fieldName} must be http(s)` };
            }
            return { ok: true, value: raw };
          };

          let urlValue = '';
          if (parsed && Object.prototype.hasOwnProperty.call(parsed, 'url')) {
            const r = validateUrlField(parsed.url, 'url');
            if (!r.ok) {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: r.error }));
              return;
            }
            urlValue = r.value;
          }

          // prUrl（issue #44）: 独立した PR ボタン用 URL。url と同一規約。
          let prUrlValue = '';
          if (parsed && Object.prototype.hasOwnProperty.call(parsed, 'prUrl')) {
            const r = validateUrlField(parsed.prUrl, 'prUrl');
            if (!r.ok) {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: r.error }));
              return;
            }
            prUrlValue = r.value;
          }
          const prMergedValue = parseStrictBoolFlag(parsed?.prMerged);
          // waitingMerge（issue #363）: prMerged と同じく厳密な true のみ true。
          // 文字列 "true" や false・未指定はすべて false に倒す（後方互換の担保）。
          const waitingMergeValue = parseStrictBoolFlag(parsed?.waitingMerge);

          if (win && !win.isDestroyed()) {
            win.webContents.send('terminal:title', termId, title, urlValue, prUrlValue, prMergedValue, waitingMergeValue);
          }
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, termId, title, url: urlValue, prUrl: prUrlValue, prMerged: prMergedValue, waitingMerge: waitingMergeValue }));
        } catch (e) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'invalid JSON' }));
        }
      });
      return;
    }

    // POST /api/set-status  { termId: "1", waiting: true }
    //   — オーケストレーター等の外部権威が、そのペインの入力待ち状態を明示設定する。
    //   waiting: true で外部権威フラグを立て、waiting: false で解除する。
    //   ローカル PTY 検知とは別レイヤーとして renderer 側で OR 合流し、自動入力・再描画では解除しない。
    //   termId は必須、waiting は真偽値のみ許可する（文字列 "true" 等は 400）。
    if (req.method === 'POST' && url.pathname === '/api/set-status') {
      if (isForbiddenOrigin(req)) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'forbidden origin' }));
        return;
      }
      const MAX_BODY = 10 * 1024;
      readJsonBody(req, res, MAX_BODY, (body) => {
        try {
          const parsed = JSON.parse(body);
          const termId = parsed?.termId != null ? String(parsed.termId) : '';
          if (!termId) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'termId required' }));
            return;
          }
          if (!ptys.has(termId)) {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: `terminal ${termId} not found` }));
            return;
          }
          if (typeof parsed?.waiting !== 'boolean') {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'waiting must be a boolean' }));
            return;
          }
          const waiting = parsed.waiting;
          if (win && !win.isDestroyed()) {
            win.webContents.send('terminal:set-status', termId, waiting);
          }
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, termId, waiting }));
        } catch (e) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'invalid JSON' }));
        }
      });
      return;
    }

    // POST /api/set-lock  { termId: "1", lock: { close: false } }
    //   — オーケストレーター等の外部権威が、そのペインの操作ロック状態を明示設定する。
    //   lock.close === false のときだけ UI から閉じられない状態として扱う。
    //   lock: null または { close: true } は解除相当。将来 stash/move 等を足せる拡張形にする。
    if (req.method === 'POST' && url.pathname === '/api/set-lock') {
      if (isForbiddenOrigin(req)) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'forbidden origin' }));
        return;
      }
      if (!win || win.isDestroyed()) {
        res.writeHead(503, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'window not available' }));
        return;
      }
      readJsonBody(req, res, 10 * 1024, (body) => {
        try {
          const parsed = JSON.parse(body);
          const rawTermId = parsed?.termId;
          if (!rawTermId) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'termId required' }));
            return;
          }
          const termId = String(rawTermId);
          if (!ptys.has(termId)) {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: `terminal ${termId} not found` }));
            return;
          }

          const rawLock = parsed?.lock;
          let lock = null;
          if (rawLock === null) {
            lock = null;
          } else if (rawLock && typeof rawLock === 'object' && typeof rawLock.close === 'boolean') {
            lock = { close: rawLock.close };
          } else {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'lock must be null or an object with boolean close' }));
            return;
          }

          win.webContents.send('terminal:set-lock', termId, lock);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true }));
        } catch (e) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'invalid JSON' }));
        }
      });
      return;
    }

    // POST /api/agentroom  { termId: "1", agents?: {"和田":"working", ...}, agent?: "麗美", state?: "consulting" }
    //   — エージェントルーム（issue #58）の稼働状況を更新する。config.json の `agentroom: true` 時のみ表示に反映。
    //   `agents` オブジェクトを渡すとそのペインのルーム状態を丸ごと置換する（置換セマンティクス）。
    //   `agent` + `state` を渡すと該当 1 人だけ更新する（マージセマンティクス）。
    //   state の語彙: 'consulting'（相談中）/ 'working'（作業中）/ 'idle'（待機中）/ 'off'（離席）。
    //   agent は既知（司/和田/安藤/麗美/植草）のみ受理。state は表記ゆれ（日本語・大文字等）を
    //   canonical へ正規化し、いずれにも写像できない値（誤記等）は 400 で reject する。
    //   renderer へは正規化済みの canonical state を送る。
    if (req.method === 'POST' && url.pathname === '/api/agentroom') {
      if (isForbiddenOrigin(req)) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'forbidden origin' }));
        return;
      }
      const MAX_BODY = 10 * 1024;
      readJsonBody(req, res, MAX_BODY, (body) => {
        try {
          const parsed = JSON.parse(body);
          const termId = parsed?.termId != null ? String(parsed.termId) : '';
          if (!termId) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'termId required' }));
            return;
          }
          if (!ptys.has(termId)) {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: `terminal ${termId} not found` }));
            return;
          }

          // agent 名は既知（司/和田/安藤/麗美/植草、前後空白許容）のみ受理。
          // state は canonical（consulting/working/idle/off）へ正規化し、写像できなければ reject。
          // 正規化した値を renderer へ送ることで、未知 state が idle 扱いされて fallback を
          // 不本意に抑制する事故を防ぐ。

          // 1 人だけ更新（agent + state）。replace=false でマージ。
          if (typeof parsed?.agent === 'string') {
            if (!isKnownAgent(parsed.agent)) {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: `unknown agent "${parsed.agent}"` }));
              return;
            }
            const state = canonicalizeState(parsed.state);
            if (!state) {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: 'state must be one of consulting/working/idle/off' }));
              return;
            }
            const agents = { [parsed.agent.trim()]: state };
            if (win && !win.isDestroyed()) {
              win.webContents.send('terminal:agentroom', termId, agents, false);
            }
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: true, termId, agents, replace: false }));
            return;
          }

          // ルーム状態を丸ごと置換（agents オブジェクト）。
          const agentsRaw = parsed?.agents;
          if (agentsRaw == null || typeof agentsRaw !== 'object' || Array.isArray(agentsRaw)) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'agents object or agent+state required' }));
            return;
          }
          const agents = {};
          for (const [k, v] of Object.entries(agentsRaw)) {
            if (!isKnownAgent(k)) {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: `unknown agent "${k}"` }));
              return;
            }
            const state = canonicalizeState(v);
            if (!state) {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: `state for "${k}" must be one of consulting/working/idle/off` }));
              return;
            }
            agents[k.trim()] = state;
          }
          if (win && !win.isDestroyed()) {
            win.webContents.send('terminal:agentroom', termId, agents, true);
          }
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, termId, agents, replace: true }));
        } catch (e) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'invalid JSON' }));
        }
      });
      return;
    }

    // POST /api/menu  { source: "vk-orchestrator", title?: "...", items: [...] }
    //   — サイドバーメニューを source 単位で置換する。items: [] は該当 source のクリア。
    if (req.method === 'POST' && url.pathname === '/api/menu') {
      if (isForbiddenOrigin(req)) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'forbidden origin' }));
        return;
      }
      const MAX_BODY = 10 * 1024;
      readJsonBody(req, res, MAX_BODY, (body) => {
        try {
          const parsed = JSON.parse(body);
          const r = validateMenuSection(parsed);
          if (!r.ok) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: r.error }));
            return;
          }
          const { source, items } = r.section;
          if (items.length === 0) {
            menuSources.delete(source);
          } else {
            if (!menuSources.has(source) && menuSources.size >= MENU_MAX_SECTIONS) {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: `too many menu sources (max ${MENU_MAX_SECTIONS})` }));
              return;
            }
            menuSources.set(source, r.section);
          }
          pushMenuUpdate();
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, source }));
        } catch (e) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'invalid JSON' }));
        }
      });
      return;
    }

    // POST /api/new-pane  { cwd?: "/path/to/dir", noClaude?: boolean, engine?: "claude"|"codex", stashed?: boolean, model?: string } — 新規ペインを作成して termId を返す
    //   cwd を指定すればそのディレクトリで開く。未指定なら HOME で開く。
    //   noClaude: true を指定すると、新規ペインで claude を自動起動せず素のシェルとして開く。
    //   engine: 起動する AI エンジン（issue #367）。許可値は "claude" / "codex" のみ
    //     （許可リスト方式）。未指定なら従来どおり claude を起動する＝既存の呼び出し元は
    //     非影響。不正値（未対応の文字列・空文字・文字列以外）は 400 で拒否しペインを作らない。
    //   stashed: true を指定すると、サイドバー格納＋折りたたみ状態で開く。
    //   model を指定すると、そのモデルで選択エンジンを起動する（--model '<model>'）。
    //     許可するのは英数字・`.`・`_`・`-`・`[`・`]` のみ・64 文字以内で、先頭は英数字。
    //     それ以外は 400 で拒否しペインを作らない。未指定なら各エンジンを素のコマンドで起動する。
    if (req.method === 'POST' && url.pathname === '/api/new-pane') {
      if (isForbiddenOrigin(req)) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'forbidden origin' }));
        return;
      }
      if (!win || win.isDestroyed()) {
        res.writeHead(503, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'window not available' }));
        return;
      }
      const MAX_BODY = 10 * 1024;
      readJsonBody(req, res, MAX_BODY, (body) => {
        let requestedCwd = null;
        let requestedNoClaude;
        let requestedEngine;
        let requestedStashed;
        let requestedUseDefaults;
        let requestedModel;
        if (body.length > 0) {
          try {
            const parsed = JSON.parse(body);
            if (typeof parsed?.cwd === 'string' && parsed.cwd.trim()) {
              requestedCwd = parsed.cwd;
            }
            if (typeof parsed?.noClaude === 'boolean') {
              requestedNoClaude = parsed.noClaude;
            }
            // engine: 起動する AI エンジン（issue #367）。許可リスト方式で、
            // 'claude' / 'codex' 以外（未対応の文字列・空文字・文字列以外）は
            // ペインを作らず 400 で拒否する。将来エンジンを足すときは
            // renderer/claudeModel.js の ALLOWED_ENGINES 配列だけを直せば済む形。
            if (parsed?.engine !== undefined) {
              if (!isValidEngine(parsed.engine)) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'invalid engine (allowed: "claude", "codex")' }));
                return;
              }
              requestedEngine = parsed.engine;
            }
            if (typeof parsed?.stashed === 'boolean') {
              requestedStashed = parsed.stashed;
            }
            // useDefaults: true のときだけ、cwd/noClaude 省略時に renderer 側で
            // config 既定値（newPaneStartupDir / !newPaneAutoLaunchClaude）を補う。
            // モバイルの「ペインを追加」ボタン専用のオプトイン。他の呼び出し元
            // （orchestrator 等）は従来どおり passthrough される（issue #217）。
            if (typeof parsed?.useDefaults === 'boolean') {
              requestedUseDefaults = parsed.useDefaults;
            }
            // model: 起動する AI エンジンのモデル名（issue #310 / #374）。値はペインへ書き込む
            // 起動コマンドの一部になるため、許可リストを通らない値はペインを作らずに拒否する。
            // 省略時は従来どおり各エンジンを素のコマンドで起動する。エンジンごとに
            // 意味のある別名の検証関数を選び、許可文字種・長さを通った値だけを IPC へ渡す。
            // terminal:create 側のコマンドビルダーでも同じ検証を行う多層防御は維持する。
            if (parsed?.model !== undefined) {
              const effectiveEngine = requestedEngine || 'claude';
              if (!isValidModelForEngine(effectiveEngine, parsed.model)) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'invalid model' }));
                return;
              }
              requestedModel = parsed.model;
            }
          } catch {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'invalid JSON' }));
            return;
          }
        }
        const requestId = String(nextNewPaneRequestId++);
        const timeoutId = setTimeout(() => {
          if (pendingNewPaneCallbacks.has(requestId)) {
            pendingNewPaneCallbacks.delete(requestId);
            res.writeHead(504, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'timeout waiting for new pane' }));
          }
        }, 15000);
        const resolve = (result) => {
          clearTimeout(timeoutId);
          if (result.error) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: result.error }));
          } else {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: true, termId: result.termId }));
          }
        };
        pendingNewPaneCallbacks.set(requestId, resolve);
        const payload = { requestId, cwd: requestedCwd };
        if (typeof requestedNoClaude === 'boolean') payload.noClaude = requestedNoClaude;
        if (typeof requestedEngine === 'string') payload.engine = requestedEngine;
        if (typeof requestedStashed === 'boolean') payload.stashed = requestedStashed;
        if (requestedUseDefaults === true) payload.useDefaults = true;
        if (typeof requestedModel === 'string') payload.model = requestedModel;
        win.webContents.send('terminal:request-new-pane', payload);
      });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/close-pane') {
      if (isForbiddenOrigin(req)) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'forbidden origin' }));
        return;
      }
      if (!win || win.isDestroyed()) {
        res.writeHead(503, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'window not available' }));
        return;
      }
      readJsonBody(req, res, 10 * 1024, (body) => {
        let termId;
        try {
          const parsed = JSON.parse(body);
          termId = parsed?.termId;
        } catch {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'invalid JSON' }));
          return;
        }
        if (!termId) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'termId required' }));
          return;
        }
        if (!ptys.has(String(termId))) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'terminal ' + termId + ' not found' }));
          return;
        }
        const requestId = String(nextClosePaneRequestId++);
        const timeoutId = setTimeout(() => {
          if (pendingClosePaneCallbacks.has(requestId)) {
            pendingClosePaneCallbacks.delete(requestId);
            res.writeHead(504, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'timeout waiting for close pane' }));
          }
        }, 15000);
        const resolve = (result) => {
          clearTimeout(timeoutId);
          if (result.error) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: result.error }));
          } else {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: true, termId: result.termId }));
          }
        };
        pendingClosePaneCallbacks.set(requestId, resolve);
        win.webContents.send('terminal:request-close-pane', { requestId, termId: String(termId) });
      });
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'not found' }));
  });

  // バインド先ホスト。config.json の apiHost で変更可能（既定 127.0.0.1）。
  //   例: Tailscale IP（100.x.x.x）を指定すると tailnet 内からのみ到達可能になり、
  //   スマホ等から http://<apiHost>:13847/ で状態確認・応答できる（LAN/公開には出さない）。
  //   '0.0.0.0' を指定すると LAN を含む全 I/F で待ち受ける（信頼できる NW でのみ推奨）。
  apiServerRuntimeStatus = {
    phase: 'pending',
    startupHost: apiHost,
    actualHost: '',
    errorCode: '',
    fellBack: false,
  };

  let triedFallback = false;
  const listen = (host) => {
    httpServer.listen(API_PORT, host, () => {
      const address = httpServer.address();
      const actualHost = address && typeof address === 'object' ? address.address : host;
      apiServerRuntimeStatus = {
        phase: 'listening',
        startupHost: apiHost,
        actualHost,
        errorCode: '',
        fellBack: triedFallback,
      };
      console.log(`${LOG_PREFIX} API server listening on http://${actualHost}:${API_PORT}`);
    });
  };

  httpServer.on('error', (e) => {
    if (e.code === 'EADDRINUSE') {
      apiServerRuntimeStatus = {
        phase: 'error',
        startupHost: apiHost,
        actualHost: '',
        errorCode: e.code,
        fellBack: triedFallback,
      };
      console.warn(`${LOG_PREFIX} Port ${API_PORT} in use, API server disabled.`);
    } else if (e.code === 'EADDRNOTAVAIL' && !triedFallback && apiHost !== '127.0.0.1') {
      // apiHost（例: Tailscale IP）が未割り当て（Tailscale 未接続など）の場合は
      // ローカルのみで起動して API を死なせない。
      triedFallback = true;
      console.warn(`${LOG_PREFIX} apiHost ${apiHost} unavailable, falling back to 127.0.0.1.`);
      listen('127.0.0.1');
    } else {
      apiServerRuntimeStatus = {
        phase: 'error',
        startupHost: apiHost,
        actualHost: '',
        errorCode: typeof e.code === 'string' ? e.code : 'UNKNOWN',
        fellBack: triedFallback,
      };
      console.error(`${LOG_PREFIX} API server error:`, e);
    }
  });

  listen(apiHost);
}
