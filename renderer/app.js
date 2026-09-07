// ─── 依存の受け取り（issue #268） ─────────────────────────────────────────────
// BrowserWindow を nodeIntegration: false / contextIsolation: true にしたため、
// このファイルからは require が使えない。必要なものは 3 経路で受け取る。
//
//   1. IPC / shell / clipboard … preload の contextBridge（window.vkBridge）を
//      renderer/ipcClient.js が中継した VKIpc / VKShell / VKClipboard
//   2. xterm / addon-fit     … renderer/bootstrap.js が <script> で読み込んだ UMD の
//      グローバル（window.Terminal / window.FitAddon）
//   3. アプリ内の共有モジュール … index.html が <script> で読み込んだ UMD の
//      グローバル（window.VK*）
//
// このファイルに require を書き戻さないこと（書けば読み込み時点で必ず落ちる）。

// 1. preload 経由の API（実体は renderer/ipcClient.js）。
//    オブジェクト参照だけを持ち、メソッドは分割代入しない。e2e が
//    window.VKIpc.invoke を差し替えてモックするため、呼び出し時に引き直す必要がある。
const VKIpc = window.VKIpc;
const VKShell = window.VKShell;
const VKClipboard = window.VKClipboard;

// 2. xterm（bootstrap.js が app.js より先に読み込み済み）
const Terminal = window.Terminal;
const FitAddon = window.FitAddon.FitAddon;

// 3. アプリ内の共有モジュール（index.html の <script> 順で読み込み済み）
const { appendAnsiForDisplay, stripAnsiForDisplay } = window.VKStripAnsi;
const { normalizeConfirmClose, shouldConfirmClose } = window.VKCloseConfirm;
// apiHost の即時案内（getApiHostAuthNotice）と utils/apiAuth.js の認証要否判定
// （shouldRequireAuth）が同じループバック定義を参照するための共有モジュール
// （issue #313 レビュー対応・PR #315 指摘。旧実装は '127.0.0.1' の完全一致だけを
// 見ており、::1 / ::ffff:127.0.0.1 で誤った警告を出していた）。
// isLoopbackDisplayValue は画面の即時案内専用（'localhost' も loopback 扱いにする）。
// 認証要否の実判定（shouldRequireAuth）に使う isLoopbackHost 自体には 'localhost' を
// 足していないので、ここでは案内専用の関数だけを使う（PR #315 安藤のレビュー指摘）。
const { isLoopbackDisplayValue } = window.VKLoopbackHost;
const { isSafeHttpUrl } = window.VKUrlSafety;
// ペイン内 URL の Cmd/Ctrl+クリック対応（issue #349）。折り返し行をまたぐ URL の検出・
// バッファ位置への変換は renderer/terminalLinkProvider.js（xterm.js の
// registerLinkProvider を自前実装）が担う。詳しい採用理由は同ファイル冒頭のコメント参照。
const { createTerminalLinkProvider } = window.VKTerminalLinkProvider;
// ツールチップに表示する「解決後の遷移先ホスト」の取得に使う（安藤レビュー指摘・MEDIUM）。
const { getUrlHost } = window.VKUrlLinkify;
const {
  migrateLegacyState,
  readCollapsedSections,
  writeSectionCollapsed,
} = window.VKSidebarSectionState;
// 宣言的ウィジェット（tasks-widget.json）の契約・共有描画（#229 / vk-orchestrator#182）。
// タスクの語彙・色・遷移・確認文言は自前に持たず、orchestrator が書き出す宣言だけを描画する。
const widgetContract = window.VKWidgetContract;
const { createTaskWidgetView } = window.VKWidgetView;
const {
  computeTaskSectionVisibility,
} = window.VKTaskSectionVisibility;
// エージェントルーム（issue #58）。サブエージェントの稼働状況をドット絵キャラで可視化する。
const { AGENT_ORDER, buildScene, resolveAgentStatesFromOutput } = window.VKAgentRoom;
const {
  containsIgnoringWhitespace,
  detectBackgroundAgents,
  extractScreenLines,
  findWaitingMatch,
  isOutputQuiescent,
  isWaitingCwdExcluded,
  nextWaitingOnset,
  nextWaitingState,
  normalizeWaitingExcludeCwdPatterns,
  selectWaitingBuffer,
  shouldBeepForWaiting,
  stripVolatileForKey,
  waitingCheckDelayMs,
} = window.VKWaitingState;
const { deriveStatus } = window.VKStatusState;
const { getStatusPresentation } = window.VKStatusPresentation;
const { getApiServerStatusPresentation } = window.VKApiServerStatus;
const { getPrBadgePresentation } = window.VKPrBadge;
const { resolveQueueIssuesListUrl } = window.VKTaskQueueLink;
const { isPatternValid } = window.VKSettingsValidation;
const { isFieldVisible, isFieldDisabled } = window.VKSettingsVisibility;
const { linesFieldDisplayText } = window.VKSettingsLinesField;
const { createAutoCloseController } = window.VKAutoClose;
const { createSingleOpenGuard } = window.VKSettingsModalGuard;
const { createEscapeLayerStack } = window.VKEscapeLayer;
const { createFocusTrapStack } = window.VKFocusTrap;
const {
  dedupeSettingsFieldsByKey,
  deriveSettingsTargetPathsForGroups,
  groupSettingsGroupsByTab,
  normalizeSettingsTabs,
} = window.VKSettingsTabs;

// モーダル類の Escape は、最後に開いたものだけへ渡す（issue #284）。
const escapeLayers = createEscapeLayerStack(document);
// モーダル類の Tab は最前面のものの中だけで循環させ、背後は inert で止める（issue #282）。
// これで escapeLayers が前提とする「後から開いたものが最前面」を崩す経路のうち、
// 「確認ダイアログを開いたまま Tab で ⚙ へ抜けて設定パネルを開く」は消える。
// ただし openSettingsModal() は settings:describe の応答を待つため、⚙ を押してから
// パネルが生成されるまでの数 ms はまだ何も inert ではない。この隙間にペインの ✕ を
// 押せれば逆転しうる（手動では踏めず、二重オープンも各ガードで防がれているため未対応）。
const focusTraps = createFocusTrapStack(document);

// ─── State ────────────────────────────────────────────────────────────────────
let tree = null;       // Layout tree root
// ペイン D&D 中の状態（issue #40）。リサイズ用の dragState とは別変数で衝突回避。
//   - srcId: ドラッグ中のペイン id
//   - lastTargetId / lastDir: 直前フレームで描画したオーバーレイの対象と方向（再描画スキップ判定用）
let paneDragState = null;
// pane D&D 用の独自 MIME。既存のファイル D&D（パス挿入）と分岐するためのキー（issue #40）
const PANE_DRAG_MIME = 'application/x-vk-pane';
// 中央デッドゾーンの比率（issue #40）。0.2 = 中央 20% を無効ゾーンとして扱う
const PANE_DROP_DEADZONE = 0.2;
// terminals[paneId] のフィールド概要（status / runningTimer は issue #23 で追加）:
//   - waiting (bool): 内部判定用フラグ。PTY 出力が静止した時点で WAITING_PATTERNS に
//     ヒットすると true になる（静止ゲート / issue vektor-inc/vk-orchestrator#212）。
//     解除は「ユーザー入力（markPaneInput）」または「出力が流れている最中の判定で非マッチ」。
//     states.json 後方互換のために残してある（task-queue 等の外部連携が参照している）。
//   - externalWaiting (bool): 外部権威の入力待ちフラグ。POST /api/set-status の明示 push だけで更新。
//     自動入力・リサイズ・再描画では解除せず、waiting と OR で status に合流する。
//   - status ('idle'|'running'|'waiting'): 表示用の派生値。
//     waiting または externalWaiting が true なら 'waiting' を最優先。
//     どちらも false で直近 1500ms 以内に PTY 出力があり、かつ直近 200ms 以内に入力がなければ 'running'。
//     どちらでもなければ 'idle'（DOM 側で要素ごと非表示）。
//   - runningTimer (number|null): 'running' を 1500ms 後に 'idle' へ戻すための setTimeout id。
//     recomputeStatus() / bumpRunning() が張り直し、closePane() で必ず clearTimeout する。
let terminals = {};    // paneId -> { termId, term, fitAddon, element, cwd, cwdFull, waiting, status, runningTimer, lastLines, ... }
let focusedPaneId = null;
let dragState = null;
// ペイン内 URL の最初のクリックがフォーカス移動だけだったかどうかの判定に使う
// （issue #385）。paneId -> 「今回の mousedown でフォーカスが切り替わる直前、その
// ペインが既にフォーカス済みだったか」の boolean。.pane / .stash-item 要素の mousedown
// ハンドラ（focusPane() を呼ぶ直前、recordPaneFocusBeforeMousedown() 経由）で記録し、
// その後の mouseup で発火する xterm.js の activate（createTerminalLinkHandlers の
// wasPaneFocused 依存関数）から参照する。記録タイミングの理由は
// utils/terminalLinkPolicy.js の createTerminalLinkHandlers 冒頭コメント参照。
// closePane() で該当エントリを削除する。
const paneFocusBeforeMousedown = new Map();

// ウィンドウが blur から復帰した直後の最初の mousedown かどうか（issue #385 レビュー
// 指摘・MEDIUM-5）。別アプリから VK Terminals をクリックして前面に出すとき、その
// クリックがたまたまフォーカス済みペインの URL 上に落ちるとブラウザが開いてしまう
// （修飾キー必須のときは起きなかった事故）。window の blur で pendingWindowRefocusClick
// を立て、次の mousedown（document の capture フェーズ。xterm.js 側の内部リスナーより
// 必ず先に発火する。理由は下の document.addEventListener 呼び出しのコメント参照）で
// isPostWindowBlurMousedown へ確定させてからフラグを消費する。
// recordPaneFocusBeforeMousedown() はこの値が true のときフォーカス状態を強制的に
// false 扱いにする（＝フォーカス移動だけの操作とみなし、リンクは開かせない）。
//
// 【設計メモ・崩さないこと】この仕組みは「blur で印を立て、次の mousedown で消費する」
// 形でなければ成立しない。「focus イベントで印を消す」形に直すと、クリックでウィンドウを
// 前面化する場合は OS ネイティブの focus イベントの方が mousedown より先に飛ぶため
// （フォーカス移動が先に確定してからアプリ側に mousedown が届く）、印を立てる暇なく
// 消えてしまい、ガードが丸ごと効かなくなる（レビュー指摘・MEDIUM-5 の補足）。
//
// 【レビュー指摘・LOW-B】既定値を false にしていると、アプリがバックグラウンド起動
// （最初からウィンドウが前面に無い状態）した場合は blur が一度も飛ばないため、
// 前面に出すための最初のクリックが通常のクリック扱いになってしまう。それが起動時に
// 自動フォーカスされる最初のペイン（initApp() 参照）の URL 上に落ちると開く。
// 起動時点で document がフォーカスを持っていなければ、最初から「復帰クリック待ち」
// 状態で始める。
let pendingWindowRefocusClick = !document.hasFocus();
let isPostWindowBlurMousedown = false;

// URL のドラッグ選択判定用の状態（issue #385 レビュー指摘・HIGH-2）。xterm.js の
// Linkifier は mousedown 時点のリンクと mouseup 時点のリンクが一致するだけで activate
// を呼び、ポインタの移動量や選択の有無は一切見ない。これは「別々のリンクをまたぐ
// ドラッグ」だけでなく「同一リンクの中をなぞって選択する（＝ URL をコピーしようと
// する）」操作も満たしてしまうため、mousedown → mouseup の移動距離を自前で計測し、
// createTerminalLinkHandlers の wasDragged() 依存関数へ渡す（詳細は
// utils/terminalLinkPolicy.js の同依存関数の説明コメント参照）。
//
// しきい値は 4px。多くのブラウザ・OS の GUI ツールキットが「クリックとドラッグ開始」を
// 区別するのに使う一般的な目安（WebKit の DragController の既定しきい値に近い値）で、
// 実測に基づく厳密な最適値ではない。閾値を超えたのに実際は静止したままのクリックだった
// 場合の実害は「まれにクリックし直しが要る」程度で小さく、逆に閾値を大きくしすぎて
// ドラッグをクリック扱いしてしまう実害（誤って外部ブラウザが開く）の方が大きいため、
// 小さめ（＝ドラッグ判定側に倒れやすい）の値をあえて選んでいる。
//
// なぜ term.hasSelection() ではなく移動距離で判定するのか（レビュー指摘・LOW-A の
// 訂正版。詳しい理由づけは utils/terminalLinkPolicy.js の wasDragged() 依存関数の
// 説明コメント参照）: hasSelection() は xterm.js 内部の選択実装（将来変わりうる非公開の
// 詳細）に依存するのに対し、移動距離は自前の document capture リスナーだけで完結し
// xterm.js の内部実装に一切依存しない。距離計算そのもの（isDragDistance()）は
// utils/terminalLinkPolicy.js の純粋関数へ切り出し、ユニットテストで固定している
// （安藤の案・レビュー指摘・MEDIUM-B）。
const TERM_LINK_DRAG_THRESHOLD_PX = 4;
let lastMousedownClientPos = null;
let lastClickWasDrag = false;

// document への capture フェーズのリスナーにするのは、xterm.js 側のリスナー
// （ターミナルの描画要素＝ document の子孫へ登録される）より必ず先に発火させるため。
// capture フェーズは document → 子孫の順（上から下）へ完全に進み終えてから bubble
// フェーズが始まるため、document の capture リスナーは子孫側の登録順・登録タイミングに
// かかわらず常に先に走る（paneFocusBeforeMousedown の記録に使っている .pane /
// .stash-item の mousedown ハンドラと同じ考え方）。
document.addEventListener('mousedown', (event) => {
  lastMousedownClientPos = { x: event.clientX, y: event.clientY };
  isPostWindowBlurMousedown = pendingWindowRefocusClick;
  pendingWindowRefocusClick = false;
}, true);
document.addEventListener('mouseup', (event) => {
  lastClickWasDrag = isDragDistance(
    lastMousedownClientPos,
    { x: event.clientX, y: event.clientY },
    TERM_LINK_DRAG_THRESHOLD_PX
  );
}, true);

// .pane（グリッド）・.stash-item（格納・サイドバー）のどちらの mousedown からも
// 必ずこのヘルパー経由で記録する（issue #385 レビュー指摘・MEDIUM-1）。格納ペインの
// xterm 要素は render() の再アタッチで .stash-item .term-container へ移されて生きた
// まま操作でき、リンクプロバイダも登録済みのままなので、.pane 側でしか記録しないと
// 格納ペインでガードが機能しない（またはその逆）。
function recordPaneFocusBeforeMousedown(paneId) {
  const wasFocused = isPostWindowBlurMousedown ? false : (focusedPaneId === paneId);
  paneFocusBeforeMousedown.set(paneId, wasFocused);
}

// status 判定で使う閾値（ms）。
//   - RUNNING_IDLE_TIMEOUT_MS: 最後の PTY 出力から何 ms 経ったら idle に戻すか
//   - RUNNING_INPUT_GUARD_MS:  入力直後（タイプ中）はエコー出力で running 扱いしないためのガード時間
//
// ⚠ RUNNING_IDLE_TIMEOUT_MS は waitingState.js の WAITING_QUIESCENCE_MS（1500ms）と
//   同値であることに意味がある。入力待ちの解除は「出力が流れている」ときにしか起きないが、
//   静止時間がこの値を超えると解除の瞬間に recentOutput が偽になり、running ではなく
//   idle を一瞬経由してバッジがちらつく。変更するときは必ず両方を見ること。
const RUNNING_IDLE_TIMEOUT_MS = 1500;
const RUNNING_INPUT_GUARD_MS = 200;

// ─── Agent room（issue #58） ────────────────────────────────────────────────
// config.json の `agentroom: true` のときだけ各ペイン下部にアコーディオンを表示する。
// 値は起動時に main プロセス（app:get-config）から取得する。
let agentRoomEnabled = false;
// 新規ペイン（＋ / 空グリッド「新規ペインを追加」）の既定挙動（issue #143）。
// 値は起動時に main（app:get-config）から取得する。設定反映には再起動が必要（設定パネルの note 参照）。
let newPaneStartupDir = '';
let newPaneAutoLaunchClaude = false;
// ペインを閉じる時の確認（issue #184）。'never' | 'busy' | 'always'（既定 'busy'）。
// 値は起動時に main（app:get-config）から取得する。設定反映には再起動が必要（設定パネルの note 参照）。
let confirmClosePref = 'busy';
// ペイン内 URL のクリック挙動（issue #385）。'click'（既定・単クリックで開く） |
// 'modifier'（従来どおり ⌘/Ctrl+クリックが必要）。
// 値は起動時に main（app:get-config）から取得する。設定反映には再起動が必要（設定パネルの note 参照）。
let terminalLinkClickModePref = 'click';
let waitingExcludeCwdPatterns = [];
let commandsConfigured = false;
// 宣言的ウィジェットの中継ペイロード { widget, legacyNotice, commandsConfigured }。
let lastWidgetPayload = null;
let hasSeenFreshWidget = false;
// 宣言的ウィジェットの共有描画コントローラ（renderer/widgetView.js）。初回描画時に生成する。
let widgetViewController = null;
// HTTP API（POST /api/agentroom）由来のルーム状態を、この TTL を超えたら「古い」と判断して
// PTY 出力ベースのフォールバック表示に切り替える（ms）。
const AGENTROOM_API_TTL_MS = 90000;

// staleness の再計算は毎描画で行い、閾値は宣言（widget.staleThresholdMs）から受ける。
// updatedAt が無い・宣言が無いときのフォールバック既定値（ハードコードのドメイン定数ではない）。
const WIDGET_STALE_FALLBACK_MS = widgetContract.DEFAULT_STALE_THRESHOLD_MS;
const TASKS_ELAPSED_TICK_MS = 30000;
// 反映待ちがこの時間内に反映されない場合はタイムアウトで解除する（ms）。
const TASK_PENDING_TIMEOUT_MS = 30000;
// dual-write 期間: 新 tasks-widget.json が無く旧 tasks-view.json だけがある場合の後方互換注記。
const WIDGET_LEGACY_NOTICE_TEXT = 'orchestrator の更新が必要な可能性があります';

// waiting 判定用 lastLines バッファの上限（issue #32 対応）。
//   - LASTLINES_MAX_LINES: 直近 N 行を保持する。
//     旧実装は 15 行だったが、Claude Code TUI はウィンドウリサイズや recap 表示で
//     プロンプト枠・「✻ Worked for ...」などの再描画行を数十行単位で吐き出すため、
//     肝心の確認待ち文（例: 「ご確認をお願いします。…」）がウィンドウから押し出されてしまい
//     検知できなくなっていた。十分大きめのウィンドウを取って取りこぼしを防ぐ。
//   - LASTLINES_MAX_CHARS: 行数だけだと「空行が大量に積まれる」状態でもメモリを食わないが、
//     1 行が極端に長い場合に備えて文字数の上限も設ける（保険）。
const LASTLINES_MAX_LINES = 80;
const LASTLINES_MAX_CHARS = 8000;

// バックグラウンドサブエージェント数（issue #340）の判定に読む画面末尾の行数。
// Claude Code のフッター行（"bypass permissions on" 等）と「← N agents」ヒントは
// 画面下端の数行以内に収まるため、余裕を見て 20 行あれば十分。
const BACKGROUND_AGENTS_SCAN_LINES = 20;

// ─── ID generation ────────────────────────────────────────────────────────────
let _idCounter = 0;
const newId = () => `pane-${++_idCounter}`;

// ─── Terminal theme ────────────────────────────────────────────────────────────
const TERM_THEME = {
  background: '#0d1117',
  foreground: '#e6edf3',
  cursor: '#e6edf3',
  cursorAccent: '#0d1117',
  selectionBackground: '#3d444d',
  black: '#0d1117', brightBlack: '#6e7681',
  red: '#ff7b72', brightRed: '#ffa198',
  green: '#3fb950', brightGreen: '#56d364',
  yellow: '#d29922', brightYellow: '#e3b341',
  blue: '#58a6ff', brightBlue: '#79c0ff',
  magenta: '#bc8cff', brightMagenta: '#d2a8ff',
  cyan: '#39c5cf', brightCyan: '#56d4dd',
  white: '#b1bac4', brightWhite: '#f0f6fc',
};

// waiting 判定本体。PTY 出力のたびには呼ばず、scheduleWaitingCheck() が張るタイマー
// （静止到達 or 上限間隔）からのみ呼ばれる（issue vektor-inc/vk-orchestrator#212）。
// 判定時点で出力が流れているかどうかで解除の可否が変わるため、ここで静止を測る。
function checkWaiting(paneId) {
  const t = terminals[paneId];
  if (!t) return;
  t.waitingCheckTimer = null;
  t.waitingPendingSince = 0;
  const now = Date.now();
  const excluded = isWaitingCwdExcluded(t.cwdFull, waitingExcludeCwdPatterns);
  const quiescent = isOutputQuiescent({ now, lastOutputTime: t.lastOutputTime });
  // 静止評価は lastLines（80 行ウィンドウ）全体、上限評価は前回の評価以降に届いた
  // 出力（recentLines）だけを見る。理由は selectWaitingBuffer のコメント参照。
  const buffer = stripAnsiForDisplay(selectWaitingBuffer({
    quiescent,
    fullBuffer: t.lastLines,
    recentBuffer: t.recentLines,
  }));
  // findWaitingMatch は真偽値ではなく、一致箇所（前後の文脈込み）の文字列そのものを
  // 返す（issue #352）。バッファ内で最も後ろの一致（画面下端に最も近い、ライブな
  // 一致）を返すため、80 行バッファの先頭側に残る古いログ等を誤って根拠にしない
  // （安藤の指摘・再レビュー HIGH。findWaitingMatch 自体のコメント参照）。
  // 点灯の根拠を記録するため matchesWaiting ではなくこちらを使う。
  const matchText = findWaitingMatch(buffer);
  const matches = matchText !== null;
  // stripVolatileForKey は matchText（文脈込み）から数字（時刻・termId・カウンタ等の
  // 可変部分）だけを潰したもの。ビープの長期抑制の鍵（t.waitingOnsetKey）専用
  // （issue #352 の再レビュー・司と安藤の実測で発覚）。matchText をそのまま鍵にすると
  // 可変部分のせいで再点灯のたびに鍵が変わり長期抑制が効かない一方、正規表現の
  // 一致範囲そのもの（m[0]）まで丸めると判別力が無くなり内容の異なる本物の確認
  // どうしを同一視してしまう（詳細は stripVolatileForKey / WAITING_BEEP_REPEAT_SUPPRESS_MS
  // のコメント参照）。
  const matchKey = stripVolatileForKey(matchText);
  // 次回の上限評価は「ここから先に届いた出力」だけを対象にする。
  t.recentLines = '';
  // 静止評価・非マッチ・かつ現在入力待ち中のときだけ、点灯根拠がまだ画面
  // （lastLines）に見えるかを調べる。上の条件に当たらない呼び出しでは
  // nextWaitingState 側で使われないため計算を省く。
  //   quiescent が真のとき buffer は selectWaitingBuffer により t.lastLines
  //   （ANSI を落としたもの）そのものになる。
  const onsetStillVisible = (quiescent && !matches && t.waiting && t.waitingOnsetMatch)
    ? containsIgnoringWhitespace(buffer, t.waitingOnsetMatch)
    : undefined;
  const waiting = nextWaitingState({ prev: t.waiting, matches, excluded, quiescent, onsetStillVisible });
  // 点灯根拠（t.waitingOnsetMatch / t.waitingOnsetKey）の更新ルール自体は
  // nextWaitingOnset（純粋関数）に委ねる。判断基準の詳細・#91 への影響が無い理由は
  // 同関数のコメント参照。ここでは backfill 用の再探索だけを行う。
  //
  // backfill: waiting = true で、かつ今回は「静止評価での新規マッチ」ではない
  // （matches && quiescent が成立しない）ときだけ、解除判定の照合先そのものである
  // t.lastLines に対して直接再探索する。上限評価（quiescent = false）でのマッチ
  // 直後に出力が止まり、次の静止評価が recentLines と lastLines の CR 上書きの
  // 食い違いで非マッチになるケース（安藤の指摘 MEDIUM と同根）で根拠が null に
  // 固定され続けるのを防ぐ（司の指摘・#352 の再レビュー）。
  // quiescent な非マッチでここに来た場合は buffer が既に t.lastLines と同一なので、
  // この再探索は matches と同じ null を返す空振りになるだけで実害は無い。
  let backfillText = null;
  let backfillKey = null;
  if (waiting && !(matches && quiescent)) {
    const backfillBuffer = stripAnsiForDisplay(t.lastLines);
    backfillText = findWaitingMatch(backfillBuffer);
    backfillKey = backfillText !== null ? stripVolatileForKey(backfillText) : null;
  }
  const nextOnset = nextWaitingOnset({
    waiting,
    prevOnsetMatch: t.waitingOnsetMatch,
    prevOnsetKey: t.waitingOnsetKey,
    matches,
    quiescent,
    matchText,
    matchKey,
    backfillText,
    backfillKey,
  });
  t.waitingOnsetMatch = nextOnset.onsetMatch;
  t.waitingOnsetKey = nextOnset.onsetKey;
  if (waiting !== t.waiting) {
    t.waiting = waiting;
    if (waiting) {
      // 静止ゲートが効いていることを e2e から検証できるようにするための記録（issue #270）。
      // 記録するのは「点灯した時刻」と「その時点での lastOutputTime」という生の 2 値だけで、
      // 差分も quiescent の判定結果も持たせない。差分をここで計算すると、テストが
      // 「本番コード自身の結論」を読み返すだけになり、退行の検出力が消えるため。
      // なお e2e 側が観測時点で lastOutputTime を読む形にはできない。lastOutputTime は
      // 出力のたびに前進する（terminal:data ハンドラ）ので、点灯後に出力が届くと差分が
      // 縮み、意味のない値になる。点灯の瞬間にスナップショットする必要がある。
      t.localWaitingOnset = { at: now, lastOutputTime: t.lastOutputTime };
    }
    // NOTE: 解除時に lastLines は捨てない。解除が起きるのは matches === false のとき
    // だけなので、バッファには入力待ちと判定される文言が残っていない。捨てると直後の
    // 判定材料まで失うだけで、再点灯の抑止にもならないため保持する
    // （ユーザー入力による解除は文脈ごと変わるため、markPaneInput では従来どおり捨てる）。
    // waiting フラグが変わったら status も再計算する。
    // 出力が流れている最中の解除では recentOutput が真になるので、idle を経由せず
    // そのまま 'running' へ遷移する（deriveStatus 参照）。
    recomputeStatus(paneId);
    // 待機状態になったときに通知音を鳴らす。解除と再検知が短時間で往復しても
    // 鳴り続けないようクールダウンを挟む。
    // onsetMatch / lastBeepedOnsetMatch には t.waitingOnsetKey（stripVolatileForKey で
    // 数字を潰した後の文字列）を渡す。issue #352 の副作用対応（植草のレビュー）:
    // 疎な出力ペインは「点灯→押し出されて解除→同じ文言で再点灯」の点滅を起こし
    // 得るため、直前と同じ点灯根拠なら通常より長い猶予
    // （WAITING_BEEP_REPEAT_SUPPRESS_MS）で抑止する。
    // ⚠ t.waitingOnsetMatch（文脈そのまま。数字を潰していない）を渡してはいけない
    //   （司の実測で発覚した不具合）。vk-orchestrator の常駐ログは前後の文脈
    //   （termId 等）が毎回変わるため、数字を潰さない文字列を鍵にすると長期抑制が
    //   一度も適用されない（詳細は stripVolatileForKey / WAITING_BEEP_REPEAT_SUPPRESS_MS
    //   のコメント参照）。
    if (waiting && shouldBeepForWaiting({
      now,
      lastBeepAt: t.lastWaitingBeepAt,
      onsetMatch: t.waitingOnsetKey,
      lastBeepedOnsetMatch: t.lastBeepedOnsetKey,
    })) {
      t.lastWaitingBeepAt = now;
      t.lastBeepedOnsetKey = t.waitingOnsetKey;
      VKShell.beep();
    }
  }
  // 不変条件: バーストの最後の評価は必ず静止評価になる。
  //   上限（非静止）で走った評価はここで打ち止めにできない。この直後に出力が止まると
  //   次のタイマーを張る契機（terminal:data）が来ず、静止時点の評価が一度も走らないため、
  //   バーストの最後の瞬間に出ていた本物のプロンプトを取りこぼす。
  //   非静止で評価したときは必ず張り直し、静止に到達するまで追いかける。
  //   （張り直しの delay は「静止までの残り」= 必ず正なので、ここで無限ループはしない）
  if (!quiescent) scheduleWaitingCheck(paneId);
}

// 静止ゲート（issue vektor-inc/vk-orchestrator#212）。
// PTY 出力のたびにタイマーを張り直し、出力が止まってから判定する。
// 出力が止まらない場合でも、上限間隔ごとに必ず 1 回は判定が走る。
function scheduleWaitingCheck(paneId) {
  const t = terminals[paneId];
  if (!t) return;
  const now = Date.now();
  if (!t.waitingPendingSince) t.waitingPendingSince = now;
  const delay = waitingCheckDelayMs({
    now,
    lastOutputTime: t.lastOutputTime,
    pendingSince: t.waitingPendingSince,
  });
  clearWaitingCheckTimer(t);
  t.waitingCheckTimer = setTimeout(() => checkWaiting(paneId), delay);
}

function clearWaitingCheckTimer(t) {
  if (!t?.waitingCheckTimer) return;
  clearTimeout(t.waitingCheckTimer);
  t.waitingCheckTimer = null;
}

// waiting 判定用バッファへ PTY 出力を積む。
// issue #32: 直近 N 行のウィンドウが小さすぎると、Claude Code TUI のプロンプト枠や
// recap メッセージの再描画で本来の確認文が押し出されて検知できなくなる。
// 行数とトータル文字数の両方で上限を設けてメモリ膨張も防ぎつつ十分なウィンドウを確保する。
function appendWaitingBuffer(prev, data) {
  let merged = appendAnsiForDisplay(prev, data).split('\n').slice(-LASTLINES_MAX_LINES).join('\n');
  if (merged.length > LASTLINES_MAX_CHARS) {
    // 行を跨いだ単純な末尾切り出し（マルチバイトでも安全）。
    merged = merged.slice(-LASTLINES_MAX_CHARS);
  }
  return merged;
}

// バックグラウンドサブエージェント数（issue #340）を、xterm の画面バッファから
// 都度読み直して判定する。
//
// t.lastLines（appendWaitingBuffer が積む累積バッファ）ではなく、
// t.term.buffer.active（xterm が実際に画面へ描画している内容そのもの）を読む。
// 累積バッファには過去に流れた「← N agents」の描画が残り続けるため、素朴に
// 走査するとサブエージェント終了後もいつまでも古い数を返し、「終わると 0 に
// 戻る」という完了条件を満たせない（buffer.active は現在の画面そのものなので
// この問題が起きない）。
//
// 行の切り出し自体（末尾 BACKGROUND_AGENTS_SCAN_LINES 行への絞り込み・baseY
// クランプ・折り返し行の連結）は renderer/waitingState.js の extractScreenLines
// （純粋関数）へ委ね、判定も同ファイルの detectBackgroundAgents に委ねる。
// app.js 側は xterm オブジェクトを渡す配線と、例外の受け止めだけを担う。
//
// 安藤の指摘（MEDIUM-2）: readBackgroundAgents はこの setInterval ループで
// 初めて xterm 内部（buffer.active）へ触る呼び出しのため、想定外の例外で
// throw すると terminal:report-states 自体が送られなくなり、cachedStates が
// 凍結して lastOutputTime が古いまま固定される。司令塔が「出力が止まった＝
// 終了」と誤認する、この issue と同種の事故を別経路で起こしてしまうため、
// 必ず try/catch で受け止めて不明（null）側へフォールバックする。
// 安藤の指摘（LOW-1）: 存在チェック（t.term.buffer.active へのプロパティアクセス
// 連鎖）自体も try の外にあると、MEDIUM-2 で入れた例外の受け止めがその手前で
// 素通りしてしまう。存在チェックごと try の内側へ入れる。
function readBackgroundAgents(t) {
  try {
    if (!t || !t.term || !t.term.buffer || !t.term.buffer.active) return null;
    const lines = extractScreenLines(t.term.buffer.active, BACKGROUND_AGENTS_SCAN_LINES);
    if (lines === null) return null;
    return detectBackgroundAgents(lines.join('\n'));
  } catch (e) {
    return null;
  }
}

// 入力（ユーザー入力・ドロップ送信・API 送信）があったペインのローカル入力待ち状態を解除する。
// waiting の即時解除経路（もう一方は checkWaiting() の「出力が流れている最中の非マッチ」）。
// externalWaiting は外部の明示 false push だけで解除する。
function markPaneInput(paneId) {
  const t = terminals[paneId];
  if (!t) return;
  t.lastInputTime = Date.now();
  clearWaitingCheckTimer(t);
  t.waitingPendingSince = 0;
  // ユーザーが応答した後の入力待ちは「別の新しい確認」なので、クールダウンを持ち越さず
  // 必ず鳴らす。抑止したいのは入力を挟まない機械的な往復だけ。
  t.lastWaitingBeepAt = 0;
  // lastBeepedOnsetKey も同じ理由でリセットする。人が応答した以上、次にこのペインが
  // 入力待ちになったら（たとえ点灯根拠の文字列が偶然同じでも）新しい確認として扱い、
  // ビープの長期抑制（WAITING_BEEP_REPEAT_SUPPRESS_MS）を持ち越さない。
  t.lastBeepedOnsetKey = null;
  if (t.waiting) {
    t.waiting = false;
    t.lastLines = '';
    t.recentLines = '';
    t.waitingOnsetMatch = null;
    t.waitingOnsetKey = null;
  }
  recomputeStatus(paneId);
}

function clearRunningIdleTimer(t) {
  if (!t?.runningTimer) return;
  clearTimeout(t.runningTimer);
  t.runningTimer = null;
}

// running 表示の自動 idle 復帰タイマーを張り直す。
function armRunningIdleTimer(paneId) {
  const t = terminals[paneId];
  if (!t) return;
  clearRunningIdleTimer(t);
  t.runningTimer = setTimeout(() => {
    const cur = terminals[paneId];
    if (!cur) return;
    cur.runningTimer = null;
    // タイマー満了時に waiting に変わっていたらそのまま、そうでなければ idle に戻す。
    if (!cur.waiting && !cur.externalWaiting && cur.status === 'running') {
      cur.status = 'idle';
      updatePaneStatus(paneId);
    }
  }, RUNNING_IDLE_TIMEOUT_MS);
}

// status を waiting フラグ・外部権威フラグ・最終出力時刻・最終入力時刻から再計算してセットする。
// 派生フィールドのため、ここ以外から t.status を直接書き換えないこと。
function recomputeStatus(paneId) {
  const t = terminals[paneId];
  if (!t) return;
  const next = deriveStatus({
    localWaiting: t.waiting,
    externalWaiting: t.externalWaiting,
    now: Date.now(),
    lastOutputTime: t.lastOutputTime,
    lastInputTime: t.lastInputTime,
    runningIdleTimeoutMs: RUNNING_IDLE_TIMEOUT_MS,
    runningInputGuardMs: RUNNING_INPUT_GUARD_MS,
  });
  if (next === 'running') {
    armRunningIdleTimer(paneId);
  } else {
    clearRunningIdleTimer(t);
  }
  if (next !== t.status) {
    t.status = next;
    updatePaneStatus(paneId);
  }
}

// PTY 出力があったときに呼ぶ。waiting でなく、入力直後でなければ 'running' に切り替え、
// 1500ms 後に idle へ戻すタイマーを張る。既存タイマーがあれば張り直す（polling 不要）。
function bumpRunning(paneId) {
  const t = terminals[paneId];
  if (!t) return;
  // waiting は最優先のため running に上書きしない
  if (t.waiting || t.externalWaiting) return;
  // タイマーは出力ごとに張り直す
  clearRunningIdleTimer(t);
  const now = Date.now();
  const recentInput = now - (t.lastInputTime || 0) <= RUNNING_INPUT_GUARD_MS;
  // 入力直後（タイプ中のエコー）は running と見なさない。idle のまま据え置く。
  if (recentInput) return;
  if (t.status !== 'running') {
    t.status = 'running';
    updatePaneStatus(paneId);
  }
  armRunningIdleTimer(paneId);
}

// ─── Create terminal ──────────────────────────────────────────────────────────
// options.noClaude が true の場合、main 側で claude の自動起動をスキップする。
// 未指定の場合は main 側のグローバル設定（CLI フラグ）にフォールバックする。
// options.engine が指定されていれば main 側でそのエンジンを起動する（未指定なら claude。issue #367）。
// options.model が指定されていれば main 側で選択エンジンをそのモデルで起動する。
async function createTerminal(paneId, cwd, options = {}) {
  const result = await VKIpc.invoke('terminal:create', cwd || null, options);
  const { id: termId, cwd: initialCwd } = result;

  const term = new Terminal({
    fontFamily: 'Menlo, Monaco, "Courier New", monospace',
    fontSize: 13,
    lineHeight: 1.2,
    theme: TERM_THEME,
    cursorBlink: true,
    scrollback: 10000,
    allowTransparency: false,
    macOptionIsMeta: true,
  });

  const fitAddon = new FitAddon();
  term.loadAddon(fitAddon);

  // ペイン内 URL のクリック対応（issue #349 → #385）。破棄は term.dispose() 側に
  // 任せる（xterm.js 本体の LinkProviderService は Terminal の disposal 時に登録済み
  // プロバイダを自動でクリアするため、fitAddon 同様ここで個別に dispose() を呼ぶ必要は無い）。
  // isMac は明示的に IS_MAC_PLATFORM を渡す（安藤レビュー指摘・LOW）。省略すると
  // isLinkOpenModifierPressed 側が呼び出しのたびに isMacPlatform() を再評価する一方、
  // ツールチップの文言（TERM_LINK_MODIFIER_LABEL）はキャッシュ済みの IS_MAC_PLATFORM を
  // 使っており、「実際に見ている修飾キー」と「表示している修飾キー」の判定元が
  // 2 箇所に分かれてしまう。値は実行中変わらないため実害は無いが、出所を 1 本化する。
  // openUrl は openExternalUrlSafe を直接ではなく openTerminalLinkUrl 経由で渡す
  // （開いた直後の「開きました」トーストを橋渡しするラッパー。開く経路自体は増やしていない）。
  // getClickMode は実行時に terminalLinkClickModePref（生きたグローバル変数）を読む関数で
  // 渡す。ツールチップ文言（termLinkTooltipMessage）も同じ変数を実行時に読んでおり、
  // 参照経路を1本化するため、生成時点の固定値スナップショットは渡さない
  // （レビュー指摘・LOW-2）。wasPaneFocused / wasDragged はこの paneId に閉じたクロージャで、
  // それぞれ paneFocusBeforeMousedown（.pane / .stash-item の mousedown ハンドラが記録）・
  // lastClickWasDrag（document の mousedown/mouseup capture リスナーが記録）を参照する
  // （issue #385）。
  term.registerLinkProvider(createTerminalLinkProvider(term, createTerminalLinkHandlers({
    openUrl: openTerminalLinkUrl,
    showTooltip: showTermLinkTooltip,
    hideTooltip: hideTermLinkTooltip,
    isMac: IS_MAC_PLATFORM,
    getClickMode: () => terminalLinkClickModePref,
    wasPaneFocused: () => paneFocusBeforeMousedown.get(paneId) === true,
    wasDragged: () => lastClickWasDrag,
  })));

  // OSC 0 / OSC 2 のタイトル変更を購読してペイン上部のタスクタイトル行に反映する。
  // 例: `printf '\033]0;ビルド中\007'` をシェルで実行すると "ビルド中" がここに表示される。
  // ここで書き込むのは OSC 由来の taskTitle のみ。API（POST /api/set-title）由来の
  // apiTitle が設定されている間はそちらが優先表示される（updatePaneTitle 参照）。
  term.onTitleChange((title) => {
    const t = terminals[paneId];
    if (!t) return;
    t.taskTitle = title || '';
    updatePaneTitle(paneId);
  });

  // 共通の入力送信ヘルパー（waiting バッジのクリアを含む）
  function sendTerminalInput(data) {
    VKIpc.send('terminal:input', termId, data);
    markPaneInput(paneId);
  }

  // Shift+Enter を改行として送信（Claude Code の keybindings.json 対応）
  term.attachCustomKeyEventHandler((ev) => {
    if (ev.key === 'Enter' && ev.shiftKey && !ev.ctrlKey && !ev.altKey && !ev.metaKey) {
      if (ev.type === 'keydown') {
        // CSI u エンコーディングで Shift+Enter を送信
        sendTerminalInput('\x1b[13;2u');
      }
      return false; // keydown / keypress 両方でデフォルト処理を抑止
    }
    return true;
  });

  const element = document.createElement('div');
  element.className = 'term-viewport';
  // NOTE: term.open(element) is called later, after element is attached to DOM

  // IME 合成開始時にビューポートを最下部（入力行）へスクロールし、カーソルを可視領域に入れる。
  // xterm の updateCompositionElements() は isCursorInViewport（ybase+y-ydisp が可視範囲内）が
  // 真のときだけ .xterm-helper-textarea をカーソル位置へ動かすため、通常バッファのシェルで
  // スクロールアップしたまま日本語入力を始めると textarea が画面外の既定位置に残り、変換候補
  // ウィンドウが入力行から離れた場所に出てしまう。これを防ぐ防御的措置（claude 等の代替バッファ
  // アプリでは ydisp=0 で常に可視のため no-op）。祖先要素の capture フェーズで拾うことで xterm
  // 自身の textarea ハンドラより先にスクロールを確定させる。
  // ※「変換候補がペイン左上に出る」不具合の本因は xterm.css の読み込み失敗（ファイル冒頭の
  //   「xterm.css の注入」コメント参照）であり、このリスナはその修正ではない。
  element.addEventListener('compositionstart', () => {
    try { term.scrollToBottom(); } catch (_e) {}
  }, true);

  // Input: terminal -> pty
  term.onData((data) => {
    sendTerminalInput(data);
  });

  const shortCwd = formatCwd(initialCwd);

  terminals[paneId] = {
    termId,
    term,
    fitAddon,
    element,
    opened: false,
    cwd: shortCwd,
    cwdFull: initialCwd,
    waiting: false,
    // externalWaiting: オーケストレーター等が POST /api/set-status で明示 push する外部権威の入力待ちフラグ。
    // ローカル PTY 検知(waiting)と OR で status に合流する。markPaneInput / リサイズ / 再描画 /
    // 自動入力では解除されず、明示的な false push でのみ解除される。
    externalWaiting: false,
    // status: 表示用ステータス。issue #23 で追加。
    // 初期値 'idle' は何も表示しない（.pane-status[data-status="idle"] は display:none）。
    status: 'idle',
    // runningTimer: 'running' を 1500ms 後に 'idle' に戻すタイマー id。
    // recomputeStatus() / bumpRunning() が張り直す。closePane() で必ず clearTimeout する。
    runningTimer: null,
    // waitingCheckTimer: 静止ゲートの判定タイマー id（issue vektor-inc/vk-orchestrator#212）。
    //   PTY 出力のたびに張り直し、出力が止まった時点（または上限間隔ごと）に
    //   checkWaiting() を走らせる。closePane() / initApp() で必ず clearTimeout する。
    // waitingPendingSince: 前回の判定以降、最初に出力を受け取った時刻。
    //   判定間隔の上限（WAITING_MAX_EVAL_INTERVAL_MS）の起点。
    // lastWaitingBeepAt: 最後に入力待ちのビープを鳴らした時刻（連続再生の抑止）。
    // localWaitingOnset: ローカル判定（checkWaiting）で waiting が false → true に転じた
    //   瞬間のスナップショット { at, lastOutputTime }（issue #270）。e2e から静止ゲートの
    //   実効を確かめるためだけの記録で、アプリの挙動には一切使わない。未点灯なら null、
    //   再点灯のたびに上書きする（解除時のクリアは不要 = 次の点灯で必ず上書きされる）。
    // waitingOnsetMatch: 現在の waiting=true の根拠になっている実際のマッチ文字列
    //   （findWaitingMatch の返り値。前後の文脈込み）。localWaitingOnset とは違い、
    //   checkWaiting() の解除判定そのものに使う実体（issue #352）。
    //   静止評価・非マッチのときにこの文字列が lastLines から空白無視で見えなくなって
    //   いれば自動解除する。マッチするたびに最新の文字列へ更新し、waiting が false に
    //   戻ったら（除外・上限評価での解除・onsetStillVisible による解除・markPaneInput
    //   のいずれでも）null に戻す。根拠が未記録のまま waiting=true が続く場合は
    //   checkWaiting() が毎回 t.lastLines への再探索（backfill）を試み、拾えた時点で
    //   ここに記録する（司の指摘・#352 の再レビュー。詳細は checkWaiting 内のコメント
    //   参照）。
    // waitingOnsetKey: waitingOnsetMatch と同じタイミングで更新する、
    //   stripVolatileForKey(waitingOnsetMatch)（数字だけを潰した文字列）。
    //   ビープの長期抑制（lastBeepedOnsetKey との比較）専用（issue #352 の再レビュー・
    //   司と安藤の実測で発覚）。waitingOnsetMatch をそのまま抑制の鍵にすると、
    //   vk-orchestrator の常駐ログのように前後の文脈（termId 等）が毎回変わる出力で
    //   鍵も毎回変わり長期抑制が一度も適用されない。一方、数字を潰すだけでなく
    //   正規表現の一致範囲そのもの（m[0]）まで丸めると判別力が無くなり、内容の
    //   異なる本物の確認どうしを同一視してしまう（stripVolatileForKey のコメント参照）。
    // lastBeepedOnsetKey: 直前にビープを鳴らしたときの waitingOnsetKey のスナップ
    //   ショット（issue #352・植草のレビュー）。次にビープが必要になったとき、今回の
    //   waitingOnsetKey と空白・罫線を無視して同一なら「同じ誤検知の点滅」とみなし、
    //   通常より長い猶予（WAITING_BEEP_REPEAT_SUPPRESS_MS）で抑止する
    //   （shouldBeepForWaiting 参照）。markPaneInput で null に戻す。
    waitingCheckTimer: null,
    waitingPendingSince: 0,
    lastWaitingBeepAt: 0,
    localWaitingOnset: null,
    waitingOnsetMatch: null,
    waitingOnsetKey: null,
    lastBeepedOnsetKey: null,
    lastLines: '',
    // recentLines: 前回の waiting 評価以降に届いた出力だけを貯めるバッファ。
    //   上限評価（出力が流れている最中の判定）で使う。lastLines と同じ上限でトリムする。
    recentLines: '',
    lastOutputTime: Date.now(),
    lastInputTime: 0,
    // taskTitle: xterm の OSC 0/2 由来のタイトル（claude TUI 等が継続的に発行する）
    // apiTitle:  HTTP API（POST /api/set-title）で明示的にセットされたタイトル
    // apiUrl:    HTTP API（POST /api/set-title）で渡された URL（issue #29）。
    //            apiTitle が表示されているときのみ、タイトル全体をリンク化する。
    //            taskTitle（OSC 由来）の表示時は URL を一切表示しない。
    // apiPrUrl:  HTTP API（POST /api/set-title）で渡された PR URL（issue #44）。
    //            タスクタイトル行の右側に独立した [ PR ↗ ] ボタンとして表示する。
    //            apiTitle / taskTitle のいずれが表示中でも常時表示する（採用: 案A）。
    // 表示時は apiTitle を優先し、空のときに taskTitle へフォールバックする。
    // これにより task-queue 等が指定した issue タイトルが OSC 由来の文字列で
    // 上書きされなくなる（issue #22）。
    taskTitle: '',
    apiTitle: '',
    apiUrl: '',
    apiPrUrl: '',
    // apiPrMerged: HTTP API（POST /api/set-title）で渡された PR のマージ済み状態。
    apiPrMerged: false,
    // apiWaitingMerge（issue #363）: HTTP API（POST /api/set-title）で渡された
    // PR のマージ待ち状態。ワイヤ上のフィールド名は送信側（vk-orchestrator#389）の
    // 実装に合わせて `waitingMerge`（`prWaitingMerge` ではない）。
    // apiPrMerged が true のときはこちらより優先される
    // （マージ済みが最終状態のため。優先順位の実装は getPrBadgePresentation 側）。
    apiWaitingMerge: false,
    // agentRoom（issue #58）: POST /api/agentroom で受け取ったルーム状態 { name: state }。
    //   null のままなら API 未通知。API が古い（AGENTROOM_API_TTL_MS 超過）場合は
    //   resolveRoomAgents() が PTY 出力ベースのフォールバック表示に切り替える。
    // agentRoomUpdatedAt: 最後に API でルーム状態を受け取った時刻（鮮度判定用）。
    // agentRoomOpen: アコーディオンの開閉状態（再 render をまたいで保持）。
    agentRoom: null,
    agentRoomUpdatedAt: 0,
    agentRoomOpen: false,
    lock: null,
  };

  return paneId;
}

function formatCwd(fullPath) {
  if (!fullPath) return '~';
  const home = fullPath.match(/^(\/Users\/[^/]+)/)?.[1] || '';
  const relative = home ? fullPath.replace(home, '~') : fullPath;
  const parts = relative.split('/').filter(Boolean);
  if (parts.length <= 3) return relative || '/';
  return '~/' + parts.slice(-2).join('/');
}

// ─── HTML escape helpers ──────────────────────────────────────────────────────
// renderLeaf() などで innerHTML テンプレートリテラルに外部由来の文字列を挿入する際の
// XSS 対策ヘルパー（issue #39）。
//
// なぜ必要か:
//   - cwd は OS ファイルシステム由来（通常は安全だがディレクトリ名に `"` や `<` を含めることは技術的に可能）
//   - statusAriaLabel は現状内部状態のみだが、将来 API 連携等で外部入力と統合される可能性があるため
//     防御的にエスケープしておく
//
// 設計方針:
//   - escText: テキストコンテンツ用（`<`, `>`, `&` をエスケープ）
//   - escAttr: 属性値用（`<`, `>`, `&`, `"`, `'` をエスケープ。属性は常にダブルクォートで囲む前提）
//   - 入力が文字列でない場合は空文字を返す（null/undefined の安全側フォールバック）
//   - 既知の安全な静的リテラル（ボタンの title 属性など）には適用しない（差分最小化）
function escText(value) {
  if (typeof value !== 'string') return '';
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escAttr(value) {
  if (typeof value !== 'string') return '';
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ─── IPC: data from pty ───────────────────────────────────────────────────────
VKIpc.on('terminal:data', (id, data) => {
  const paneId = Object.keys(terminals).find(k => terminals[k]?.termId === id);
  if (!paneId || !terminals[paneId]) return;

  const t = terminals[paneId];
  t.term.write(data);

  // Parse OSC 7 (shell cwd report: \e]7;file://host/path\a)
  const osc7 = data.match(/\x1b\]7;file:\/\/[^/]*([^\x07\x1b]+)[\x07\x1b]/);
  if (osc7) {
    const fullPath = decodeURIComponent(osc7[1]);
    t.cwdFull = fullPath;
    t.cwd = formatCwd(fullPath);
    updatePaneCwd(paneId, t.cwd);
  }

  // Accumulate last lines for waiting detection
  t.lastLines = appendWaitingBuffer(t.lastLines, data);
  // 上限評価（出力が流れている最中の判定）用に、前回の評価以降の出力も別に貯める。
  // checkWaiting() が評価のたびにリセットする（issue vektor-inc/vk-orchestrator#212）。
  t.recentLines = appendWaitingBuffer(t.recentLines, data);
  t.lastOutputTime = Date.now();
  // 判定は出力が静止してから行う（即時判定はしない）。
  scheduleWaitingCheck(paneId);
  // 出力があったので running を bump（waiting / 入力直後はスキップされる）
  bumpRunning(paneId);
});

VKIpc.on('terminal:exit', (id) => {
  const paneId = Object.keys(terminals).find(k => terminals[k]?.termId === id);
  if (paneId) closePane(paneId, { force: true });
});

// ─── DOM updates (without full re-render) ────────────────────────────────────
function updatePaneCwd(paneId, cwd) {
  const el = document.querySelector(`.pane[data-id="${paneId}"] .pane-cwd`);
  if (el) el.textContent = cwd;
  // 格納中のコンパクト表示の cwd も同期する（issue #89）。
  const stashCwd = document.querySelector(`.stash-item[data-id="${paneId}"] .stash-item-cwd`);
  if (stashCwd) {
    stashCwd.textContent = cwd;
    stashCwd.title = cwd;
  }
}

// API（POST /api/set-title）由来のタイトルを最優先で表示し、未設定なら OSC 0/2 由来の
// taskTitle にフォールバックする。空文字を API に送れば apiTitle がクリアされ、OSC
// タイトルがそのまま見えるようになる（後方互換）。
function getDisplayTitle(t) {
  if (!t) return '';
  return t.apiTitle || t.taskTitle || '';
}

// 表示中のタイトルにリンクを付けるべきか判定する。
//   - apiTitle が選ばれている（apiTitle が非空）かつ
//   - apiUrl が設定されている（http(s) スキームは main 側で検証済み）
// 時のみ true。OSC 由来の taskTitle 表示時はリンク化しない。
function getDisplayUrl(t) {
  if (!t) return '';
  if (!t.apiTitle) return '';
  return t.apiUrl || '';
}

// http(s): スキームのチェック（renderer 側の二段構えバリデーション）。
// 外部ブラウザを開く直前に念のため再チェックする。ただし最終防衛線はこれではなく
// main プロセス側の再検証（ipcMain.handle('shell:open-external')／issue #268）。
// renderer 側の判定はすり抜けても、main が http(s) 以外を開くことはない。
function isSafeExternalUrl(url) {
  return isSafeHttpUrl(url);
}

// ─── 汎用トースト（issue #326） ───────────────────────────────────────────────
// 外部ブラウザを開けなかったときの失敗フィードバック。document.body 直下（#root の
// 外）に 1 つだけ常設し、呼び出し箇所（サイドバーメニュー／タスクリスト／ペインの
// タイトル・PR バッジ／設定モーダルの説明リンク）ごとに吹き出しを出さない。
//
// #root の外（document.body 直下）に置く理由（安藤レビュー指摘・issue #326）:
//   - render()（下記）は #root の子を root.replaceChildren() で丸ごと差し替える。
//     #root の内側にトーストを置くと、ペイン追加・移動・格納のたびに DOM から
//     外れる。ensureExternalUrlToast() のキャッシュ短絡がそのまま切り離し済み
//     ノードを返すため、以後アプリを再起動するまで二度と表示されなくなる。
//   - #root は position: fixed で独自の重なり文脈を作るため、内側の要素は
//     document.body 直下の設定モーダル（.settings-overlay, z-index 2000）・
//     閉じる確認ダイアログ（.confirm-overlay, z-index 2100）より前面に出られない。
//     さらにモーダル表示中は renderer/focusTrap.js の applyInert が #root（body
//     直下の子）へ inert を付けるため、内側のトーストは操作不可・支援技術からも
//     除外される。設定モーダル内の説明リンクが失敗したときにこそ見える必要が
//     あるので、これでは本末転倒になる。
// body 直下へ挿入する分、focusTrap.js 側にも「この要素は inert の対象から除外する」
// 仕組み（data-vk-inert-exempt 属性）を追加している（同ファイル参照）。
//
// 挿入位置は body の先頭（#root より前）にする。#root の内側はペイン数に応じて
// 無数の Tab 停止点があり、末尾に置くとクリックした場所によっては Tab で辿り着く
// までの距離が非常に長くなる（植草レビュー指摘）。DOM 順で先頭に固定することで、
// 少なくとも「ページ先頭から」の距離を一定に保つ（クリック位置からの距離そのものを
// 短縮する手段は、出現時にフォーカスを奪わない制約の中では無い）。
//
// 成功時は基本的に何も出さない（ブラウザが実際に開くこと自体がフィードバックのため）。
// 例外はペイン内 URL クリック（openTerminalLinkUrl 経由）で、issue #385 でこの同じ
// トースト基盤を再利用して遷移先ホスト名を知らせる「◯◯ を開きました」を出すように
// なった（showTerminalLinkOpenedToast 参照）。それ以外の呼び出し元（サイドバーメニュー
// 等）は従来どおり成功時に何も出さない。
let externalUrlToastLayerEl = null; // document.body 直下へ挿入する外側コンテナ（pointer-events: none）
let externalUrlToastEl = null; // 実際に見える箱（pointer-events: auto）。中身の差し替えはこちらへ行う
let externalUrlToastDismissTimer = null;
let externalUrlToastCopyUrl = '';
// ホバー中・フォーカス中は自動消去しない（キーボードでコピーボタンへ辿り着く前に
// 消えないようにするため）。要求仕様は「ホバー中 OR フォーカス中」の論理和なので、
// 単一フラグの後勝ちにせず 2 つを別々に持つ。片方だけが終わってももう片方が続いて
// いれば保持し続ける（安藤レビュー指摘・高3。単一フラグだと、ホバーしたまま Tab で
// コピーボタンへ移った後にポインタだけ外へ動かすと、フォーカスが残っているのに
// 保持が解けてタイマーが再開してしまっていた）。
let externalUrlToastHovered = false;
let externalUrlToastFocusWithin = false;
const EXTERNAL_URL_TOAST_AUTO_DISMISS_MS = 5000;
const EXTERNAL_URL_TOAST_FAILED_MESSAGE = 'ブラウザを開けませんでした';
const EXTERNAL_URL_TOAST_COPY_LABEL = 'URLをコピー';
// 可視ラベル「URLをコピー」を先頭に含める（WCAG 2.5.3 Label in Name）。
// settingsCopyButtonLabel() と同じ考え方。
const EXTERNAL_URL_TOAST_COPY_ARIA_LABEL = '開けなかったURLをコピー';

function clearExternalUrlToastTimer() {
  if (externalUrlToastDismissTimer) {
    clearTimeout(externalUrlToastDismissTimer);
    externalUrlToastDismissTimer = null;
  }
}

function externalUrlToastShouldHoldOpen() {
  return externalUrlToastHovered || externalUrlToastFocusWithin;
}

// 「保持すべきか（ホバー中 OR フォーカス中）」をそのつど再評価し、保持すべきでなければ
// 5 秒後に自動で閉じるタイマーを（再）セットする。イベントハンドラ側は状態フラグを
// 更新したあと必ずこれを呼ぶ。
function reconsiderExternalUrlToastTimer() {
  clearExternalUrlToastTimer();
  if (externalUrlToastShouldHoldOpen()) return;
  externalUrlToastDismissTimer = setTimeout(() => {
    hideExternalUrlToast();
  }, EXTERNAL_URL_TOAST_AUTO_DISMISS_MS);
}

function hideExternalUrlToast() {
  clearExternalUrlToastTimer();
  if (externalUrlToastEl) externalUrlToastEl.hidden = true;
  externalUrlToastCopyUrl = '';
  // 非表示にする瞬間、ポインタがまだ乗っている／フォーカスが中にある状態でも
  // mouseleave / focusout が必ず飛んでくるとは限らない（display:none 化や、成功時に
  // 別経路から hideExternalUrlToast() を呼ぶケース）。フラグを持ち越すと次回表示時に
  // 自動消去が働かなくなるため、ここで明示的にリセットする
  // （安藤レビュー指摘・低1）。
  externalUrlToastHovered = false;
  externalUrlToastFocusWithin = false;
}

function setExternalUrlToastMessage(text) {
  if (!externalUrlToastEl) return;
  const messageEl = externalUrlToastEl.querySelector('.vk-toast-message');
  if (messageEl) messageEl.textContent = text;
}

// document.body へ 1 度だけトースト DOM を生やす（以後は使い回す）。
function ensureExternalUrlToast() {
  // isConnected を見るのは保険（安藤レビュー指摘）。#root の作り替え（render()）は
  // body 直下のこのノードには触れないため通常は起きないが、万一 body から
  // 切り離されていた場合に、切り離し済みノードをそのまま返して二度と表示されなく
  // なる事故を防ぐ。
  if (externalUrlToastLayerEl && externalUrlToastLayerEl.isConnected) return externalUrlToastEl;

  const body = document.body;
  if (!body) return null;

  if (externalUrlToastLayerEl) {
    // 同じノードを付け直すだけにする（中身は保持済みなので作り直さない）。
    body.insertBefore(externalUrlToastLayerEl, body.firstChild);
    return externalUrlToastEl;
  }

  const layer = document.createElement('div');
  layer.className = 'vk-toast-layer';
  // document.body 直下だと確認ダイアログ（.confirm-overlay / .confirm-modal）より
  // 前面に来る（z-index 2200 > 2100）。外側コンテナは常に pointer-events: none にし、
  // トーストの表示領域以外がダイアログのクリックを吸わないようにする（安藤レビュー
  // 指摘・高）。実際に見える箱（.vk-toast）側の pointer-events は固定 auto ではなく、
  // コピーボタンの有無（操作できる部品があるか）に応じて動的に切り替える
  // （setExternalUrlToastInteractive 参照。issue #385 レビュー指摘）。
  // focusTrap.js の applyInert が body 直下の子へ inert を付けて回るため、この要素は
  // その対象から除外してもらう目印を付ける（同ファイル参照）。
  layer.setAttribute('data-vk-inert-exempt', '');

  const toast = document.createElement('div');
  toast.className = 'vk-toast';
  // 割り込まないトーン。.settings-inline-notice / .task-list-stale と同じ
  // role="status" / aria-live="polite" にする（alert ではなく polite）。
  toast.setAttribute('role', 'status');
  toast.setAttribute('aria-live', 'polite');
  toast.hidden = true;

  const message = document.createElement('p');
  message.className = 'vk-toast-message';
  toast.appendChild(message);

  const copyButton = document.createElement('button');
  copyButton.type = 'button';
  copyButton.className = 'vk-toast-copy';
  copyButton.textContent = EXTERNAL_URL_TOAST_COPY_LABEL;
  copyButton.setAttribute('aria-label', EXTERNAL_URL_TOAST_COPY_ARIA_LABEL);
  copyButton.addEventListener('click', async () => {
    // コピーは押したときだけ行う（自動コピーは、利用者が別の内容をコピーしていた
    // 場合に無断で上書きしてしまうため行わない）。
    let ok = false;
    try {
      // navigator.clipboard ではなく VKClipboard.writeText を使う理由は
      // 4140 行目付近のコメント（file:// では secure context 判定に依存するため）と同じ。
      ok = await VKClipboard.writeText(externalUrlToastCopyUrl);
    } catch (_e) {
      ok = false;
    }
    // 語尾は既存のコピー結果表示（コピーしました／コピーできませんでした）に揃える。
    setExternalUrlToastMessage(ok ? 'URLをコピーしました' : 'コピーできませんでした');
  });
  toast.appendChild(copyButton);

  toast.addEventListener('mouseenter', () => {
    externalUrlToastHovered = true;
    reconsiderExternalUrlToastTimer();
  });
  toast.addEventListener('mouseleave', () => {
    externalUrlToastHovered = false;
    reconsiderExternalUrlToastTimer();
  });
  toast.addEventListener('focusin', () => {
    externalUrlToastFocusWithin = true;
    reconsiderExternalUrlToastTimer();
  });
  toast.addEventListener('focusout', (event) => {
    // フォーカスがトースト内の別要素へ移るだけなら維持する。
    if (toast.contains(event.relatedTarget)) return;
    externalUrlToastFocusWithin = false;
    reconsiderExternalUrlToastTimer();
  });

  layer.appendChild(toast);
  // #root より前（body の先頭）に挿入する（理由は冒頭コメント参照）。
  body.insertBefore(layer, body.firstChild);

  externalUrlToastLayerEl = layer;
  externalUrlToastEl = toast;
  return toast;
}

// トースト内に操作できる部品（コピーボタン）があるかどうかで、トースト自身の
// pointer-events を切り替える（issue #385 レビュー指摘。麗美の e2e で発見）。
//
// issue #385 でリンクを開くたびに毎回「◯◯ を開きました」トーストを出すようになった
// 結果、従来は「開けなかったとき」など稀にしか出なかった .vk-toast の露出が桁違いに
// 増えた。.vk-toast は pointer-events: auto（コピーボタンを押せるようにするため）かつ
// 画面右下に最大 EXTERNAL_URL_TOAST_AUTO_DISMISS_MS（5秒）居座るため、そこにたまたま
// 別の URL が重なっていると、リンクを開いた直後にその URL をクリックしてもトーストに
// 吸われてターミナルへ届かず「クリックしても何も起きない」という、この PR が改善
// しようとしている操作そのものを壊す不具合になっていた（実測で document.elementFromPoint
// がターミナルではなくトースト内の要素を返すことを確認済み）。
//
// 対処方針は .term-link-tooltip と同じ（renderer/style.css の同要素のコメント参照）:
// 操作できる部品が無いときは pointer-events: none にしてクリックを下（ターミナル）へ
// 素通りさせる。コピーボタンを持つ失敗トースト（showExternalUrlOpenFailedToast）は
// ボタンが押せなくなるため対象外とし、常時 pointer-events: auto のままにする。
// トーストの箱を固定で none にはせず、CSS クラス（.vk-toast--interactive）の有無で
// 都度切り替える。新しいトースト実装は増やさない（既存の .vk-toast インフラを流用）。
function setExternalUrlToastInteractive(toast, interactive) {
  toast.classList.toggle('vk-toast--interactive', interactive);
}

// 外部ブラウザを開けなかったときに呼ぶ。同時発生時は積み上げず、前のトーストを
// 新しい内容で上書きする（積み上げると読み上げが渋滞するため）。
// 出現時にフォーカスは奪わない（操作中の要素にフォーカスを残す）。
function showExternalUrlOpenFailedToast(url) {
  const toast = ensureExternalUrlToast();
  if (!toast) return;
  const copyButton = toast.querySelector('.vk-toast-copy');
  if (copyButton) copyButton.hidden = false;
  // コピーボタンを持つため、クリックを透過させない（上の setExternalUrlToastInteractive
  // のコメント参照）。
  setExternalUrlToastInteractive(toast, true);
  externalUrlToastCopyUrl = url;
  setExternalUrlToastMessage(EXTERNAL_URL_TOAST_FAILED_MESSAGE);
  toast.hidden = false;
  reconsiderExternalUrlToastTimer();
}

// コピー対象を伴わない汎用メッセージ用（issue #380: 設定コンテンツテーブルの一括切り替え
// 結果の要約、issue #385: ペイン内 URL クリックの「開きました」など）。同じ .vk-toast
// インフラ（issue #326）を再利用し、URL コピー専用のボタンだけ隠す。「呼び出し箇所ごとに
// 吹き出しを出さない」という汎用トーストの設計方針（冒頭コメント参照）どおり、新しい
// トースト実装は増やさない。
function showGenericToast(message) {
  const toast = ensureExternalUrlToast();
  if (!toast) return;
  const copyButton = toast.querySelector('.vk-toast-copy');
  if (copyButton) copyButton.hidden = true;
  // 操作できる部品が無いため、クリックを下（ターミナル等）へ透過させる（上の
  // setExternalUrlToastInteractive のコメント参照。issue #385 レビュー指摘）。
  setExternalUrlToastInteractive(toast, false);
  externalUrlToastCopyUrl = '';
  setExternalUrlToastMessage(message);
  toast.hidden = false;
  reconsiderExternalUrlToastTimer();
}

// 外部ブラウザで開く処理を共通化したヘルパー。
// http(s) チェック → preload 経由で main に openExternal を依頼する。
// 失敗（false 解決 / reject / 同期 throw のいずれか）は汎用トーストで知らせる（issue #326）。
// 成功時に新たなトーストを出さない方針は変えないが、直前の失敗トーストが表示中の
// ままだとコピー対象の URL がずれる（開けなかった URL と別の URL が残る）ため、
// 成功時は表示中のトーストを消す（安藤レビュー指摘・中）。
// click ハンドラ用に preventDefault / stopPropagation 済みである前提。
//
// options.onSuccess: 成功時に hideExternalUrlToast() の後に呼ぶ任意のコールバック
// （issue #385）。ペイン内 URL クリック（openTerminalLinkUrl）専用の「開きました」トースト
// 表示に使う。他の呼び出し元（サイドバーメニュー等）は指定しないため挙動は変わらない。
//
// 【内部専用・レビュー指摘・LOW-1】この関数は ensureWidgetViewController()（本ファイル
// 内。widgetView.js へ渡す openUrl 依存の生成元）や widgetView.js の wireExternalLink()
// のように、汎用の 1 引数コールバック
// openUrl(url) としても複数箇所へ配られている。それらの呼び出し元は現状すべて
// openUrl(url) の 1 引数でしか呼んでいないため実害は無いが、options はあくまで
// openTerminalLinkUrl() からの内部専用の呼び出し規約であり、汎用の openUrl(url)
// コールバック契約の一部ではない。将来どこかの呼び出し元が第2引数を forward するよう
// 変更すると、意図しない onSuccess が意図しない場面で発火しうる。第2引数を追加で
// 使いたくなったら、こちらを直接拡張せず openTerminalLinkUrl() のような専用ラッパーを
// 増やすこと。
function openExternalUrlSafe(url, options = {}) {
  if (!isSafeExternalUrl(url)) return;
  const onSuccess = typeof options.onSuccess === 'function' ? options.onSuccess : null;
  try {
    // 戻り値は Promise（成否の boolean）。reject 時にハンドラがないと unhandled rejection に
    // なるため明示的にハンドリングする。同期 throw もありうるので try/catch でも包む。
    const p = VKShell.openExternal(url);
    if (p && typeof p.then === 'function') {
      p.then((ok) => {
        if (ok === true) {
          hideExternalUrlToast();
          if (onSuccess) onSuccess();
        } else {
          showExternalUrlOpenFailedToast(url);
        }
      }, () => {
        showExternalUrlOpenFailedToast(url);
      });
    }
  } catch (_e) {
    showExternalUrlOpenFailedToast(url);
  }
}

// ─── ペイン内 URL のクリックで開く（issue #349 → #385） ───────────────────────────
// URL の検出・バッファ範囲への変換は renderer/terminalLinkProvider.js（xterm.js の
// registerLinkProvider を自前実装したもの）が担い、ここでは「どう開くか」
// （クリック判定・ツールチップ表示・トースト表示）だけを扱う。実際に開く経路は
// openExternalUrlSafe をそのまま使う（新しい経路を増やさない。植草の確定仕様）。
//
// 元々（issue #349）は単クリックでは開かず、Cmd（macOS）/ Ctrl（Windows・Linux）+
// クリックのときだけ開く仕様だった（ターミナルのドラッグ選択との誤爆を防ぐ狙い）。
// issue #385（オーナー本人の要望）で「修飾キー無しの単クリックで開く」を既定へ変更し、
// 従来の修飾キー必須挙動は設定（terminalLinkClickModePref）で選べるようにした。
//
// 【訂正・レビュー指摘 HIGH-2】この段落には以前「xterm.js 側の Linkifier は mousedown
// 時点のリンクと mouseup 時点のリンクが一致したときだけ activate を呼ぶため、単クリック
// にしてもドラッグ選択とは元々衝突しない」という記述があったが、これは誤り。この一致
// 条件は「別々のリンクをまたぐドラッグ」は確かに弾くが、「同一リンクの中だけをなぞって
// 選択する」操作（＝ URL をコピーしようとする典型的な操作）は mousedown 時のリンクと
// mouseup 時のリンクが同じ 1 個のリンクのままなので、この条件を普通に満たしてしまう。
// つまり URL をコピーしようとドラッグしただけでブラウザが開いてしまう（#349 で植草が
// 避けたかった誤爆そのもの）。この誤った前提のまま実装を進めたのが今回のレビューで
// 見つかった穴（HIGH-2）で、mousedown → mouseup の移動量を自前で計測する
// lastClickWasDrag / wasDragged() のガードで塞いでいる（下記参照）。また、xterm.js の
// Linkifier は event.button も見ずに activate を呼ぶため、右クリック・中クリックでも
// 開いてしまう穴（HIGH-1）もあり、utils/terminalLinkPolicy.js の activate() 冒頭で
// event.button を弾くガードを追加した。後から読む人がこの誤りを踏襲しないよう、
// 実装（utils/terminalLinkPolicy.js）側のコメントに詳細を書いてある。
//
// また矩形選択の修飾キーは Alt（xterm.js 本体の SelectionService.shouldColumnSelect）
// であり、'modifier' モードで使う Cmd（macOS）/ Ctrl（Windows・Linux）とは別のキーの
// ため競合しない（これは今回の指摘の対象ではない、独立した事実）。
//
// クリック判定（isMacPlatform / isLinkOpenModifierPressed / normalizeTerminalLinkClickMode /
// createTerminalLinkHandlers）は utils/terminalLinkPolicy.js の UMD へ切り出してある。
// この機能で最もセキュリティに効く分岐（フォーカス未取得ペインへの最初のクリックや、
// 'modifier' モードでの修飾キー無しクリック、右クリック・中クリック、ドラッグ選択では
// 絶対に外部 URL を開かせない）を renderer/app.js の非エクスポート関数のままにせず、
// tests/terminalLinkPolicy.test.js から直接ユニットテストできるようにするため
// （安藤レビュー指摘・MEDIUM）。
const { isMacPlatform, createTerminalLinkHandlers, normalizeTerminalLinkClickMode, isDragDistance } = window.VKTerminalLinkPolicy;
const IS_MAC_PLATFORM = isMacPlatform();
// 'modifier' モード専用のラベル（'click' モードでは使わない。termLinkTooltipMessage 参照）。
const TERM_LINK_MODIFIER_LABEL = IS_MAC_PLATFORM ? '⌘+クリックで開く' : 'Ctrl+クリックで開く';

// openExternalUrlSafe(url) のラッパー。ペイン内 URL クリックで開いたときだけ、
// 開いた直後に短いトーストで知らせる（issue #385）。サイドバーメニューなど他の
// openExternalUrlSafe 呼び出し元の挙動は変えないため、ここでだけ onSuccess を渡す。
function openTerminalLinkUrl(url) {
  openExternalUrlSafe(url, {
    onSuccess: () => showTerminalLinkOpenedToast(url),
  });
}

// 開いたことを知らせるトースト文言を出す。既存のトースト基盤（showGenericToast /
// ensureExternalUrlToast）を再利用し、新しいトースト実装は増やさない。取り消しボタンは
// 付けない（shell.openExternal で開いたタブをアプリ側から閉じられず、機能しないボタンに
// なるため）。
function showTerminalLinkOpenedToast(url) {
  const host = getUrlHost(url);
  showGenericToast(host ? `${host} を開きました` : '外部リンクを開きました');
}

// ホバー中のツールチップ本体。全ペイン共通で 1 つだけ用意し、都度使い回す
// （externalUrlToast と同じ考え方。document.body 直下に置き、#root の render() による
// 差し替えの影響を受けないようにする）。
let termLinkTooltipEl = null;

function ensureTermLinkTooltip() {
  if (termLinkTooltipEl) return termLinkTooltipEl;
  const el = document.createElement('div');
  el.className = 'term-link-tooltip';
  // マウス追従のみの補助表示で、キーボード操作でも読み上げでも到達できないため
  // 支援技術には見せない（Cmd/Ctrl+クリック自体がポインタ操作前提の機能のため）。
  el.setAttribute('aria-hidden', 'true');
  el.hidden = true;
  document.body.appendChild(el);
  termLinkTooltipEl = el;
  return el;
}

// ツールチップの文言。遷移先ホストを表示する（安藤レビュー指摘・MEDIUM）。
//
// ターミナル出力は攻撃者が内容を制御しうる前提のため、「⌘+クリックで開く」という
// 固定文言だけでは、ユーザーが実際の行き先を検証する手段が本文の目視しかなかった
// （例: 見た目は https://github.com/... に見えても実体は
// https://github.com@evil.example/login というユーザー情報付き URL で、実ホストは
// evil.example ということがありうる）。new URL(url).host（VKUrlLinkify.getUrlHost）で
// 解決した後のホストをツールチップに出すことで、表示テキストに惑わされず実際の行き先を
// 確認できるようにする。なお renderer/urlLinkify.js の extractUrlMatches はユーザー情報
// 付き URL 自体をそもそもリンク化しないため、ここに渡ってくる url は通常そのケースには
// 該当しないが、ツールチップ自体は「実ホストを見せる」という独立した防御として残す。
//
// 遷移先ホストの表示は 'click' / 'modifier' の両モードで残す（issue #385）。単クリック化で
// クリックの心理的ハードルが下がるぶん、なりすまし対策としての重要度がむしろ上がるため
// （安藤のセキュリティ指摘）。'click' モードは予告文（「◯◯ を開きます」）にし、クリックしろと
// 指示する文にはしない。'modifier' モードは従来どおり TERM_LINK_MODIFIER_LABEL を使う。
function termLinkTooltipMessage(url) {
  const host = getUrlHost(url);
  if (terminalLinkClickModePref === 'modifier') {
    return host ? `${host} を ${TERM_LINK_MODIFIER_LABEL}` : TERM_LINK_MODIFIER_LABEL;
  }
  return host ? `${host} を開きます` : '開きます';
}

// カーソル位置の近くにツールチップを表示する。pointer-events: none にしてあるため
// （style.css 参照）、このツールチップ自身が xterm.js 側のホバー判定（マウス位置の
// 追跡）を奪うことはない。textContent で入れる（innerHTML は使わない。url はターミナル
// 出力由来で攻撃者が内容を制御しうるため）。
function showTermLinkTooltip(event, url) {
  const el = ensureTermLinkTooltip();
  el.textContent = termLinkTooltipMessage(url);
  const OFFSET = 12;
  el.hidden = false;
  const maxLeft = Math.max(0, window.innerWidth - el.offsetWidth - 4);
  const maxTop = Math.max(0, window.innerHeight - el.offsetHeight - 4);
  el.style.left = `${Math.min(event.clientX + OFFSET, maxLeft)}px`;
  el.style.top = `${Math.min(event.clientY + OFFSET, maxTop)}px`;
}

function hideTermLinkTooltip() {
  if (termLinkTooltipEl) termLinkTooltipEl.hidden = true;
}

// ─── Sidebar menu ────────────────────────────────────────────────────────────
let sidebarMenuSections = [];
// 新規起動時はサイドバーを開いた状態にする（issue #169）。
let sidebarOpen = true;
let sidebarTransitionCleanup = null;
// サイドバー幅リサイズ（issue #89）。ドラッグ中の一時状態。
let sidebarResizeState = null;
// サイドバー幅の既定値・下限（px）。上限はウィンドウ幅比で動的に決める（sidebarMaxWidth）。
// 従来の 252px から約 1.3 倍に拡張した既定幅。永続化はしない（再起動で既定に戻る）。
const DEFAULT_SIDEBAR_WIDTH = 330;
const SIDEBAR_MIN_WIDTH = 200;
migrateLegacyState();
// null プロトタイプのため、hasOwnProperty など Object.prototype のメソッドは持たない。
const sidebarSectionsCollapsed = readCollapsedSections();

function isReducedMotion() {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
}

function isSafeMenuIcon(icon) {
  if (typeof icon !== 'string') return false;
  const value = icon.trim();
  if (!value || value.length > 8 || /[<>&]/.test(value)) return false;
  return /^(?:\p{Extended_Pictographic}(?:\uFE0F|\uFE0E)?)(?:\s?(?:\p{Extended_Pictographic}(?:\uFE0F|\uFE0E)?))?$/u.test(value);
}

function createMenuIcon(icon) {
  const el = document.createElement('span');
  el.className = 'sidebar-menu-icon';
  el.setAttribute('aria-hidden', 'true');
  el.textContent = isSafeMenuIcon(icon) ? icon.trim() : '';
  return el;
}

function createMenuLabel(label) {
  const el = document.createElement('span');
  el.className = 'sidebar-menu-label';
  const text = typeof label === 'string' ? label : '';
  el.textContent = text;
  if (text) el.title = text;
  return el;
}

function runMenuAction(action) {
  if (!action || typeof action !== 'object') return;
  if (action.type === 'open-settings') {
    openSettingsModal();
    return;
  }
  if (action.type === 'open-url') {
    openExternalUrlSafe(action.url);
  }
}

function createMenuActionElement(item) {
  const action = item && typeof item.action === 'object' ? item.action : null;
  let el;
  if (action?.type === 'open-url' && isSafeExternalUrl(action.url)) {
    el = document.createElement('a');
    el.className = 'sidebar-menu-link';
    el.href = '#';
    el.addEventListener('click', (event) => {
      event.preventDefault();
      runMenuAction(action);
    });
  } else if (action?.type === 'open-settings') {
    el = document.createElement('button');
    el.className = 'sidebar-menu-button';
    el.type = 'button';
    el.dataset.menuAction = action.type;
    el.addEventListener('click', () => runMenuAction(action));
  } else {
    el = document.createElement('span');
    el.className = 'sidebar-menu-text';
  }
  el.appendChild(createMenuIcon(item.icon));
  el.appendChild(createMenuLabel(item.label));
  return el;
}

function createMenuItem(item) {
  const li = document.createElement('li');
  li.className = 'sidebar-menu-item';
  const children = Array.isArray(item?.children) ? item.children : [];
  if (children.length) {
    const details = document.createElement('details');
    details.className = 'sidebar-submenu';
    const summary = document.createElement('summary');
    summary.className = 'sidebar-menu-summary';
    summary.appendChild(createMenuIcon(item.icon));
    summary.appendChild(createMenuLabel(item.label));
    details.appendChild(summary);

    const childList = document.createElement('ul');
    childList.className = 'sidebar-submenu-list';
    for (const child of children) {
      childList.appendChild(createMenuItem(child));
    }
    details.appendChild(childList);
    li.appendChild(details);
    return li;
  }

  li.appendChild(createMenuActionElement(item || {}));
  return li;
}

function encodeSidebarSectionIdPart(value) {
  let encoded = '';
  for (let index = 0; index < value.length; index++) {
    const codeUnit = value.charCodeAt(index);
    const nextCodeUnit = value.charCodeAt(index + 1);
    if (codeUnit >= 0xD800 && codeUnit <= 0xDBFF && nextCodeUnit >= 0xDC00 && nextCodeUnit <= 0xDFFF) {
      encoded += encodeURIComponent(value.slice(index, index + 2));
      index++;
    } else if (codeUnit >= 0xD800 && codeUnit <= 0xDFFF) {
      // JSON で届きうる孤立サロゲートを encodeURIComponent に渡すと例外になるため明示表現へ逃がす。
      encoded += `%u${codeUnit.toString(16).padStart(4, '0')}`;
    } else {
      encoded += encodeURIComponent(value[index]);
    }
  }
  return encoded;
}

// サイドバー各カードの共通見出し。見出し全体は非インタラクティブな div のままにする。
// issue #226 の担当者 <select> を入れ子にできるよう、見出し全体を button にせず、
// ラベルと操作を兄弟ゾーンへ分離する。body が無い場合はトグルを生成しない。
function createSidebarSectionHeader(section, options) {
  const {
    sectionId,
    labelText,
    body,
    controls = [],
    labelClassName = '',
    labelId = '',
    labelTitle = '',
    toggleLabelText = labelText,
  } = options;
  const header = document.createElement('div');
  header.className = 'sidebar-section-header';

  const label = document.createElement('span');
  if (labelId) label.id = labelId;
  label.className = ['sidebar-section-label', labelClassName].filter(Boolean).join(' ');
  label.textContent = labelText;
  if (labelTitle) label.title = labelTitle;
  header.appendChild(label);

  const controlGroup = document.createElement('div');
  controlGroup.className = 'sidebar-section-controls';
  for (const control of controls) controlGroup.appendChild(control);

  if (body) {
    const collapsed = sidebarSectionsCollapsed[sectionId] === true;
    section.classList.toggle('collapsed', collapsed);

    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'btn sidebar-section-toggle';
    toggle.setAttribute('aria-controls', body.id);
    updateSidebarSectionToggle(toggle, toggleLabelText, !collapsed);
    toggle.addEventListener('click', () => {
      const nowCollapsed = !section.classList.contains('collapsed');
      section.classList.toggle('collapsed', nowCollapsed);
      updateSidebarSectionToggle(toggle, toggleLabelText, !nowCollapsed);
      sidebarSectionsCollapsed[sectionId] = nowCollapsed;
      writeSectionCollapsed(sectionId, nowCollapsed);
    });
    controlGroup.appendChild(toggle);
  }

  if (controlGroup.childElementCount) header.appendChild(controlGroup);
  return { header, label };
}

function updateSidebarSectionToggle(toggle, labelText, open) {
  toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
  toggle.setAttribute('aria-label', open ? `${labelText}を隠す` : `${labelText}を表示`);
  toggle.textContent = stashToggleGlyph(open);
}

function renderSidebarMenu() {
  const nav = document.getElementById('sidebar-menu');
  if (!nav) return;
  // メニューは専用の内側コンテナ（.sidebar-menu-inner）だけを作り直す。
  // 格納ペイン（#pane-stash）は nav の別の子として同居させ、ここでは touch しない。
  // これにより格納ペインの xterm 要素がメニュー再描画のたびに detach されるのを防ぐ（issue #89）。
  let inner = nav.querySelector('.sidebar-menu-inner');
  if (!inner) {
    inner = document.createElement('div');
    inner.className = 'sidebar-menu-inner';
    nav.insertBefore(inner, nav.firstChild);
  }
  inner.replaceChildren();

  const sourceSectionIndexes = new Map();
  for (let sectionIndex = 0; sectionIndex < sidebarMenuSections.length; sectionIndex++) {
    const section = sidebarMenuSections[sectionIndex];
    const list = document.createElement('ul');
    list.className = 'sidebar-menu-list';
    const items = Array.isArray(section?.items) ? section.items : [];
    for (const item of items) list.appendChild(createMenuItem(item));

    // title 省略は、前後のメニューへ馴染ませるプレーンリストという公開仕様。
    if (!section?.title) {
      inner.appendChild(list);
      continue;
    }

    // main プロセスからは必ず source が届く。欠損した malformed/旧IPCデータには安定した
    // 出どころが無いため、描画位置を fallback にする。通常ソースとは別名にして影響を局所化する。
    // 折り畳み状態を持たない無題リストは、source ごとのカード連番を消費させない。
    const source = typeof section?.source === 'string' && section.source
      ? section.source
      : `source-missing-${sectionIndex}`;
    const sourceIndex = sourceSectionIndexes.get(source) || 0;
    sourceSectionIndexes.set(source, sourceIndex + 1);

    const sectionEl = document.createElement('div');
    const sectionId = `sidebar-menu-section-${encodeSidebarSectionIdPart(source)}-${sourceIndex}`;
    sectionEl.id = sectionId;
    sectionEl.className = 'sidebar-section sidebar-section-card';
    list.id = `${sectionId}-body`;
    list.classList.add('sidebar-section-body');
    const { header, label } = createSidebarSectionHeader(sectionEl, {
      sectionId,
      labelText: section.title,
      body: list,
      labelId: `${sectionId}-label`,
      labelTitle: section.title,
    });
    list.setAttribute('aria-labelledby', label.id);
    sectionEl.appendChild(header);
    sectionEl.appendChild(list);
    inner.appendChild(sectionEl);
  }

  applyUsageBadge();
}

// サイドバーのラッパー（.sidebar）を組み立てる（issue #89）。
// 中身は「固定ヘッダーの使用量カード」「スクロールする nav（メニュー内側 + 格納ペイン
// セクション）」と「幅リサイズハンドル」。開閉トランジション・可変幅の基準はこのラッパー側に持たせる。
function createSidebar() {
  const aside = document.createElement('aside');
  aside.id = 'sidebar';
  aside.className = 'sidebar';

  aside.appendChild(createSidebarUsageCard());
  aside.appendChild(createSidebarCodexUsageCard());

  const nav = document.createElement('nav');
  nav.id = 'sidebar-menu';
  nav.className = 'sidebar-menu';
  nav.setAttribute('aria-label', 'メインメニュー');

  // メニュー内側（renderSidebarMenu が作り直す対象）
  const inner = document.createElement('div');
  inner.className = 'sidebar-menu-inner';
  nav.appendChild(inner);

  // 設定 / タスクセクション / 格納ペインセクション（renderSidebarMenu の再構築対象外・別管理）
  // 設定は従来どおりユーザー追加メニューの後ろへ置き、その次にタスクを並べる。
  nav.appendChild(createSidebarSettingsCard());
  nav.appendChild(createTaskListContainer());
  nav.appendChild(createPaneStashContainer());

  aside.appendChild(nav);
  aside.appendChild(createSidebarResizer());
  return aside;
}

function createSidebarSettingsCard() {
  // 中身がボタン1つだけでランドマークとして移動する先がなく、section に aria-label を
  // 付けると「設定」が領域名とボタン名で二重に読み上げられるため、意図的に div とする。
  const card = document.createElement('div');
  card.id = 'sidebar-settings';
  card.className = 'sidebar-section-card';

  const header = document.createElement('button');
  header.type = 'button';
  header.className = 'sidebar-section-header';
  header.appendChild(createMenuIcon('⚙'));

  const label = document.createElement('span');
  label.className = 'sidebar-section-label';
  label.textContent = '設定';
  header.appendChild(label);
  header.addEventListener('click', () => openSettingsModal());

  card.appendChild(header);
  return card;
}

function createSidebarUsageCard() {
  const section = document.createElement('section');
  section.id = 'sidebar-usage';
  section.className = 'sidebar-usage sidebar-section-card';
  section.hidden = true;
  section.setAttribute('aria-label', 'Claude使用量');

  const body = document.createElement('div');
  body.id = 'sidebar-usage-body';
  body.className = 'sidebar-usage-body sidebar-section-body';
  body.setAttribute('aria-live', 'polite');

  const { header } = createSidebarSectionHeader(section, {
    sectionId: section.id,
    labelText: 'Claude使用量',
    body,
  });
  section.appendChild(header);
  section.appendChild(body);
  return section;
}

function createSidebarCodexUsageCard() {
  const section = document.createElement('section');
  section.id = 'sidebar-codex-usage';
  section.className = 'sidebar-usage sidebar-section-card';
  section.hidden = true;
  section.setAttribute('aria-label', 'Codex使用量');

  const body = document.createElement('div');
  body.id = 'sidebar-codex-usage-body';
  body.className = 'sidebar-usage-body sidebar-section-body';
  body.setAttribute('aria-live', 'polite');

  const { header } = createSidebarSectionHeader(section, {
    sectionId: section.id,
    labelText: 'Codex使用量',
    body,
  });
  section.appendChild(header);
  section.appendChild(body);
  return section;
}

// 担当者フィルタのモードを localStorage に保持する（issue #226）。
//   'self'（自分のみ・デフォルト） / 'all'（全員） / 'none'（担当なし） / '<login>'（個別担当者）
// GitHub モードかつ viewer 判明時のみプルダウンを表示する。未設定時は 'self'。
const TASK_ASSIGNEE_FILTER_KEY = 'vkt.taskAssigneeFilter';
const TASK_ASSIGNEE_FILTER_DEFAULT = 'self';
function readTaskAssigneeFilter() {
  try {
    const value = localStorage.getItem(TASK_ASSIGNEE_FILTER_KEY);
    return (typeof value === 'string' && value) ? value : TASK_ASSIGNEE_FILTER_DEFAULT;
  } catch (e) { return TASK_ASSIGNEE_FILTER_DEFAULT; }
}
function writeTaskAssigneeFilter(mode) {
  try { localStorage.setItem(TASK_ASSIGNEE_FILTER_KEY, mode); }
  catch (e) { /* プライベートモード等で保存失敗しても無視 */ }
}

// 担当者フィルタの選択肢導出・モード解決・絞り込みは共有契約（utils/widgetContract.js）に移管した。
// chrome 側は render 結果の filterOptions / filterMode / visibleItems を使ってプルダウンを更新する。

// vk-orchestrator の tasks-view.json を読み取り専用で表示するセクション。
function createTaskListContainer() {
  const section = document.createElement('section');
  section.id = 'task-list';
  section.className = 'task-list sidebar-section-card';
  section.hidden = true;
  section.setAttribute('aria-label', 'タスク');

  // 担当者で絞り込むプルダウン。GitHub モードかつ viewer 判明時のみ renderWidget が表示する。
  // 初期状態は非表示。選択肢・表示/非表示は描画のたびに更新する。
  const filter = document.createElement('select');
  filter.className = 'task-list-assignee-filter';
  filter.setAttribute('aria-label', '担当者で絞り込み');
  filter.hidden = true;
  filter.addEventListener('change', () => {
    writeTaskAssigneeFilter(filter.value);
    renderWidget();
  });
  const body = document.createElement('div');
  body.id = 'task-list-body';
  body.className = 'task-list-body sidebar-section-body';

  const notice = document.createElement('div');
  notice.className = 'task-list-stale';
  notice.setAttribute('role', 'status');
  notice.textContent = 'Orchestrator 停止中';
  notice.hidden = true;

  const list = document.createElement('div');
  list.className = 'task-list-groups';

  // フィルタ結果の件数を控えめにアナウンスする live region（視覚的には隠す）。
  const liveCount = document.createElement('div');
  liveCount.className = 'task-list-live';
  liveCount.setAttribute('aria-live', 'polite');

  body.appendChild(notice);
  body.appendChild(list);
  body.appendChild(liveCount);

  const { header } = createSidebarSectionHeader(section, {
    sectionId: section.id,
    labelText: 'タスク',
    toggleLabelText: 'タスク一覧',
    body,
    controls: [filter],
    labelClassName: 'task-list-title-text',
  });
  section.appendChild(header);
  section.appendChild(body);
  return section;
}

// 格納ペインを収めるセクション（見出し＋リスト）。中身は renderPaneStash が更新する。
function createPaneStashContainer() {
  const section = document.createElement('section');
  section.id = 'pane-stash';
  section.className = 'pane-stash sidebar-section-card';
  section.hidden = true;
  section.setAttribute('aria-label', '格納したペイン');

  const list = document.createElement('ul');
  list.id = 'pane-stash-body';
  list.className = 'pane-stash-list sidebar-section-body';

  const { header } = createSidebarSectionHeader(section, {
    sectionId: section.id,
    labelText: '格納したペイン',
    body: list,
  });
  section.appendChild(header);
  section.appendChild(list);
  return section;
}

// サイドバー右端の幅リサイズハンドル（グリッドの .grid-handle 相当のアクセシブル版）。
function createSidebarResizer() {
  const h = document.createElement('div');
  h.className = 'sidebar-resizer';
  h.setAttribute('role', 'separator');
  h.setAttribute('aria-orientation', 'vertical');
  h.setAttribute('aria-label', 'サイドバーの幅を変更');
  h.setAttribute('tabindex', '0');
  h.setAttribute('aria-valuemin', String(SIDEBAR_MIN_WIDTH));
  h.setAttribute('aria-valuemax', String(sidebarMaxWidth()));
  h.setAttribute('aria-valuenow', String(getSidebarWidth()));
  h.addEventListener('mousedown', startSidebarResize);
  h.addEventListener('keydown', onSidebarResizerKey);
  return h;
}

function ensureSidebar(root) {
  let el = root.querySelector('#sidebar');
  if (!el) {
    el = createSidebar();
    renderSidebarMenu();
    renderSidebarUsage(lastUsageSnapshot);
    renderSidebarCodexUsage(lastCodexUsageSnapshot);
    renderWidget();
    renderPaneStash();
  }
  return el;
}

// ─── Sidebar width（issue #89）────────────────────────────────────────────────
// 上限はウィンドウ幅の約 45%（40〜50% の範囲）。狭いウィンドウでもグリッドを潰さない。
function sidebarMaxWidth() {
  return Math.max(SIDEBAR_MIN_WIDTH, Math.round(window.innerWidth * 0.45));
}

function clampSidebarWidth(w) {
  // 数値化できない値（NaN / undefined / 文字列など）は既定幅にフォールバックする。
  const n = Number(w);
  if (!Number.isFinite(n)) return DEFAULT_SIDEBAR_WIDTH;
  return Math.max(SIDEBAR_MIN_WIDTH, Math.min(sidebarMaxWidth(), Math.round(n)));
}

// 現在のサイドバー幅（セッション内保持値、無ければ既定）をクランプして返す。
function getSidebarWidth() {
  const w = tree && typeof tree.sidebarWidth === 'number' ? tree.sidebarWidth : DEFAULT_SIDEBAR_WIDTH;
  return clampSidebarWidth(w);
}

// 幅を確定し、CSS カスタムプロパティ・aria 値・セッション保持値を更新する。
function setSidebarWidth(w) {
  const width = clampSidebarWidth(w);
  if (tree) tree.sidebarWidth = width;
  const aside = document.getElementById('sidebar');
  if (aside) aside.style.setProperty('--vktm-sidebar-width', `${width}px`);
  const handle = document.querySelector('.sidebar-resizer');
  if (handle) {
    handle.setAttribute('aria-valuemin', String(SIDEBAR_MIN_WIDTH));
    handle.setAttribute('aria-valuemax', String(sidebarMaxWidth()));
    handle.setAttribute('aria-valuenow', String(width));
  }
}

function startSidebarResize(e) {
  e.preventDefault();
  e.stopPropagation();
  sidebarResizeState = { startX: e.clientX, startWidth: getSidebarWidth() };
  document.body.classList.add('resizing-sidebar');
}

// 左右矢印キーで幅を増減する（Shift で大きめステップ）。
function onSidebarResizerKey(e) {
  const step = e.shiftKey ? 40 : 16;
  let w = getSidebarWidth();
  if (e.key === 'ArrowLeft') w -= step;
  else if (e.key === 'ArrowRight') w += step;
  else return;
  e.preventDefault();
  setSidebarWidth(w);
  debouncedFitAll();
  requestAnimationFrame(fitAll);
}

// ─── Pane stash rendering（issue #89）─────────────────────────────────────────
// 格納ペインのコンパクト表示を stashOrder に従って組み立てる。
// xterm 要素の再取り付けは render() の共通ループが担う（ここでは器だけ作る）。
function renderPaneStash() {
  const section = document.getElementById('pane-stash');
  if (!section) return;
  const stash = (tree && Array.isArray(tree.stashOrder)) ? tree.stashOrder : [];
  // 0 件のときはセクションごと隠す。
  section.hidden = stash.length === 0;
  const list = section.querySelector('.pane-stash-list');
  if (!list) return;
  list.replaceChildren();
  stash.forEach((id, idx) => {
    list.appendChild(renderStashItem(id, idx, stash.length));
  });
}

// xterm 表示トグル（― ボタン）のグリフ / ラベルを開閉状態から返す。
// aria-expanded に加えて視覚グリフも切り替える（表示中=下向き▾ / 非表示=右向き▸）。
// 並べ替えの ↑↓ とは向き（縦↔横起点）で区別する。
function stashToggleGlyph(open) { return open ? '▾' : '▸'; }
function stashToggleLabel(open) { return open ? 'ターミナルを隠す' : 'ターミナルを表示'; }
function isCloseLocked(t) { return t?.lock?.close === false; }
function closeButtonLabel(locked) { return locked ? 'このペインは保護されています（閉じられません）' : '閉じる'; }

function applyCloseButtonLock(button, locked) {
  if (!button) return;
  const label = closeButtonLabel(locked);
  button.classList.toggle('is-locked', locked);
  button.setAttribute('title', label);
  button.setAttribute('aria-label', label);
  if (locked) {
    button.setAttribute('aria-disabled', 'true');
  } else {
    button.removeAttribute('aria-disabled');
  }
}

function updatePaneCloseLock(paneId) {
  const locked = isCloseLocked(terminals[paneId]);
  applyCloseButtonLock(document.querySelector(`.pane[data-id="${paneId}"] .btn-close`), locked);
  applyCloseButtonLock(document.querySelector(`.stash-item[data-id="${paneId}"] .btn-close`), locked);
}

// ─── 宣言的ウィジェット描画（#229 / vk-orchestrator#182）──────────────────────
// タスクの語彙・色・遷移・確認文言は自前に持たず、orchestrator が書き出す宣言
// （tasks-widget.json → widgets:update）だけを共有レンダラ（renderer/widgetView.js）で描画する。
// この app.js は chrome（セクション表示制御・見出しリンク・担当者フィルタ・stale/legacy 注記）
// のみを担い、グループ／アイテム／コントロールの中身は共有レンダラに委譲する。

// 担当者フィルタの選択肢差分検出用シリアライズ区切り。value/label やエントリ境界が
// 曖昧にならないよう、通常テキストに現れない制御表示用文字（U+241F / U+241E）で区切る。
const ASSIGNEE_OPTION_FIELD_SEP = '␟';
const ASSIGNEE_OPTION_ITEM_SEP = '␞';

// CSS セレクタ用に値をエスケープする（担当者ログインや taskId に特殊文字が来ても壊さない）。
function escapeWidgetSelectorValue(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

// 再描画は groupsEl を丸ごと作り直すため、操作中のコントロール（select）にフォーカスがあれば
// taskId + field を控え、描画後に同じコントロールへ復帰させる（ライブ更新でのフォーカス喪失防止）。
function captureWidgetFocus(groupsEl) {
  const active = document.activeElement;
  if (!(active instanceof HTMLElement) || !groupsEl.contains(active)) return null;
  const taskId = active.dataset.taskId;
  const field = active.dataset.field;
  if (!taskId || !field) return null;
  return { taskId, field };
}

function restoreWidgetFocus(groupsEl, saved) {
  if (!saved) return;
  const selector = `select[data-task-id="${escapeWidgetSelectorValue(saved.taskId)}"][data-field="${escapeWidgetSelectorValue(saved.field)}"]`;
  const target = groupsEl.querySelector(selector);
  if (!(target instanceof HTMLElement) || target.disabled) return;
  try {
    target.focus({ preventScroll: true });
  } catch (_e) {
    target.focus();
  }
}

// ネイティブ select ピッカーを操作中（groupsEl 内の select にフォーカスがある）かを判定する。
// orchestrator からの widgets:update 毎に groupsEl を作り直すと、開いているポップアップが閉じて
// 選択中の操作が中断される。この間は widgets:update 起因の再描画をスキップし、データだけ保持して
// blur 後（次の描画契機）に最新化する。capture/restore ではポップアップの開閉までは救えないため。
function isEditingWidgetControl(groupsEl) {
  const active = document.activeElement;
  if (!(active instanceof HTMLElement) || !groupsEl.contains(active)) return false;
  return active.tagName === 'SELECT';
}

// 共有レンダラの描画コントローラを一度だけ生成する。
//   sendCommand: 宣言のコマンド断片をそのまま main へ中継する（id/requestedAt は main が付与）。
//                commands.jsonl 未設定時は発行できないため即エラーで返す。
//   getFilterMode: localStorage の担当者フィルタ選択を返す（選択肢との突き合わせは共有側が行う）。
//   requestRerender: 反映待ちのタイムアウト等で共有側から再描画を要求する経路。
function ensureWidgetViewController(groupsEl) {
  if (widgetViewController) return widgetViewController;
  widgetViewController = createTaskWidgetView({
    doc: document,
    groupsEl,
    isSafeExternalUrl,
    openUrl: openExternalUrlSafe,
    sendCommand: async (command) => {
      if (!commandsConfigured) return { ok: false, error: 'commands-file-not-configured' };
      try {
        const res = await VKIpc.invoke('widgets:command', command);
        return res && res.ok ? { ok: true } : { ok: false, error: res && res.error };
      } catch (e) {
        console.warn('ウィジェットコマンドの送信に失敗しました', e);
        return { ok: false, error: e && e.message };
      }
    },
    getFilterMode: () => readTaskAssigneeFilter(),
    requestRerender: () => renderWidget(),
    pendingTimeoutMs: TASK_PENDING_TIMEOUT_MS,
  });
  return widgetViewController;
}

// 表示中ウィジェットの queue リンクから task-queue の issue 一覧 URL を導出する（issue #233）。
// GitHub モード時のみ実 http(s) URL が入るため、resolveQueueIssuesListUrl が導出できたものを返す。
function deriveWidgetIssuesListUrl(widget) {
  for (const item of widgetContract.flatItems(widget)) {
    for (const link of (item.links || [])) {
      if (link.rel !== 'queue') continue;
      const listUrl = resolveQueueIssuesListUrl(link.url);
      if (listUrl) return listUrl;
    }
  }
  return '';
}

// 見出しラベル「タスク」を、GitHub モード時のみ task-queue issue 一覧への外部リンクにする（issue #233）。
// 共通見出しの左右ゾーンは維持し、左ラベル（.task-list-title-text）の中身だけを
// 作り直して切り替える。listUrl が空ならプレーンテキストに戻す。
function updateWidgetTitleLink(section, listUrl) {
  const label = section.querySelector('.task-list-title-text');
  if (!label) return;

  // ローカルモード / URL 無し / 0 件: 従来どおりプレーンテキスト。
  if (!listUrl) {
    label.classList.remove('has-link');
    label.replaceChildren();
    label.textContent = 'タスク';
    return;
  }

  // GitHub モード: 見出しを issue 一覧への外部リンクにする。href には実 URL を入れず
  // href="#" + click で openExternalUrlSafe を呼ぶ。ツールチップ（タイトル + URL）は <a> 側に集約する。
  label.classList.add('has-link');
  label.replaceChildren();

  const link = document.createElement('a');
  link.className = 'task-list-title-link';
  link.href = '#';
  link.setAttribute('role', 'link');
  link.setAttribute('aria-label', 'タスク一覧（外部ブラウザで開く）');
  link.draggable = false;
  link.title = `タスク一覧\n${listUrl}`;

  const labelSpan = document.createElement('span');
  labelSpan.className = 'task-list-title-link-text';
  labelSpan.textContent = 'タスク';

  const iconSpan = document.createElement('span');
  iconSpan.className = 'task-list-title-link-icon';
  iconSpan.setAttribute('aria-hidden', 'true');
  // 先頭の U+2060(WORD JOINER) で「タスク」末尾と ↗ の間の改行を禁止する。
  iconSpan.textContent = '⁠↗';
  labelSpan.appendChild(iconSpan);

  link.appendChild(labelSpan);

  link.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    openExternalUrlSafe(listUrl);
  });

  label.appendChild(link);
}

// 担当者フィルタ（プルダウン）の表示・選択肢を render 結果に合わせて更新する。
// info が無い / filterEnabled でないときはプルダウンを隠し、件数アナウンスも消す。
function updateWidgetFilter(section, info) {
  const filter = section.querySelector('.task-list-assignee-filter');
  const liveCount = section.querySelector('.task-list-live');
  if (!filter) return;

  if (!info || !info.filterEnabled) {
    filter.hidden = true;
    if (liveCount) liveCount.textContent = '';
    return;
  }

  // 選択肢が変わったときだけ作り直す（毎回作り直すと開いている最中に閉じるなどの副作用が出るため）。
  const options = Array.isArray(info.filterOptions) ? info.filterOptions : [];
  const currentOptions = Array.from(filter.options)
    .map((opt) => `${opt.value}${ASSIGNEE_OPTION_FIELD_SEP}${opt.textContent}`)
    .join(ASSIGNEE_OPTION_ITEM_SEP);
  const nextOptions = options
    .map((opt) => `${opt.value}${ASSIGNEE_OPTION_FIELD_SEP}${opt.label}`)
    .join(ASSIGNEE_OPTION_ITEM_SEP);
  if (currentOptions !== nextOptions) {
    filter.replaceChildren();
    options.forEach((opt) => {
      const el = document.createElement('option');
      el.value = opt.value;
      el.textContent = opt.label;
      filter.appendChild(el);
    });
  }
  filter.value = info.filterMode;
  filter.hidden = false;
  if (liveCount) liveCount.textContent = `${info.visibleItems}件表示`;
}

// widgets:update で受けた中継ペイロード { widget, legacyNotice, commandsConfigured } を描画する。
// widget があれば共有レンダラで描画し、無く legacyNotice のみのときはタスク語彙を復活させず
// 「orchestrator の更新が必要な可能性があります」の注記だけを出す（dual-write 期間の後方互換）。
function renderWidget(fromUpdate) {
  const section = document.getElementById('task-list');
  if (!section) return;
  const staleNotice = section.querySelector('.task-list-stale');
  const groupsEl = section.querySelector('.task-list-groups');
  if (!groupsEl) return;

  // ネイティブ select ピッカー操作中、または編集パネルで下書き編集中は widgets:update 起因の
  // 再描画をスキップする（データは lastWidgetPayload に保持済み。閉じた後の次描画で最新化）。
  // 保存中は pending の反映検知が必要なため、更新描画を通して syncPending に渡す。
  if (
    fromUpdate
    && (
      isEditingWidgetControl(groupsEl)
      || (widgetViewController && widgetViewController.hasOpenEditor() && !widgetViewController.hasPending())
    )
  ) return;

  const payload = lastWidgetPayload;
  const widget = payload && payload.widget ? payload.widget : null;
  const legacyNotice = !!(payload && payload.legacyNotice);
  if (payload && typeof payload.commandsConfigured === 'boolean') {
    commandsConfigured = payload.commandsConfigured;
  }

  // セクション表示制御: 一度でも新鮮な widget を見たら以後は表示を維持する（既存 util を流用）。
  // staleness の閾値は宣言（widget.staleThresholdMs）から受け、無ければフォールバック既定値を使う。
  const staleMs = (widget && Number.isFinite(widget.staleThresholdMs))
    ? widget.staleThresholdMs
    : WIDGET_STALE_FALLBACK_MS;
  const visibility = computeTaskSectionVisibility(widget, {
    hasSeenFresh: hasSeenFreshWidget,
    staleMs,
  });
  hasSeenFreshWidget = visibility.hasSeenFresh;
  const stale = !!widget && visibility.stale;
  // legacyNotice のみ（widget 無し）のときも更新が必要な旨を伝えるためセクションを表示する。
  const shouldShow = visibility.shouldShow || legacyNotice;

  section.hidden = !shouldShow;
  section.classList.toggle('is-stale', stale);

  // 注記は stale 優先。widget が無く legacyNotice のときだけ後方互換の注記を出す。
  // data-kind で配色を分ける（stale=danger / legacy=助言的な warning）。
  if (staleNotice) {
    if (stale) {
      staleNotice.dataset.kind = 'stale';
      staleNotice.textContent = 'Orchestrator 停止中';
      staleNotice.hidden = !shouldShow;
    } else if (legacyNotice) {
      staleNotice.dataset.kind = 'legacy';
      staleNotice.textContent = WIDGET_LEGACY_NOTICE_TEXT;
      staleNotice.hidden = !shouldShow;
    } else {
      staleNotice.hidden = true;
    }
  }

  if (!shouldShow) {
    groupsEl.replaceChildren();
    updateWidgetTitleLink(section, '');
    updateWidgetFilter(section, null);
    return;
  }

  // 共有レンダラでグループ／アイテム／コントロールを描画する。フォーカスは描画前後で維持する。
  const focusState = captureWidgetFocus(groupsEl);
  const controller = ensureWidgetViewController(groupsEl);
  const info = controller.render(widget, { now: Date.now() });
  restoreWidgetFocus(groupsEl, focusState);

  // 見出しリンク（GitHub モード時のみ issue 一覧へ）と担当者フィルタを更新する。
  updateWidgetTitleLink(section, deriveWidgetIssuesListUrl(widget));
  updateWidgetFilter(section, info);
}

// 経過タイマー: orchestrator 停止を即時反映するため staleness を再計算して注記を切り替える。
// 全描画（groupsEl の作り直し）は行わず、is-stale クラスと注記の表示のみを更新する
// （操作中のフォーカスを奪わないため）。widget が無い（legacyNotice のみ）ときは stale 概念なし。
function tickWidgetStale() {
  const section = document.getElementById('task-list');
  if (!section || section.hidden) return;
  const widget = lastWidgetPayload && lastWidgetPayload.widget ? lastWidgetPayload.widget : null;
  if (!widget) return;
  const stale = widgetContract.isWidgetStale(widget, {});
  section.classList.toggle('is-stale', stale);
  const staleNotice = section.querySelector('.task-list-stale');
  if (!staleNotice) return;
  if (stale) {
    staleNotice.dataset.kind = 'stale';
    staleNotice.textContent = 'Orchestrator 停止中';
    staleNotice.hidden = false;
  } else {
    staleNotice.hidden = true;
  }
}

// e2e / デバッグ用の描画フック（旧 window.renderTaskList の後継）。
window.renderWidget = renderWidget;

// e2e / デバッグ用の読み取り専用フック（issue #270）。
// 静止ゲート（waitingState.js の WAITING_QUIESCENCE_MS）は t.lastOutputTime を起点に
// タイマーを張るため、「出力が静止してから点灯している」ことを e2e から確かめるには、
// ゲートと同じ起点の時刻が要る。DOM への描画時刻を起点にすると、高負荷で xterm の描画や
// テスト側のポーリングが遅れた分だけ間隔が短く出て、実時間の下限を割る（issue #270）。
//
// terminals そのものを読む形は採らない。xterm インスタンスを含むため、Playwright の
// evaluate が返す構造化クローンに乗らず、そもそも e2e 側へ取り出せないため。
// （terminals は `let`（クラシックスクリプトのグローバル字句環境）なので window.terminals
//   としては見えないが、evaluate 内の素の識別子 `terminals` では参照しうる。「見えないから
//   安全」ではなく、取り出せない以上アクセサ経由に統一する、という判断。）
// ここでは点灯記録のコピー（プレーンな数値 2 つ）だけを返し、内部状態を書き換える口は開けない。
window.getLocalWaitingOnset = (paneId) => {
  const onset = terminals[paneId]?.localWaitingOnset;
  if (!onset) return null;
  return { at: onset.at, lastOutputTime: onset.lastOutputTime };
};

// 格納ペイン 1 件分（コンパクトカード）を生成する。
//   - タイトル行: タスク名 / タイトルリンク / PR リンク
//   - 操作行: 状態バッジ + アクション（↑ ↓ 表示トグル(▸/▾) →(復帰) ✕）
//   - cwd 行
//   - term-container（xterm。既定は非表示、― で開閉）
function renderStashItem(id, idx, count) {
  const t = terminals[id];
  const waiting = !!(t && (t.waiting || t.externalWaiting));
  const li = document.createElement('li');
  li.className = 'stash-item'
    + (id === focusedPaneId ? ' focused' : '')
    + (waiting ? ' waiting' : '');
  li.dataset.id = id;
  const xtermOpen = !!(t && t.stashXtermOpen);
  if (xtermOpen) li.classList.add('stash-xterm-open');

  const status = t?.status || 'idle';
  const { label: statusLabel, ariaLabel: statusAriaLabel } = getStatusPresentation(status);
  const title = getDisplayTitle(t);
  const taskUrl = getDisplayUrl(t);
  const taskPrUrl = isSafeExternalUrl(t?.apiPrUrl) ? t.apiPrUrl : '';
  const cwd = t?.cwd || '~';
  const closeLocked = isCloseLocked(t);
  const closeLabel = closeButtonLabel(closeLocked);

  const titleEl = document.createElement('div');
  titleEl.className = 'pane-task-title stash-item-title-row'
    + (!title && !taskPrUrl ? ' empty' : '')
    + (taskUrl ? ' has-link' : '')
    + (taskPrUrl ? ' has-pr' : '');
  renderTaskTitleContent(titleEl, title, taskUrl, taskPrUrl, !!t?.apiPrMerged, !!t?.apiWaitingMerge);
  if (taskUrl) {
    titleEl.removeAttribute('title');
  } else {
    titleEl.title = title;
  }

  const head = document.createElement('div');
  head.className = 'stash-item-head';
  // セキュリティ: cwd（OS 由来）・status 等は escAttr / escText でエスケープする（renderLeaf と同流儀）。
  head.innerHTML = `
    <span class="pane-badge pane-status" data-status="${escAttr(status)}" role="status" aria-live="polite"${statusAriaLabel ? ` aria-label="${escAttr(statusAriaLabel)}"` : ''}>${escText(statusLabel)}</span>
    <div class="stash-item-actions">
      <button class="btn btn-stash-up" title="上へ移動" aria-label="上へ移動">↑</button>
      <button class="btn btn-stash-down" title="下へ移動" aria-label="下へ移動">↓</button>
      <button class="btn btn-stash-toggle" title="${escAttr(stashToggleLabel(xtermOpen))}" aria-label="${escAttr(stashToggleLabel(xtermOpen))}" aria-expanded="${xtermOpen ? 'true' : 'false'}">${escText(stashToggleGlyph(xtermOpen))}</button>
      <span class="stash-actions-sep" aria-hidden="true"></span>
      <button class="btn btn-stash-restore" title="グリッドへ戻す" aria-label="グリッドへ戻す">→</button>
      <button class="btn btn-close${closeLocked ? ' is-locked' : ''}" title="${escAttr(closeLabel)}" aria-label="${escAttr(closeLabel)}"${closeLocked ? ' aria-disabled="true"' : ''}>✕</button>
    </div>
  `;

  const cwdEl = document.createElement('div');
  cwdEl.className = 'stash-item-cwd';
  cwdEl.title = cwd;
  cwdEl.textContent = cwd;

  const termContainer = document.createElement('div');
  termContainer.className = 'term-container';

  li.appendChild(titleEl);
  li.appendChild(head);
  li.appendChild(cwdEl);
  li.appendChild(termContainer);

  const upBtn = head.querySelector('.btn-stash-up');
  const downBtn = head.querySelector('.btn-stash-down');
  if (idx === 0) upBtn.disabled = true;
  if (idx === count - 1) downBtn.disabled = true;
  upBtn.addEventListener('click', e => { e.stopPropagation(); moveStashPane(id, 'up'); });
  downBtn.addEventListener('click', e => { e.stopPropagation(); moveStashPane(id, 'down'); });
  head.querySelector('.btn-stash-toggle').addEventListener('click', e => { e.stopPropagation(); toggleStashXterm(id); });
  head.querySelector('.btn-stash-restore').addEventListener('click', e => { e.stopPropagation(); unstashPane(id); });
  head.querySelector('.btn-close').addEventListener('click', e => {
    e.stopPropagation();
    if (terminals[id]?.lock?.close === false) return;
    closePane(id);
  });
  li.addEventListener('mousedown', () => {
    // .pane 側と同じフォーカスガード記録が必要（issue #385 レビュー指摘・MEDIUM-1）。
    // 格納ペインの xterm 要素は render() の再アタッチで .stash-item .term-container へ
    // 移されて生きたまま操作でき、リンクプロバイダも登録済みのままのため、ここで記録を
    // 省くと格納中のペインだけガードが機能しない（もしくは逆に常に開かなくなる）。
    recordPaneFocusBeforeMousedown(id);
    focusPane(id);
  });

  return li;
}

// 格納ペイン（サイドバー内）のコンパクト表示を最新状態へ更新する。
// グリッド用の update* 関数は .pane[data-id] しか見ないため、格納中はこちらで反映する。
function updateStashItem(paneId) {
  const li = document.querySelector(`.stash-item[data-id="${paneId}"]`);
  if (!li) return;
  const t = terminals[paneId];
  if (!t) return;
  li.classList.toggle('waiting', !!(t.waiting || t.externalWaiting));
  const badge = li.querySelector('.pane-status');
  if (badge) {
    const status = t.status || 'idle';
    badge.dataset.status = status;
    const { label, ariaLabel } = getStatusPresentation(status);
    badge.textContent = label;
    if (ariaLabel) badge.setAttribute('aria-label', ariaLabel);
    else badge.removeAttribute('aria-label');
  }
  const titleEl = li.querySelector('.stash-item-title-row');
  if (titleEl) {
    const title = getDisplayTitle(t);
    const url = getDisplayUrl(t);
    const prUrl = isSafeExternalUrl(t.apiPrUrl) ? t.apiPrUrl : '';
    // 第6引数 waitingMerge（issue #363）の渡し漏れがあると、updatePaneStatus() 経由で
    // 頻繁に呼ばれるこの関数がステータス更新のたびに「PR が出ただけ」表示へ引き戻してしまい、
    // 格納カードでマージ待ちの青がほぼ表示されなくなる（安藤レビュー・HIGH）。
    renderTaskTitleContent(titleEl, title, url, prUrl, !!t.apiPrMerged, !!t.apiWaitingMerge);
    if (url) {
      titleEl.removeAttribute('title');
    } else {
      titleEl.title = title;
    }
    titleEl.classList.toggle('empty', title.length === 0 && !prUrl);
    titleEl.classList.toggle('has-link', !!url);
    titleEl.classList.toggle('has-pr', !!prUrl);
  }
  updatePaneCloseLock(paneId);
}

function focusFirstSidebarItem() {
  const nav = document.getElementById('sidebar-menu');
  const first = nav?.querySelector('a, button, summary');
  if (first && typeof first.focus === 'function') first.focus();
}

function setSidebarOpen(open, options = {}) {
  const root = document.getElementById('root');
  const btn = document.getElementById('menu-btn');
  // 開閉トランジション（transform）はラッパー .sidebar 側に付いている（issue #89）。
  const aside = root ? ensureSidebar(root) : null;
  if (sidebarTransitionCleanup) {
    sidebarTransitionCleanup();
    sidebarTransitionCleanup = null;
  }
  sidebarOpen = !!open;
  root?.classList.toggle('sidebar-open', sidebarOpen);
  btn?.setAttribute('aria-expanded', sidebarOpen ? 'true' : 'false');

  const afterLayout = () => {
    fitAll();
    if (sidebarOpen && options.focusFirst !== false) {
      focusFirstSidebarItem();
    } else if (!sidebarOpen && options.focusToggle) {
      btn?.focus();
    }
  };

  if (!aside || isReducedMotion()) {
    requestAnimationFrame(afterLayout);
    return;
  }

  let done = false;
  let timeoutId = null;
  const cleanup = () => {
    done = true;
    aside.removeEventListener('transitionend', onEnd);
    if (timeoutId !== null) clearTimeout(timeoutId);
    if (sidebarTransitionCleanup === cleanup) sidebarTransitionCleanup = null;
  };
  const finish = () => {
    if (done) return;
    cleanup();
    afterLayout();
  };
  const onEnd = (event) => {
    if (event.target !== aside || event.propertyName !== 'transform') return;
    finish();
  };
  sidebarTransitionCleanup = cleanup;
  aside.addEventListener('transitionend', onEnd);
  timeoutId = setTimeout(finish, 220);
}

function setupSidebarMenu() {
  const root = document.getElementById('root');
  if (root) ensureSidebar(root);
  const btn = document.getElementById('menu-btn');
  if (btn) {
    btn.addEventListener('click', () => setSidebarOpen(!sidebarOpen, { focusFirst: true }));
  }
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || !sidebarOpen) return;
    event.preventDefault();
    setSidebarOpen(false, { focusToggle: true });
  });
  VKIpc.on('menu:update', (sections) => {
    sidebarMenuSections = Array.isArray(sections) ? sections : [];
    renderSidebarMenu();
  });
  VKIpc.on('widgets:update', (payload) => {
    lastWidgetPayload = payload || null;
    // fromUpdate=true: ネイティブ select ピッカー操作中の再描画を避ける。
    renderWidget(true);
  });
}

// .pane-task-title 要素の中身を、URL の有無に応じて
// プレーンテキスト or <a>（外部リンクマーク付き）で再構築する。
//   - URL 無し: テキストノードのみ（従来通り、見た目は完全互換）
//   - URL 有り: <a role="link" href="#"> + <span>title</span> + <span aria-hidden>↗</span>
// href には URL を直接入れない（Electron の <a target="_blank"> が新 BrowserWindow を
// 開く危険挙動を回避するため）。クリック時は preventDefault → shell.openExternal で
// OS の既定ブラウザを開く。
// 第4引数 prUrl（issue #44）: 非空のとき、タイトル右側に独立した PR ボタン（<a class="pane-task-title-pr">）を追加する。
//   apiTitle / taskTitle のいずれが表示中でも、prUrl があれば常時表示する（採用: 案A）。
// 第5引数 prMerged: true のとき、PR ボタンをマージ済み表示（紫 + 非色アイコン）にする。
// 第6引数 waitingMerge（issue #363）: true のとき、PR ボタンをマージ待ち表示（青 + 非色アイコン）に
// する。prMerged が true の場合はこちらより優先される（getPrBadgePresentation 側で判定）。
// フィールド名はワイヤ上（POST /api/set-title の waitingMerge）に合わせている。getPrBadgePresentation
// の options キー（prWaitingMerge）は内部限定の名前のため合わせていない（外部 API 名だけ一致していれば十分）。
function renderTaskTitleContent(el, title, url, prUrl, prMerged = false, waitingMerge = false) {
  // 既存の子要素を全消去（innerHTML は使わずに DOM API で組み立てる）
  while (el.firstChild) el.removeChild(el.firstChild);

  // ── タイトル本文（リンク化される場合と平文の場合） ────────────────────
  if (!url) {
    // 平文のタイトルでも、prUrl がある場合は PR ボタンを右寄せできるよう
    // タイトル部分を span にラップする（flex の margin-left: auto を効かせるため）。
    if (prUrl) {
      const titleSpan = document.createElement('span');
      titleSpan.className = 'pane-task-title-text';
      titleSpan.textContent = title;
      el.appendChild(titleSpan);
    } else {
      el.textContent = title;
    }
  } else {
    const link = document.createElement('a');
    link.className = 'pane-task-title-link';
    link.href = '#'; // 実 URL は入れない（Electron の target="_blank" 経由の新 BrowserWindow 防止）
    link.setAttribute('role', 'link');
    link.setAttribute('aria-label', `${title}（外部ブラウザで開く）`);
    // ペイン D&D 起点は親 .pane-task-title 側。リンクの URL drag（href のドラッグ）が割り込まないよう抑止（issue #40）。
    link.draggable = false;
    // ホバー時のツールチップにはタイトル本文と URL の両方を改行区切りで含める。
    // 親要素 .pane-task-title の title 属性は has-link 時に外して競合を避ける
    // （ブラウザ実装により親子 title の優先順位が不定なため。updatePaneTitle / renderLeaf 側で制御）。
    link.title = title ? `${title}\n${url}` : url;

    const labelSpan = document.createElement('span');
    labelSpan.className = 'pane-task-title-text';
    labelSpan.textContent = title;
    link.appendChild(labelSpan);

    const iconSpan = document.createElement('span');
    iconSpan.className = 'pane-task-title-icon';
    iconSpan.setAttribute('aria-hidden', 'true');
    iconSpan.textContent = '↗';
    link.appendChild(iconSpan);

    // クリック: ペインのアクティブ化（mousedown 経路）は止めない。click のみ抑止し
    // shell.openExternal でブラウザを開く。
    link.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      openExternalUrlSafe(url);
    });
    // mousedown は止めない（ペインのフォーカス移譲は通常通り）
    // ただしリンク自体のテキスト選択は意図しないドラッグを起こしやすいので、
    // ユーザビリティのため pointer 系イベントの伝搬は維持しつつ、別操作とは衝突しない。

    el.appendChild(link);
  }

  // ── PR ボタン（issue #44） ──────────────────────────────────────────────
  // タイトル文字列の有無・apiTitle/taskTitle の選択状態に関わらず、prUrl があれば常時表示。
  // .pane-badge（issue #27 で導入した共通バッジ basis）に乗せて見た目を統一する。
  if (prUrl) {
    const prPresentation = getPrBadgePresentation(prMerged === true, { prWaitingMerge: waitingMerge === true });
    const prLink = document.createElement('a');
    prLink.className = prPresentation.className;
    prLink.href = '#'; // 実 URL は入れない（タイトルリンクと同じ理由）
    prLink.setAttribute('role', 'link');
    prLink.setAttribute('aria-label', prPresentation.ariaLabel);
    // ホバー時のツールチップはタイトルリンク側（title\nurl 形式）に揃え、
    // 状態ラベル（PR / マージ待ちのPR / マージ済みのPR）+ 改行 + prUrl にする（issue #363）。
    prLink.title = `${prPresentation.titleLabel}\n${prUrl}`;
    prLink.draggable = false;

    const prLabel = document.createElement('span');
    prLabel.className = 'pane-task-title-pr-label';
    prLabel.textContent = 'PR';
    prLink.appendChild(prLabel);

    const prIcon = document.createElement('span');
    prIcon.className = 'pane-task-title-pr-icon';
    prIcon.setAttribute('aria-hidden', 'true');
    prIcon.textContent = prPresentation.icon;
    prLink.appendChild(prIcon);

    prLink.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      openExternalUrlSafe(prUrl);
    });

    el.appendChild(prLink);
  }
}

function updatePaneTitle(paneId) {
  const t = terminals[paneId];
  if (!t) return;
  // 格納中ならコンパクト表示のタスク名を更新する（.pane が無いため下の処理は素通りする）。
  updateStashItem(paneId);
  const el = document.querySelector(`.pane[data-id="${paneId}"] .pane-task-title`);
  if (!el) return;
  const title = getDisplayTitle(t);
  const url = getDisplayUrl(t);
  // ペイン D&D 起点としての可用性（issue #40）。複数 leaf がある時のみドラッグ可。
  // renderLeaf() 側の `canDragPane` 判定と同一の式に合わせる。
  // ここで考慮しないと、タイトル / PR をクリアした後に `.pane-task-title` が
  // empty 扱いで消え、ドラッグ起点を失う（CodeRabbit PR #45 指摘）。
  const canDragPane = canDragGridPane();
  // PR ボタンは apiPrUrl があれば常時表示（採用: 案A）。
  // renderer 側でも http(s) 二段チェックを通してから採用する。
  const prUrl = isSafeExternalUrl(t.apiPrUrl) ? t.apiPrUrl : '';
  const prMerged = !!t.apiPrMerged;
  const waitingMerge = !!t.apiWaitingMerge;
  renderTaskTitleContent(el, title, url, prUrl, prMerged, waitingMerge);
  // ホバー時のツールチップは has-link 時は子 <a> 側に集約して親子競合を避ける。
  //   - URL 無し: 親 .pane-task-title に title 属性をセット（従来挙動）
  //   - URL 有り: 親 title 属性を削除し、<a> 側の title（タイトル + URL）のみに任せる
  if (url) {
    el.removeAttribute('title');
  } else {
    el.title = title;
  }
  // タイトル本文・PR ボタン・ドラッグ可のいずれもない場合だけ "empty" 扱い。
  // PR ボタンだけのとき / 複数ペインのドラッグハンドルとして掴みたいときは
  // 高さを保つために empty クラスを付けない（renderLeaf() の初期描画と整合）。
  el.classList.toggle('empty', title.length === 0 && !prUrl && !canDragPane);
  el.classList.toggle('has-link', !!url);
  el.classList.toggle('has-pr', !!prUrl);
}

// .pane-status バッジ（ヘッダ最左）と .pane.waiting 枠点滅の両方を更新する。
// status は派生フィールドのため、waiting 系フラグ / t.status は呼び出し側で先にセット済みである前提。
function updatePaneStatus(paneId) {
  const t = terminals[paneId];
  if (!t) return;
  // 格納中ならコンパクト表示の状態バッジを更新する（.pane が無いため下の処理は素通りする）。
  updateStashItem(paneId);
  const paneEl = document.querySelector(`.pane[data-id="${paneId}"]`);
  if (!paneEl) return;
  // 枠の点滅アニメ（周辺視野での気付き用、issue #23 でも残置）は派生 waiting 準拠
  paneEl.classList.toggle('waiting', !!(t.waiting || t.externalWaiting));

  const badge = paneEl.querySelector('.pane-status');
  if (!badge) return;
  const status = t.status || 'idle';
  badge.dataset.status = status;
  // 視覚: ラベルテキスト（ドットは CSS の ::before で描画）。
  // a11y: aria-label でステータスを明示し、aria-live="polite" により変化のみ読み上げ。
  //       idle は visibility:hidden により読み上げ対象外（aria-live 非発火）。
  // ラベル / aria-label のマッピングは getStatusPresentation に集約（renderLeaf と共用）。
  const { label, ariaLabel } = getStatusPresentation(status);
  badge.textContent = label;
  if (ariaLabel) {
    badge.setAttribute('aria-label', ariaLabel);
  } else {
    badge.removeAttribute('aria-label');
  }

  // フォールバック表示（司＝ペイン status 写像）は status に追従するため、ここで更新する。
  updateAgentRoom(paneId);
}

// ─── Grid layout operations ──────────────────────────────────────────────────
// レイアウトはフラットなグリッド（tree.type === 'grid'）で管理する。
//   tree = { type:'grid', order:[paneId,...], colFr:null|number[], rowFr:null|number[] }
// 全ペインは grid 直下の兄弟であり、ペインがペインの中に入れ子になることはない。
// colFr / rowFr は手動リサイズ時のトラック比率（null = 均等）。ペイン増減時は null にリセットする。

// グリッドの列数（自動）。ほぼ正方形になるよう ceil(sqrt(n)) を採用し、行方向に折り返す。
function gridColCount(n) {
  if (n <= 1) return 1;
  return Math.ceil(Math.sqrt(n));
}

// 現在のグリッド寸法 { cols, rows } を返す。
function gridDims(t = tree) {
  const n = (t && Array.isArray(t.order)) ? t.order.length : 0;
  const cols = gridColCount(n);
  const rows = Math.max(1, Math.ceil(n / cols));
  return { cols, rows };
}

// 手動リサイズ比率をクリア（ペイン増減で寸法が変わったとき均等に戻す）。
function resetGridSizing() {
  if (tree) { tree.colFr = null; tree.rowFr = null; }
}

// 全ペイン ID を返す（グリッド order ＋ サイドバー格納 stashOrder の和集合）。
// fitAll・状態レポート・closePane の残ペイン算出などが依存するため、
// グリッドと格納の両方を必ず走査対象に含める（issue #89）。
function getAllLeafIds(t = tree) {
  if (!t) return [];
  const grid = Array.isArray(t.order) ? t.order : [];
  const stash = Array.isArray(t.stashOrder) ? t.stashOrder : [];
  return grid.concat(stash);
}

// グリッド上でペイン D&D の起点になれるか（issue #40）。
// D&D はグリッド内限定のため、格納分を含まないグリッドの order 件数で判定する（issue #89）。
// グリッドに 2 枚以上あるときのみドラッグ可（1 枚だと移動先が無い）。
function canDragGridPane() {
  return !!(tree && Array.isArray(tree.order) && tree.order.length > 1);
}

// ペインがグリッド・格納のいずれかに存在するか（issue #89 で格納分も含める）。
function paneExists(id) {
  if (!tree) return false;
  const inGrid = Array.isArray(tree.order) && tree.order.includes(id);
  const inStash = Array.isArray(tree.stashOrder) && tree.stashOrder.includes(id);
  return inGrid || inStash;
}

function getPaneRect(paneId) {
  const paneEl = document.querySelector(`.pane[data-id="${paneId}"]`);
  const rect = paneEl?.getBoundingClientRect();
  if (!rect || rect.width <= 0 || rect.height <= 0) return null;
  return rect;
}

function findLargestVisiblePaneId() {
  if (!tree) return null;

  let bestPaneId = null;
  let bestArea = -1;
  for (const paneId of getAllLeafIds(tree)) {
    const rect = getPaneRect(paneId);
    if (!rect) continue;
    const area = rect.width * rect.height;
    if (area > bestArea) {
      bestPaneId = paneId;
      bestArea = area;
    }
  }
  return bestPaneId;
}

// ─── Collapse / expand ────────────────────────────────────────────────────────
// （グリッドレイアウト化により折り畳み機能は撤去。行の高さは同一行の全ペインで共有されるため、
//   単一ペインだけを縦に畳む操作がグリッドでは成立しないため。）

// ─── Pane actions ─────────────────────────────────────────────────────────────
// グリッド化により「分割」は入れ子を作らず、新ペインをグリッド末尾に追加する操作になった。
// direction は後方互換のため引数として残すが、配置には影響しない（自動折返しグリッド）。
// 新規ペインをグリッド末尾に追加する（基準ペイン不要）。
// splitPane（＋ボタン）と空グリッドのプレースホルダ「新規ペインを追加」で共有する生成経路（issue #89）。
//   - overrideCwd が指定されていればそれを使い、未指定ならホームディレクトリ（main 側でフォールバック）で開く。
//   - options.noClaude が指定されていればそのまま main に渡す。未指定なら main 側のグローバル設定に従う。
async function addPane(overrideCwd = null, options = {}) {
  const newPaneId = newId();
  await createTerminal(newPaneId, overrideCwd || null, options);

  if (!Array.isArray(tree.order)) tree.order = [];
  tree.order.push(newPaneId);
  // ペイン数が変わりグリッド寸法が変化するため、手動リサイズ比率は均等にリセットする。
  resetGridSizing();

  render();
  requestAnimationFrame(() => {
    fitAll();
    focusPane(newPaneId);
  });

  // 新ペインの情報を返す（focusedPaneId の更新を待たずに確定値を返す）
  return { paneId: newPaneId, termId: terminals[newPaneId]?.termId };
}

// グリッド化により「分割」は入れ子を作らず、新ペインをグリッド末尾に追加する操作。
// 分割元ペインの cwd は継承しない（task-queue 等の特定ディレクトリにいるペインから分割しても
// 新ペインはデフォルト位置で開かせる方針）。
async function splitPane(paneId, direction, overrideCwd, options = {}) {
  if (!paneExists(paneId)) return null;
  return addPane(overrideCwd, options);
}

function closePane(paneId, { force = false, skipConfirm = false } = {}) {
  if (!paneExists(paneId)) return;
  const _t = terminals[paneId];
  if (!force && _t?.lock?.close === false) return;
  // 誤クローズ防止（issue #184）: 非 force パスでは confirmClose 設定と status に応じて
  // アプリ内確認ダイアログを挟む。force（HTTP API / PTY exit などの自動系）は従来どおり即閉じ。
  // lock.close === false のガードが確認より優先される（上の early return）。
  if (!force && !skipConfirm && shouldConfirmClose(confirmClosePref, _t?.status || 'idle')) {
    openCloseConfirmDialog(paneId);
    return;
  }

  const t = terminals[paneId];
  if (t) {
    // status の自動 idle 復帰タイマーが残っているとクロージャ経由で terminals[paneId] を
    // 参照し続けてしまうため、必ず破棄する（リーク防止）。
    clearRunningIdleTimer(t);
    // 静止ゲートの判定タイマーも同様にクロージャで terminals[paneId] を掴み続けるため破棄する。
    clearWaitingCheckTimer(t);
    // auto-input バッジの自動非表示タイマーも残っていればクリアする
    // （runningTimer と一貫させた防御的なクリーンアップ／issue #38）
    const paneEl = document.querySelector(`.pane[data-id="${paneId}"]`);
    const autoInputTimer = paneEl?.dataset.autoInputTimer;
    if (autoInputTimer) {
      clearTimeout(Number(autoInputTimer));
      delete paneEl.dataset.autoInputTimer;
    }
    // ホバー中に閉じられると leave が発火せず、position: fixed のツールチップが
    // 残り続けるため明示的に隠す（安藤レビュー指摘・LOW）。
    hideTermLinkTooltip();
    t.term.dispose();
    VKIpc.send('terminal:kill', t.termId);
    delete terminals[paneId];
    // ペイン内 URL クリックのフォーカスガード用に記録した値も、消えたペインの分は
    // 掃除しておく（issue #385。他の per-pane 状態と同じ扱い）。
    paneFocusBeforeMousedown.delete(paneId);
  }

  // グリッド・格納のどちらに居ても取り除く（issue #89）。
  tree.order = tree.order.filter(id => id !== paneId);
  tree.stashOrder = (Array.isArray(tree.stashOrder) ? tree.stashOrder : []).filter(id => id !== paneId);
  if (tree.order.length === 0 && tree.stashOrder.length === 0) {
    // Last pane closed → start fresh
    // 格納ペインが 1 枚でも生き残っている場合は巻き込んで作り直さない（issue #89）。
    initApp().then(() => {
      VKIpc.send('terminal:renderer-ready');
    });
    return;
  }
  // ペイン数が変わりグリッド寸法が変化するため、手動リサイズ比率は均等にリセットする。
  resetGridSizing();

  // Focus another pane
  // フォーカス先は可視グリッド（tree.order）の末尾を優先する。getAllLeafIds は格納分も
  // 含むため、その末尾を選ぶと非表示の格納ペインにフォーカスが移り、キー入力が見えない
  // ターミナルへ流れてしまう。可視ペインが 1 つも無い（全て格納中）ときはどこにも
  // フォーカスしない（null）（issue #89 / CodeRabbit 指摘）。
  if (!focusedPaneId || focusedPaneId === paneId) {
    const visible = Array.isArray(tree.order) ? tree.order : [];
    focusedPaneId = visible.length > 0 ? visible[visible.length - 1] : null;
  }

  render();
  requestAnimationFrame(fitAll);
}

// ─── ペインを閉じる確認ダイアログ（issue #184）───────────────────────────────
// OS ネイティブダイアログではなくアプリ内モーダルで確認する（フォーカス移動で
// ペイン状態が変わらないこと。status は PTY 出力/入力時刻の派生値なので、モーダルへの
// フォーカス移動では変化しない）。二重表示は closeConfirmOpen で防ぐ。
let closeConfirmOpen = false;

function openCloseConfirmDialog(paneId) {
  if (closeConfirmOpen) return;
  // URL にホバーしたままマウスを動かさず Tab で「✕」まで来て Enter で確定する経路では
  // xterm 側の leave が発火しない。確認ダイアログ（z-index 2100）の手前にツールチップ
  // （2300）が浮いたまま残るのを防ぐ（Claude Code レビュー指摘・LOW）。
  hideTermLinkTooltip();
  const restoreFocusElement = document.activeElement;
  closeConfirmOpen = true;

  const t = terminals[paneId];
  const { label } = getStatusPresentation(t?.status);
  // running / waiting はその旨を明示し、それ以外（'always' 設定の idle）は汎用文にする。
  const message = label
    ? `このペインは「${label}」です。閉じるとセッションは失われます。閉じますか？`
    : 'このペインを閉じますか？';

  const overlay = document.createElement('div');
  overlay.className = 'confirm-overlay';
  const modal = document.createElement('div');
  modal.className = 'confirm-modal';
  modal.setAttribute('role', 'alertdialog');
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('aria-label', 'ペインを閉じる確認');

  const msgEl = document.createElement('p');
  msgEl.className = 'confirm-message';
  msgEl.textContent = message;

  const actions = document.createElement('div');
  actions.className = 'confirm-actions';
  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.className = 'confirm-cancel';
  cancelBtn.textContent = 'キャンセル';
  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'confirm-close-pane';
  closeBtn.textContent = '閉じる';
  actions.appendChild(cancelBtn);
  actions.appendChild(closeBtn);

  modal.appendChild(msgEl);
  modal.appendChild(actions);
  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  let unregisterEscapeLayer = () => {};
  let releaseFocusTrap = () => {};
  const cleanup = () => {
    unregisterEscapeLayer();
    // 背後の inert はフォーカスを戻すより前に外す。付いたままだと復帰先への focus() が
    // 空振りし、閉じた後にフォーカスが画面全体へ落ちてしまう（issue #282）。
    releaseFocusTrap();
    // 画面から消す前に、いまフォーカスがダイアログ内にあるかを見る。外へ出ている場合まで
    // 引き戻すと、閉じるタイミングでユーザーの操作先からフォーカスを奪ってしまう。
    //
    // body の枝は背景クリック時の着地点として入れたものだが、いまはもう 1 つ効き所がある。
    // 設定パネルの上に重ねたダイアログを閉じる場合、直前の releaseFocusTrap() が下の
    // 設定パネルへトラップを引き直す過程でこの overlay 自身を inert にするため、ブラウザが
    // フォーカスを body へ落とす。つまり overlay.contains(active) は成立せず、復帰は
    // body の枝が担っている。順序を入れ替えるとここが静かに壊れるので注意（issue #282）。
    const active = document.activeElement;
    const shouldRestore = !active || active === document.body || overlay.contains(active);
    overlay.remove();
    closeConfirmOpen = false;
    if (shouldRestore && restoreFocusElement?.isConnected) restoreFocusElement.focus();
  };
  unregisterEscapeLayer = escapeLayers.register(cleanup);

  overlay.addEventListener('mousedown', (e) => {
    if (e.target !== overlay) return;
    // 削除済み overlay への既定のフォーカス移動で、cleanup() の復帰先が
    // body に上書きされないよう、背景クリックの既定動作を先に止める。
    e.preventDefault();
    cleanup();
  });
  cancelBtn.addEventListener('click', cleanup);
  closeBtn.addEventListener('click', () => {
    cleanup();
    // ダイアログ表示中に PTY exit 等で当該ペインが消えていても、closePane 冒頭の
    // paneExists ガードで no-op になる（誤って別ペインを閉じることはない）。
    closePane(paneId, { skipConfirm: true });
  });

  // ダイアログの中へフォーカスを閉じ込め、背後（ペインの ✕ や ☰）を操作できないようにする。
  // aria-modal="true" と宣言している以上、実際にも背後を止めておく（issue #282）。
  // 既定フォーカスは安全側（キャンセル）。Enter 誤爆で閉じてしまわないようにする。
  releaseFocusTrap = focusTraps.activate(modal, { initialFocus: cancelBtn });
}

// ─── アクセストークン再発行の確認ダイアログ（issue #313）─────────────────────
// openCloseConfirmDialog と同じパターン（アプリ内モーダル・role="alertdialog"・
// フォーカストラップ・Escape レイヤー・復帰フォーカス）を再利用する。OS ネイティブの
// window.confirm() を使わない理由は openCloseConfirmDialog 冒頭のコメントを参照
// （フォーカス移動の扱いをアプリの他のダイアログと統一するため）。
// 設定モーダルの上に重ねて開かれる想定（フォーカストラップのスタック構造は
// openCloseConfirmDialog の cleanup コメントのとおり、重ね開きに対応済み）。
let reissueTokenConfirmOpen = false;

function openReissueTokenConfirmDialog(onConfirm) {
  if (reissueTokenConfirmOpen) return;
  const restoreFocusElement = document.activeElement;
  reissueTokenConfirmOpen = true;

  const overlay = document.createElement('div');
  overlay.className = 'confirm-overlay';
  const modal = document.createElement('div');
  modal.className = 'confirm-modal';
  modal.setAttribute('role', 'alertdialog');
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('aria-label', 'アクセストークンの再発行確認');

  const msgEl = document.createElement('p');
  msgEl.className = 'confirm-message';
  msgEl.textContent = 'トークンを再発行しますか？登録済みのすべてのスマートフォンが使えなくなります（個別に無効化することはできません）。';

  const actions = document.createElement('div');
  actions.className = 'confirm-actions';
  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.className = 'confirm-cancel';
  cancelBtn.textContent = 'キャンセル';
  const confirmBtn = document.createElement('button');
  confirmBtn.type = 'button';
  confirmBtn.className = 'confirm-reissue-token';
  confirmBtn.textContent = '再発行する';
  actions.appendChild(cancelBtn);
  actions.appendChild(confirmBtn);

  modal.appendChild(msgEl);
  modal.appendChild(actions);
  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  let unregisterEscapeLayer = () => {};
  let releaseFocusTrap = () => {};
  const cleanup = () => {
    unregisterEscapeLayer();
    releaseFocusTrap();
    const active = document.activeElement;
    const shouldRestore = !active || active === document.body || overlay.contains(active);
    overlay.remove();
    reissueTokenConfirmOpen = false;
    if (shouldRestore && restoreFocusElement?.isConnected) restoreFocusElement.focus();
  };
  unregisterEscapeLayer = escapeLayers.register(cleanup);

  overlay.addEventListener('mousedown', (e) => {
    if (e.target !== overlay) return;
    e.preventDefault();
    cleanup();
  });
  cancelBtn.addEventListener('click', cleanup);
  confirmBtn.addEventListener('click', () => {
    cleanup();
    onConfirm();
  });

  // 既定フォーカスは安全側（キャンセル）。Enter 誤爆で再発行してしまわないようにする。
  releaseFocusTrap = focusTraps.activate(modal, { initialFocus: cancelBtn });
}

// ─── 設定コンテンツテーブルの一括切り替え確認（issue #380）─────────────────────
// openCloseConfirmDialog / openReissueTokenConfirmDialog と全く同じパターン
// （アプリ内モーダル・role="alertdialog"・フォーカストラップ・Escape レイヤー・復帰
// フォーカス）を再利用する。message は呼び出し側（applyButton の click ハンドラ）が
// 「{count}」を実際の対象件数へ置き換え済みの文字列を渡す。
let contentTableApplyConfirmOpen = false;

function openApplyContentTableConfirmDialog(message, onConfirm) {
  if (contentTableApplyConfirmOpen) return;
  const restoreFocusElement = document.activeElement;
  contentTableApplyConfirmOpen = true;

  const overlay = document.createElement('div');
  overlay.className = 'confirm-overlay';
  const modal = document.createElement('div');
  modal.className = 'confirm-modal';
  modal.setAttribute('role', 'alertdialog');
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('aria-label', '設定の一括切り替え確認');

  const msgEl = document.createElement('p');
  msgEl.className = 'confirm-message';
  msgEl.textContent = message;

  const actions = document.createElement('div');
  actions.className = 'confirm-actions';
  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.className = 'confirm-cancel';
  cancelBtn.textContent = 'キャンセル';
  const confirmBtn = document.createElement('button');
  confirmBtn.type = 'button';
  confirmBtn.className = 'confirm-apply-content-table';
  confirmBtn.textContent = '上書きする';
  actions.appendChild(cancelBtn);
  actions.appendChild(confirmBtn);

  modal.appendChild(msgEl);
  modal.appendChild(actions);
  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  let unregisterEscapeLayer = () => {};
  let releaseFocusTrap = () => {};
  const cleanup = () => {
    unregisterEscapeLayer();
    releaseFocusTrap();
    const active = document.activeElement;
    const shouldRestore = !active || active === document.body || overlay.contains(active);
    overlay.remove();
    contentTableApplyConfirmOpen = false;
    if (shouldRestore && restoreFocusElement?.isConnected) restoreFocusElement.focus();
  };
  unregisterEscapeLayer = escapeLayers.register(cleanup);

  overlay.addEventListener('mousedown', (e) => {
    if (e.target !== overlay) return;
    e.preventDefault();
    cleanup();
  });
  cancelBtn.addEventListener('click', cleanup);
  confirmBtn.addEventListener('click', () => {
    cleanup();
    onConfirm();
  });

  // 既定フォーカスは安全側（キャンセル）。Enter 誤爆で上書きしてしまわないようにする。
  releaseFocusTrap = focusTraps.activate(modal, { initialFocus: cancelBtn });
}

// ペインをグリッド上で左右の隣と入れ替える。端で隣が無ければ何もしない。
function movePane(paneId, dir) {
  const order = tree.order;
  const i = order.indexOf(paneId);
  if (i < 0) return;
  const { cols } = gridDims();
  let j = -1;
  if (dir === 'left'  && i % cols !== 0) j = i - 1;
  else if (dir === 'right' && i % cols !== cols - 1 && i + 1 < order.length) j = i + 1;
  if (j < 0) return;
  [order[i], order[j]] = [order[j], order[i]];
  render();
  requestAnimationFrame(() => {
    fitAll();
    focusPane(paneId);
  });
}

// ─── Pane stash: サイドバーへの格納 / 復帰（issue #89）──────────────────────────
// グリッド order とは別配列 stashOrder で管理する。xterm 要素（t.element）は破棄せず、
// render() の appendChild 付け替えで格納コンテナ／グリッドコンテナ間を移動させる。

// グリッドのペインをサイドバーへ格納する。
function stashPane(paneId) {
  if (!tree || !Array.isArray(tree.order)) return;
  const i = tree.order.indexOf(paneId);
  if (i < 0) return;
  tree.order.splice(i, 1);
  tree.stashOrder = Array.isArray(tree.stashOrder) ? tree.stashOrder : [];
  tree.stashOrder.push(paneId);
  // 格納直後は xterm を折り畳んだコンパクト表示にする。
  const t = terminals[paneId];
  if (t) t.stashXtermOpen = false;
  // グリッドの寸法が変わるため手動リサイズ比率を均等に戻す。
  resetGridSizing();
  // 格納したペインにフォーカスがあった場合はグリッドの残ペインへ移す。
  if (focusedPaneId === paneId) {
    focusedPaneId = tree.order.length > 0 ? tree.order[tree.order.length - 1] : paneId;
  }
  render();
  // 格納先を知らせるためサイドバーを開く（フォーカスはグリッドに残す）。
  setSidebarOpen(true, { focusFirst: false });
  requestAnimationFrame(() => {
    fitAll();
    if (tree.order.length > 0) focusPane(focusedPaneId);
  });
}

// 格納中のペインをグリッドへ戻す。
function unstashPane(paneId) {
  if (!tree) return;
  tree.stashOrder = Array.isArray(tree.stashOrder) ? tree.stashOrder : [];
  const i = tree.stashOrder.indexOf(paneId);
  if (i < 0) return;
  tree.stashOrder.splice(i, 1);
  if (!Array.isArray(tree.order)) tree.order = [];
  tree.order.push(paneId);
  resetGridSizing();
  render();
  requestAnimationFrame(() => {
    fitAll();
    focusPane(paneId);
  });
}

// 格納エリア内でペインを上下に入れ替える（stashOrder の index swap）。
function moveStashPane(paneId, dir) {
  const arr = tree && tree.stashOrder;
  if (!Array.isArray(arr)) return;
  const i = arr.indexOf(paneId);
  if (i < 0) return;
  const j = dir === 'up' ? i - 1 : i + 1;
  if (j < 0 || j >= arr.length) return;
  [arr[i], arr[j]] = [arr[j], arr[i]];
  render();
  requestAnimationFrame(fitAll);
}

// 格納ペインの xterm 表示/非表示をトグルする（― ボタン）。
// 非表示（display:none）からの復帰時は 0 サイズ基準のままになるため再フィットする。
function toggleStashXterm(paneId) {
  const t = terminals[paneId];
  if (!t) return;
  t.stashXtermOpen = !t.stashXtermOpen;
  const li = document.querySelector(`.stash-item[data-id="${paneId}"]`);
  if (li) {
    li.classList.toggle('stash-xterm-open', t.stashXtermOpen);
    const btn = li.querySelector('.btn-stash-toggle');
    if (btn) {
      btn.setAttribute('aria-expanded', t.stashXtermOpen ? 'true' : 'false');
      // 開閉状態に応じてグリフ・ラベルも切り替える（視覚状態の可視化）。
      btn.textContent = stashToggleGlyph(t.stashXtermOpen);
      btn.title = stashToggleLabel(t.stashXtermOpen);
      btn.setAttribute('aria-label', stashToggleLabel(t.stashXtermOpen));
    }
  }
  if (t.stashXtermOpen) {
    requestAnimationFrame(() => {
      fitTerminal(paneId);
      focusPane(paneId);
    });
  }
}

// ─── Pane D&D helpers (issue #40) ────────────────────────────────────────────
// dragover の event 座標から、対象ペイン内のドロップ方向を算出する。
//   - 中央 PANE_DROP_DEADZONE (= 0.2) 範囲は無効（null を返す）
//   - 外周は最も端に近い辺（左/右/上/下）を選ぶ
// 引数は対象ペインの DOM 要素と dragover イベント。
function computePaneDropDir(paneEl, event) {
  const rect = paneEl.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return null;
  // offsetX/Y は paneEl 基準ではない場合があるので getBoundingClientRect ベースで再計算する
  const x = event.clientX - rect.left;
  const y = event.clientY - rect.top;
  const fx = x / rect.width;   // 0..1
  const fy = y / rect.height;  // 0..1
  // 中央デッドゾーン: 中心からの距離が PANE_DROP_DEADZONE/2 以内
  const dz = PANE_DROP_DEADZONE / 2;
  if (Math.abs(fx - 0.5) <= dz && Math.abs(fy - 0.5) <= dz) return null;
  // 各辺までの距離（正規化後）
  const distLeft = fx;
  const distRight = 1 - fx;
  const distTop = fy;
  const distBottom = 1 - fy;
  const min = Math.min(distLeft, distRight, distTop, distBottom);
  if (min === distLeft) return 'left';
  if (min === distRight) return 'right';
  if (min === distTop) return 'up';
  return 'down';
}

// `#pane-drop-indicator` を body 直下にグローバル 1 個だけ用意して使い回す。
// `dragover` で対象ペインの矩形 + dir からその半分を半透明アクセントカラーで塗りつぶす。
// pointer-events: none 必須（オーバーレイ自身が dragover を奪わないため）。
function getPaneDropIndicator() {
  let el = document.getElementById('pane-drop-indicator');
  if (!el) {
    el = document.createElement('div');
    el.id = 'pane-drop-indicator';
    document.body.appendChild(el);
  }
  return el;
}

function updatePaneDropIndicator(paneEl, dir) {
  const indicator = getPaneDropIndicator();
  if (!dir) {
    indicator.style.display = 'none';
    return;
  }
  const r = paneEl.getBoundingClientRect();
  let top = r.top;
  let left = r.left;
  let width = r.width;
  let height = r.height;
  // dir 方向の半分の矩形に縮める
  if (dir === 'left') {
    width = r.width / 2;
  } else if (dir === 'right') {
    left = r.left + r.width / 2;
    width = r.width / 2;
  } else if (dir === 'up') {
    height = r.height / 2;
  } else if (dir === 'down') {
    top = r.top + r.height / 2;
    height = r.height / 2;
  }
  indicator.style.display = 'block';
  indicator.style.top = `${top}px`;
  indicator.style.left = `${left}px`;
  indicator.style.width = `${width}px`;
  indicator.style.height = `${height}px`;
}

function removePaneDropIndicator() {
  const el = document.getElementById('pane-drop-indicator');
  if (el) el.style.display = 'none';
}

// drop 完了後 / dragend / キャンセル時の共通クリーンアップ。
function cleanupPaneDrag() {
  document.body.classList.remove('pane-dragging');
  document.querySelectorAll('.pane.pane-drag-source').forEach(el => {
    el.classList.remove('pane-drag-source');
  });
  removePaneDropIndicator();
  paneDragState = null;
}

// ペイン D&D による並べ替え（issue #40 → グリッド化で「並べ替え」に変更）。
// src ペインを order から抜き、target の位置へ挿入する。
//   dir が left/up  … target の直前へ
//   dir が right/down … target の直後へ
function handlePaneDrop(srcId, targetId, dir) {
  if (!tree) return;
  if (!srcId || !targetId || srcId === targetId) return;
  if (!paneExists(srcId) || !paneExists(targetId)) return;

  const order = tree.order;
  const from = order.indexOf(srcId);
  order.splice(from, 1);

  let ti = order.indexOf(targetId);
  if (dir === 'right' || dir === 'down') ti += 1;
  order.splice(ti, 0, srcId);

  // 並べ替えで各行の割り当てが変わるため、手動リサイズ比率は均等にリセットする。
  resetGridSizing();

  render();
  requestAnimationFrame(() => {
    fitAll();
    focusPane(srcId);
  });
}

function focusPane(paneId) {
  focusedPaneId = paneId;
  document.querySelectorAll('.pane').forEach(el => {
    el.classList.toggle('focused', el.dataset.id === paneId);
  });
  // 格納ペイン（サイドバー内）のフォーカスリングも同期する（issue #89）。
  document.querySelectorAll('.stash-item').forEach(el => {
    el.classList.toggle('focused', el.dataset.id === paneId);
  });
  terminals[paneId]?.term.focus();
}

function fitTerminal(paneId) {
  const t = terminals[paneId];
  if (!t) return;
  // 非表示（格納中で xterm を折り畳み中など、祖先が display:none）のときは
  // 0 サイズでのフィット→pty への誤リサイズを避けるためスキップする（issue #89）。
  if (t.element && t.element.offsetParent === null) return;
  try {
    t.fitAddon.fit();
    VKIpc.send('terminal:resize', t.termId, t.term.cols, t.term.rows);
  } catch (e) {}
}

function fitAll() {
  getAllLeafIds(tree).forEach(fitTerminal);
}

// ─── Rendering ────────────────────────────────────────────────────────────────
function render() {
  // #root を丸ごと作り直す（root.replaceChildren）ため、ホバー中に呼ばれると
  // xterm 側の要素が入れ替わり leave が発火せず、position: fixed のツールチップが
  // 残り続ける。closePane() / initApp() / window の blur と同じ対策（安藤・Claude Code
  // レビュー指摘・LOW）。
  hideTermLinkTooltip();
  const root = document.getElementById('root');
  const sidebar = ensureSidebar(root);
  const newContent = renderGrid(tree);
  root.replaceChildren(sidebar, newContent);
  root.classList.toggle('sidebar-open', sidebarOpen);

  // 格納ペインのコンパクト表示を作り直す（nav が root に付いた後に実行する）。
  renderPaneStash();
  // 現在のサイドバー幅を CSS 変数・aria へ反映（issue #89）。
  setSidebarWidth(getSidebarWidth());

  // Reattach terminal elements (moved, not recreated)
  // グリッド側（.pane）と格納側（.stash-item）のどちらのコンテナへも付け替える。
  getAllLeafIds(tree).forEach(paneId => {
    const t = terminals[paneId];
    if (!t) return;
    const container = root.querySelector(`.pane[data-id="${paneId}"] .term-container`)
      || root.querySelector(`.stash-item[data-id="${paneId}"] .term-container`);
    if (container) {
      container.appendChild(t.element);
      // Open xterm after element is in the DOM (required for correct sizing)
      if (!t.opened) {
        t.term.open(t.element);
        t.opened = true;
      }
    }
  });

  // Observe pane resizes
  observePanes();
}

// フラットなグリッドを描画する。全ペインは .grid の直接の子として並ぶ。
//   - 列数は gridColCount(n)（自動折返し）。
//   - colFr / rowFr があれば fr トラックに反映（手動リサイズ結果）。無ければ均等。
//   - 最終行がフルでない場合、最後のペインを残りの列に広げてスキマを埋める。
//   - 列間・行間にドラッグ用リサイズハンドルをオーバーレイする。
// グリッドが空（全ペイン格納中など）のときのプレースホルダ（issue #89）。
// 空セルだけで行き止まりにならないよう、復帰導線を明示する。
//   - 「新規ペインを追加」: ＋ と同じ生成経路（addPane）で新規ペインを作る。
//   - 「サイドバーを開いて戻す」: ドロワーを開き、格納ペインを戻せるようにする。
function renderEmptyGrid() {
  const wrap = document.createElement('div');
  wrap.className = 'grid grid-empty';

  const box = document.createElement('div');
  box.className = 'grid-empty-box';

  const title = document.createElement('div');
  title.className = 'grid-empty-title';
  title.textContent = 'すべてのペインを格納中です';

  const desc = document.createElement('div');
  desc.className = 'grid-empty-desc';
  desc.textContent = 'グリッドに表示するペインがありません。新規ペインを追加するか、サイドバーから格納したペインを戻してください。';

  const actions = document.createElement('div');
  actions.className = 'grid-empty-actions';

  const addBtn = document.createElement('button');
  addBtn.type = 'button';
  addBtn.className = 'grid-empty-btn';
  addBtn.textContent = '新規ペインを追加';
  addBtn.setAttribute('aria-label', '新規ペインを追加');
  addBtn.addEventListener('click', () => { addPane(newPaneStartupDir || null, { noClaude: !newPaneAutoLaunchClaude }); });

  const openBtn = document.createElement('button');
  openBtn.type = 'button';
  openBtn.className = 'grid-empty-btn grid-empty-btn-secondary';
  openBtn.textContent = 'サイドバーを開いて戻す';
  openBtn.setAttribute('aria-label', 'サイドバーを開いて格納したペインを戻す');
  openBtn.addEventListener('click', () => setSidebarOpen(true, { focusFirst: true }));

  actions.appendChild(addBtn);
  actions.appendChild(openBtn);
  box.appendChild(title);
  box.appendChild(desc);
  box.appendChild(actions);
  wrap.appendChild(box);
  return wrap;
}

function renderGrid(t) {
  const order = (t && Array.isArray(t.order)) ? t.order : [];
  // グリッドが空のときは行き止まり回避のプレースホルダを返す（issue #89）。
  if (order.length === 0) return renderEmptyGrid();
  const { cols, rows } = gridDims(t);

  const grid = document.createElement('div');
  grid.className = 'grid';
  grid.style.gridTemplateColumns = (t.colFr && t.colFr.length === cols)
    ? t.colFr.map(f => `${f}fr`).join(' ')
    : `repeat(${cols}, 1fr)`;
  grid.style.gridTemplateRows = (t.rowFr && t.rowFr.length === rows)
    ? t.rowFr.map(f => `${f}fr`).join(' ')
    : `repeat(${rows}, 1fr)`;

  const lastRowCount = order.length % cols || cols;
  order.forEach((id, idx) => {
    const pane = renderLeaf({ type: 'leaf', id });
    // 最終行がフルでないとき、最後のペインを余った列ぶんだけ広げてスキマを埋める。
    if (idx === order.length - 1 && lastRowCount < cols) {
      pane.style.gridColumn = `span ${cols - lastRowCount + 1}`;
    }
    grid.appendChild(pane);
  });

  appendGridHandles(grid, t, cols, rows);
  return grid;
}

// 列間（縦線）・行間（横線）にリサイズハンドルを絶対配置で重ねる。
// 位置は fr トラックの累積比率（%）で計算する（gap ぶんの微小なズレはハンドル幅で吸収）。
function appendGridHandles(grid, t, cols, rows) {
  const colFr = (t.colFr && t.colFr.length === cols) ? t.colFr : Array(cols).fill(1);
  const rowFr = (t.rowFr && t.rowFr.length === rows) ? t.rowFr : Array(rows).fill(1);
  const colTotal = colFr.reduce((a, b) => a + b, 0);
  const rowTotal = rowFr.reduce((a, b) => a + b, 0);

  let acc = 0;
  for (let i = 0; i < cols - 1; i++) {
    acc += colFr[i];
    const h = document.createElement('div');
    h.className = 'grid-handle grid-handle-col';
    h.style.left = `${(acc / colTotal) * 100}%`;
    h.addEventListener('mousedown', e => startGridResize(e, grid, 'col', i, cols, rows));
    grid.appendChild(h);
  }
  let accR = 0;
  for (let j = 0; j < rows - 1; j++) {
    accR += rowFr[j];
    const h = document.createElement('div');
    h.className = 'grid-handle grid-handle-row';
    h.style.top = `${(accR / rowTotal) * 100}%`;
    h.addEventListener('mousedown', e => startGridResize(e, grid, 'row', j, cols, rows));
    grid.appendChild(h);
  }
}

// ─── Agent room: 状態の解決と描画（issue #58） ───────────────────────────────
// ルームに表示する各キャラの状態 { name: state } を決める。
//   1. HTTP API（POST /api/agentroom）由来の t.agentRoom が「新鮮」ならそれを最優先で採用。
//   2. API が未通知 / 古い場合は PTY 出力ベースのフォールバック（A 方式）:
//        - 司（メイン Claude）= ペイン status を写像（running→working / waiting→consulting / idle→idle）
//        - その他のサブエージェント = 直近の出力にその名前が出ていれば作業中とみなす（ベストエフォート）
//   3. API が一部の人だけ報告している場合、未報告の人はフォールバック値で補完する。
function resolveRoomAgents(t) {
  const now = Date.now();
  const fresh = !!(t && t.agentRoom
    && t.agentRoomUpdatedAt
    && (now - t.agentRoomUpdatedAt <= AGENTROOM_API_TTL_MS)
    && Object.keys(t.agentRoom).length > 0);

  const status = (t && t.status) || 'idle';
  const directorState = status === 'waiting' ? 'consulting'
    : status === 'running' ? 'working'
    : 'idle';
  // フォールバック時のみ直近出力をスキャンする（API 新鮮時は不要）。
  // サブエージェントの稼働判定は agentRoom.js の純粋関数に委譲（英語ハンドル基準・issue #60）。
  const recent = fresh ? '' : stripAnsiForDisplay((t && t.lastLines) || '');
  const subStates = resolveAgentStatesFromOutput(recent);

  const out = {};
  for (const name of AGENT_ORDER) {
    if (name === '司') out[name] = directorState;
    else out[name] = subStates[name] || 'idle';
  }
  // API 報告分で上書き（未報告の人はフォールバック値のまま残る）。
  if (fresh) {
    for (const [name, state] of Object.entries(t.agentRoom)) {
      if (typeof state === 'string') out[name] = state;
    }
  }
  return out;
}

// 指定の .agent-room-body 要素にシーンを描画する（DOM 取得を伴わない純粋な描画）。
function renderRoomInto(bodyEl, t) {
  bodyEl.innerHTML = '';
  bodyEl.appendChild(buildScene(resolveRoomAgents(t)));
}

// ペインのエージェントルーム表示を最新状態へ更新する（DOM 探索あり）。
// status 変化（updatePaneStatus）や API 受信（terminal:agentroom）から呼ぶ。
function updateAgentRoom(paneId) {
  if (!agentRoomEnabled) return;
  const t = terminals[paneId];
  if (!t) return;
  const body = document.querySelector(`.pane[data-id="${paneId}"] .agent-room-body`);
  if (body) {
    renderRoomInto(body, t);
    t.agentRoomSig = JSON.stringify(resolveRoomAgents(t)); // 直近描画した状態を記録（差分判定用）
  }
}

// 定期再評価用（2000ms interval から呼ぶ）。
// API 失効（AGENTROOM_API_TTL_MS 超過）後、出力が止まったペインでも古い表示が残り続ける問題（issue #58）
// への対処。解決後の状態が前回描画と変わったときだけ再描画し、無駄な再描画を避ける。
function refreshAgentRoomIfChanged(paneId) {
  if (!agentRoomEnabled) return;
  const t = terminals[paneId];
  if (!t) return;
  const sig = JSON.stringify(resolveRoomAgents(t));
  if (sig === t.agentRoomSig) return; // 変化なし → 再描画しない
  updateAgentRoom(paneId);
}

function renderLeaf(node) {
  const t = terminals[node.id];
  const cwd = t?.cwd || '~';
  const waiting = !!(t && (t.waiting || t.externalWaiting));
  // 表示用ステータス（issue #23, #27）。idle 時は CSS の visibility:hidden で不可視のまま幅は保持。
  // ドットは CSS の .pane-status::before（currentColor）で描画するため、ラベルはテキストのみ。
  // ラベル / aria-label の対応は getStatusPresentation に集約（updatePaneStatus と共用）。
  const status = t?.status || 'idle';
  const { label: statusLabel, ariaLabel: statusAriaLabel } = getStatusPresentation(status);
  const focused = node.id === focusedPaneId;
  // apiTitle（API 由来）優先、無ければ taskTitle（OSC 由来）にフォールバック。
  const taskTitle = getDisplayTitle(t);
  // apiTitle 表示時かつ apiUrl があるときのみリンク化（OSC 由来時は URL を出さない）
  const taskUrl = getDisplayUrl(t);
  // PR ボタン用 URL（issue #44）。renderer 側でも http(s) 二段チェックを通す。
  const taskPrUrl = isSafeExternalUrl(t?.apiPrUrl) ? t.apiPrUrl : '';
  const taskPrMerged = !!t?.apiPrMerged;
  const taskWaitingMerge = !!t?.apiWaitingMerge;
  const closeLocked = isCloseLocked(t);
  const closeLabel = closeButtonLabel(closeLocked);

  const el = document.createElement('div');
  el.className = 'pane'
    + (focused ? ' focused' : '')
    + (waiting ? ' waiting' : '');
  el.dataset.id = node.id;

  // タスクタイトル行（OSC 0/2 または POST /api/set-title で設定された文字列を表示）。
  // 空のときは .empty クラスで非表示にし、xterm の表示領域を圧迫しない。
  // apiUrl があるときは .has-link を付与し、内部を <a> 化する（renderTaskTitleContent）。
  // ペイン D&D の可否判定（issue #40 / #89）。判定式は canDragGridPane に集約。
  // 空タイトル時も D&D 可なら .empty を付けず、ハンドルとして掴める高さを確保する。
  const canDragPane = canDragGridPane();
  const taskTitleEl = document.createElement('div');
  // empty 判定はタイトル本文・ドラッグ可・PR ボタンのいずれもないとき。
  // PR ボタンだけでも表示するためにこの条件で扱う（issue #44）。
  const isEmpty = !taskTitle && !canDragPane && !taskPrUrl;
  taskTitleEl.className = 'pane-task-title'
    + (isEmpty ? ' empty' : '')
    + (taskUrl ? ' has-link' : '')
    + (taskPrUrl ? ' has-pr' : '');
  renderTaskTitleContent(taskTitleEl, taskTitle, taskUrl, taskPrUrl, taskPrMerged, taskWaitingMerge);
  // URL 有りのときは子 <a> 側の title 属性に集約するため、親には付けない（親子競合回避）。
  if (taskTitle && !taskUrl) taskTitleEl.title = taskTitle;
  if (canDragPane) {
    taskTitleEl.draggable = true;
    taskTitleEl.addEventListener('dragstart', e => {
      // 独自 MIME に paneId を載せる。これにより受け側はファイル D&D と分岐できる。
      try {
        e.dataTransfer.setData(PANE_DRAG_MIME, node.id);
      } catch (_e) { /* setData が失敗しても続行 */ }
      e.dataTransfer.effectAllowed = 'move';
      paneDragState = { srcId: node.id, lastTargetId: null, lastDir: null };
      document.body.classList.add('pane-dragging');
      el.classList.add('pane-drag-source');
    });
    taskTitleEl.addEventListener('dragend', () => {
      // 念のための後始末。drop ハンドラが先に動いていればここはすべて no-op になる。
      cleanupPaneDrag();
    });
  }
  el.appendChild(taskTitleEl);

  const header = document.createElement('div');
  header.className = 'pane-header';
  // .pane-status はヘッダ最左に常時挿入し、CSS の data-status="idle" を visibility:hidden で扱う。
  // role="status" + aria-live="polite" で SR にステータス変化を通知（aria-label は動的更新）。
  // 共通バッジ basis は .pane-badge（issue #27）、固有スタイルは .pane-status / .auto-input-badge。
  // 旧 .waiting-badge は role を .pane-status に一本化したため削除済（issue #23）。
  //
  // セキュリティ: テンプレートリテラル経由で innerHTML に挿入する外部由来の文字列は
  // escAttr / escText でエスケープする（issue #39）。
  //   - status / statusAriaLabel: 内部状態だが将来の外部入力統合を想定し防御的にエスケープ
  //   - cwd: OS ファイルシステム由来。ディレクトリ名に `"` や `<` を含めることは技術的に可能
  //   - statusLabel: getStatusPresentation() からの静的文字列だが、念のためエスケープ
  header.innerHTML = `
    <span class="pane-badge pane-status" data-status="${escAttr(status)}" role="status" aria-live="polite"${statusAriaLabel ? ` aria-label="${escAttr(statusAriaLabel)}"` : ''}>${escText(statusLabel)}</span>
    <span class="pane-cwd" title="${escAttr(cwd)}">${escText(cwd)}</span>
    <div class="pane-actions">
      <span class="pane-badge auto-input-badge" hidden></span>
      <button class="btn btn-stash" title="サイドバーに格納" aria-label="サイドバーに格納">←</button>
      <span class="pane-actions-sep" aria-hidden="true"></span>
      <button class="btn btn-move btn-move-left" title="左へ移動" aria-label="左へ移動">◀</button>
      <button class="btn btn-move btn-move-right" title="右へ移動" aria-label="右へ移動">▶</button>
      <button class="btn btn-split" title="ペインを追加" aria-label="ペインを追加">＋</button>
      <button class="btn btn-close${closeLocked ? ' is-locked' : ''}" title="${escAttr(closeLabel)}" aria-label="${escAttr(closeLabel)}"${closeLocked ? ' aria-disabled="true"' : ''}>✕</button>
    </div>
  `;
  // ドラッグ中に複数ファイルのヒントを表示
  header.setAttribute('title', 'ファイルをドラッグ&ドロップでパスを入力（複数ファイル可）');

  const termContainer = document.createElement('div');
  termContainer.className = 'term-container';

  el.appendChild(header);
  el.appendChild(termContainer);

  // ─── エージェントルーム（issue #58） ───────────────────────────────────────
  // config.json の `agentroom: true` のときだけ、ペイン下部に開閉式の
  // 「エージェントルーム」を出す。開閉状態は t.agentRoomOpen で再 render をまたいで保持する。
  if (agentRoomEnabled) {
    const room = document.createElement('details');
    room.className = 'agent-room';
    if (t && t.agentRoomOpen) room.open = true;

    const summary = document.createElement('summary');
    summary.className = 'agent-room-summary';
    summary.innerHTML = '<span class="agent-room-icon" aria-hidden="true">🏠</span>'
      + '<span class="agent-room-title">エージェントルーム</span>';

    const body = document.createElement('div');
    body.className = 'agent-room-body';

    room.appendChild(summary);
    room.appendChild(body);

    room.addEventListener('toggle', () => {
      const cur = terminals[node.id];
      if (cur) cur.agentRoomOpen = room.open;
    });

    if (t) renderRoomInto(body, t);
    el.appendChild(room);
  }

  header.querySelector('.btn-stash').addEventListener('click', e => {
    e.stopPropagation();
    stashPane(node.id);
  });
  header.querySelector('.btn-move-left').addEventListener('click', e => {
    e.stopPropagation();
    movePane(node.id, 'left');
  });
  header.querySelector('.btn-move-right').addEventListener('click', e => {
    e.stopPropagation();
    movePane(node.id, 'right');
  });
  header.querySelector('.btn-split').addEventListener('click', e => {
    e.stopPropagation();
    splitPane(node.id, 'h', newPaneStartupDir || null, { noClaude: !newPaneAutoLaunchClaude });
  });
  header.querySelector('.btn-close').addEventListener('click', e => {
    e.stopPropagation();
    if (terminals[node.id]?.lock?.close === false) return;
    closePane(node.id);
  });
  el.addEventListener('mousedown', () => {
    // ペイン内 URL クリックのフォーカスガード（issue #385）: このペインが「切り替わる直前」
    // 既にフォーカス済みだったかを、focusPane() で書き換える前に記録しておく。xterm.js の
    // Linkifier は mousedown ではなく後続の mouseup で activate を呼ぶため、記録を怠ると
    // activate 発火時点では既にこの focusPane() でフォーカスが切り替わった後の値しか
    // 読めなくなる（詳細は utils/terminalLinkPolicy.js の createTerminalLinkHandlers
    // 冒頭コメント参照）。格納ペイン（.stash-item）側にも同じ記録が必要なため、直書きせず
    // 共通ヘルパー recordPaneFocusBeforeMousedown() 経由にする（レビュー指摘・MEDIUM-1）。
    recordPaneFocusBeforeMousedown(node.id);
    focusPane(node.id);
  });

  // ─── Drag & Drop: pane reordering (issue #40 → グリッド化で並べ替えに変更) ──
  // 別ペインのタスクタイトル行をドラッグして、このペインの左/上（前）・右/下（後）に
  // ドロップすると、グリッド内の並び順を入れ替える。同一ペインへのドロップは no-op。
  // ファイル D&D（パス挿入）とは独自 MIME（PANE_DRAG_MIME）で分岐する。
  el.addEventListener('dragover', e => {
    if (!e.dataTransfer.types.includes(PANE_DRAG_MIME)) return;
    if (!paneDragState) return;
    // 同一ペインへのドロップは無効化（インジケータも出さない）
    if (paneDragState.srcId === node.id) {
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = 'none';
      // 同一ペイン上ではオーバーレイを消しておく
      if (paneDragState.lastTargetId !== null) {
        removePaneDropIndicator();
        paneDragState.lastTargetId = null;
        paneDragState.lastDir = null;
      }
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    const dir = computePaneDropDir(el, e);
    // 中央デッドゾーン（dir=null）はカーソルを no-drop に。オーバーレイも消す。
    e.dataTransfer.dropEffect = dir ? 'move' : 'none';
    // 前フレームと同じ判定ならオーバーレイ更新スキップ（負荷低減）
    if (paneDragState.lastTargetId === node.id && paneDragState.lastDir === dir) return;
    paneDragState.lastTargetId = node.id;
    paneDragState.lastDir = dir;
    updatePaneDropIndicator(el, dir);
  });
  el.addEventListener('dragleave', e => {
    if (!paneDragState) return;
    if (!e.dataTransfer.types.includes(PANE_DRAG_MIME)) return;
    // ペイン要素の外（自要素内の子から親自身は relatedTarget が自要素になりうるので除外）
    if (!el.contains(e.relatedTarget)) {
      if (paneDragState.lastTargetId === node.id) {
        removePaneDropIndicator();
        paneDragState.lastTargetId = null;
        paneDragState.lastDir = null;
      }
    }
  });
  el.addEventListener('drop', e => {
    if (!e.dataTransfer.types.includes(PANE_DRAG_MIME)) return;
    if (!paneDragState) return;
    e.preventDefault();
    e.stopPropagation();
    const srcId = e.dataTransfer.getData(PANE_DRAG_MIME) || paneDragState.srcId;
    // 同一ペインは no-op
    if (!srcId || srcId === node.id) {
      cleanupPaneDrag();
      return;
    }
    const dir = computePaneDropDir(el, e);
    if (!dir) {
      // デッドゾーン（中央20%）は何もしない
      cleanupPaneDrag();
      return;
    }
    handlePaneDrop(srcId, node.id, dir);
    cleanupPaneDrag();
  });

  // ─── Drag & Drop: file path insertion ─────────────────────────────────────
  el.addEventListener('dragover', e => {
    if (!e.dataTransfer.types.includes('Files')) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'copy';
    el.classList.add('drag-over');
  });

  el.addEventListener('dragleave', e => {
    // Only remove highlight when leaving the pane element itself
    if (!el.contains(e.relatedTarget)) {
      el.classList.remove('drag-over');
    }
  });

  el.addEventListener('drop', e => {
    if (!e.dataTransfer.types.includes('Files')) return;
    e.preventDefault();
    e.stopPropagation();
    resetFileDragState();

    const files = Array.from(e.dataTransfer.files);
    if (files.length === 0) return;

    // Always wrap in single quotes for shell safety (handles spaces, quotes, and all metacharacters)
    const paths = files
      .map(f => f.path)
      .filter(Boolean)
      .map(p => `'${p.replace(/'/g, "'\\''")}'`);

    const text = paths.join(' ');
    focusPane(node.id);
    const t = terminals[node.id];
    if (t) {
      VKIpc.send('terminal:input', t.termId, text);
      markPaneInput(node.id);
    }

    // ドロップ完了フラッシュフィードバック
    el.classList.add('drop-flash');
    el.addEventListener('animationend', () => el.classList.remove('drop-flash'), { once: true });
  });

  return el;
}

// グリッドのトラックリサイズ開始。axis は 'col' | 'row'、index は境界のインデックス
// （index と index+1 のトラック間を動かす）。現在の fr 配列（無ければ均等）を基準に dragState を作る。
function startGridResize(e, grid, axis, index, cols, rows) {
  e.preventDefault();
  e.stopPropagation();
  const rect = grid.getBoundingClientRect();
  const size = axis === 'col' ? rect.width : rect.height;
  const cur = axis === 'col'
    ? ((tree.colFr && tree.colFr.length === cols) ? tree.colFr.slice() : Array(cols).fill(1))
    : ((tree.rowFr && tree.rowFr.length === rows) ? tree.rowFr.slice() : Array(rows).fill(1));
  dragState = {
    grid,
    axis,
    index,
    size,
    startPos: axis === 'col' ? e.clientX : e.clientY,
    fr: cur,
    total: cur.reduce((a, b) => a + b, 0),
  };
  document.body.classList.add(axis === 'col' ? 'resizing-h' : 'resizing-v');
}

// ドラッグ中に同一軸のハンドル位置（累積 %）を追従させる。
function repositionGridHandles(grid, fr, axis) {
  const total = fr.reduce((a, b) => a + b, 0);
  const sel = axis === 'col' ? '.grid-handle-col' : '.grid-handle-row';
  const handles = grid.querySelectorAll(sel);
  let acc = 0;
  handles.forEach((h, i) => {
    acc += fr[i];
    const pct = `${(acc / total) * 100}%`;
    if (axis === 'col') h.style.left = pct;
    else h.style.top = pct;
  });
}

// ─── Global file drag handler: drag-ready state for all panes ────────────────
// ファイルをドラッグ開始したとき、全ペインに drag-ready クラスを付与してドロップ可能を示す
let _fileDragCount = 0;

function resetFileDragState() {
  _fileDragCount = 0;
  document.body.classList.remove('file-dragging');
  document.querySelectorAll('.pane').forEach(el => {
    el.classList.remove('drag-ready');
    el.classList.remove('drag-over');
  });
}

document.addEventListener('dragenter', e => {
  if (!e.dataTransfer.types.includes('Files')) return;
  _fileDragCount++;
  if (_fileDragCount === 1) {
    document.body.classList.add('file-dragging');
    document.querySelectorAll('.pane').forEach(el => el.classList.add('drag-ready'));
  }
});

document.addEventListener('dragleave', e => {
  if (!e.dataTransfer.types.includes('Files')) return;
  // relatedTarget が null のときウィンドウ外へ出た
  if (e.relatedTarget === null) {
    resetFileDragState();
  } else {
    _fileDragCount = Math.max(0, _fileDragCount - 1);
    if (_fileDragCount === 0) {
      resetFileDragState();
    }
  }
});

// ペイン外へのmiss-dropでBrowserWindowがファイルに遷移しないよう防止
document.addEventListener('dragover', e => {
  e.preventDefault();
  e.stopPropagation();
});

document.addEventListener('drop', e => {
  e.preventDefault();
  e.stopPropagation();
  resetFileDragState();
  // ペイン D&D が進行中のまま、ペイン外でドロップされた場合の保険（issue #40）。
  // ペイン側 drop ハンドラはバブリングを stopPropagation するため通常はここまで来ない。
  if (paneDragState) cleanupPaneDrag();
});

// ESC キャンセル / ウィンドウ外ドロップ / ブラウザによる中断時の保険（issue #40）。
// dragend は dragstart した element に届くが、render() で要素が差し替わるケース等を考慮して
// document レベルにも保険を仕掛けておく。
document.addEventListener('dragend', () => {
  if (paneDragState) cleanupPaneDrag();
});

document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (!paneDragState) return;
  e.preventDefault();
  cleanupPaneDrag();
});

// ─── Global drag handler（グリッドのトラックリサイズ）─────────────────────────
document.addEventListener('mousemove', e => {
  if (!dragState) return;
  const { grid, axis, index, size, startPos, fr, total } = dragState;
  const currentPos = axis === 'col' ? e.clientX : e.clientY;
  const deltaFrac = ((currentPos - startPos) / size) * total;
  const pairSum = fr[index] + fr[index + 1];
  const minFr = total * 0.05;
  let a = fr[index] + deltaFrac;
  a = Math.max(minFr, Math.min(pairSum - minFr, a));
  const next = fr.slice();
  next[index] = a;
  next[index + 1] = pairSum - a;
  if (axis === 'col') {
    tree.colFr = next;
    grid.style.gridTemplateColumns = next.map(f => `${f}fr`).join(' ');
  } else {
    tree.rowFr = next;
    grid.style.gridTemplateRows = next.map(f => `${f}fr`).join(' ');
  }
  repositionGridHandles(grid, next, axis);
  debouncedFitAll();
});

document.addEventListener('mouseup', () => {
  if (!dragState) return;
  document.body.classList.remove('resizing-h', 'resizing-v');
  dragState = null;
  fitAll();
});

// ─── Global drag handler（サイドバー幅リサイズ, issue #89）─────────────────────
document.addEventListener('mousemove', e => {
  if (!sidebarResizeState) return;
  const dx = e.clientX - sidebarResizeState.startX;
  setSidebarWidth(sidebarResizeState.startWidth + dx);
  debouncedFitAll();
});

document.addEventListener('mouseup', () => {
  if (!sidebarResizeState) return;
  sidebarResizeState = null;
  document.body.classList.remove('resizing-sidebar');
  fitAll();
});

// ─── Resize observer ──────────────────────────────────────────────────────────
let _fitTimer = null;
function debouncedFitAll() {
  clearTimeout(_fitTimer);
  _fitTimer = setTimeout(fitAll, 30);
}

const resizeObserver = new ResizeObserver(debouncedFitAll);

// xterm の実際の描画領域は .term-container なので、.pane ではなく .term-container を監視する。
// .pane を監視すると、ペイン自体のサイズは変わらないのに内側の割り当てだけが変わるケース
// —— 例: エージェントルーム（<details>）の開閉で .agent-room-body が伸縮し、flex:1 の
// .term-container だけが縮む —— を拾えず、ターミナルが再フィットされない。その結果カーソル
// 行（Claude の入力欄）が可視領域外に押し出され、IME 合成中の textarea / composition-view も
// 旧サイズ基準の座標に取り残されて左上等の誤った位置に出てしまう。
// .term-container は .pane 内で flex:1 のため、ペインのリサイズでも必ず追従して変化する。
function observePanes() {
  resizeObserver.disconnect();
  document.querySelectorAll('.term-container').forEach(el => resizeObserver.observe(el));
}

window.addEventListener('resize', debouncedFitAll);
// ウィンドウ幅が縮んだときにサイドバー幅の上限（幅比）を超えないよう再クランプする（issue #89）。
window.addEventListener('resize', () => setSidebarWidth(getSidebarWidth()));
// ウィンドウがフォーカスを失うと、ホバー中のマウス位置を xterm 側が追跡し続けられず
// leave が発火しないケースがある（例: ホバーしたまま Cmd+Tab で他アプリへ切り替える）。
// position: fixed のツールチップが画面に残り続けるのを防ぐ（安藤レビュー指摘・LOW）。
window.addEventListener('blur', () => {
  hideTermLinkTooltip();
  // 次の mousedown は「ウィンドウを前面に出すためのクリック」かもしれないため、
  // recordPaneFocusBeforeMousedown() がフォーカス状態を強制的に false 扱いにできる
  // よう印を付ける（issue #385 レビュー指摘・MEDIUM-5）。
  pendingWindowRefocusClick = true;
});

// ─── 設定パネル（汎用）────────────────────────────────────────────────────────
// main プロセス（settings:describe / settings:save）経由で、呼び出し側が env
// VK_TERMINALS_SETTINGS で指定した config ファイルをこの GUI から編集する。
// 歯車ボタンは設定モーダル（設定項目のみ）を開く。Claude の使用状況はサイドバー上部の
// 常時表示カードへ統合した。describe が使えない環境ではモーダル側で「設定項目なし」を表示する。
function setupSettingsPanel() {
  const btn = document.getElementById('settings-btn');
  if (!btn) return;
  btn.addEventListener('click', () => openSettingsModal());
}

// ─── 使用状況（issue #73）─────────────────────────────────────────────────────
// main の usage:get が返す統一構造:
//   - source: 'oauth'      … 公式 usage API。session / weekly = { percent, resetAtMs }
//   - source: 'transcript' … トランスクリプト集計（describeUsage の整形済み値）
// percent は百分率（17 = 17%）。トークン等の秘匿情報は main から一切渡らない。

const USAGE_POLL_INTERVAL_MS = 60000; // 使用量バッジ・サイドバーカード共通（main 側 60s TTL に相乗り）
const USAGE_SIDEBAR_TICK_INTERVAL_MS = 30000;
let lastUsageSnapshot = null;
let lastCodexUsageSnapshot = null;

// 公式% の閾値カラー（〜70% 青 / 70〜90% アンバー / 90%〜 赤）。
// フォールバックの自己ピーク比バーには適用しない（上限比ではないため）。
function usageLevelClass(percent) {
  if (!Number.isFinite(percent)) return '';
  if (percent >= 90) return 'level-crit';
  if (percent >= 70) return 'level-warn';
  return '';
}

/** 残り時間（ms）を「◯時間◯分後にリセット」形式にする。 */
function formatRemainingJa(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return 'まもなくリセット';
  const totalMin = Math.floor(ms / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h > 0) return `${h}時間${m}分後にリセット`;
  if (m > 0) return `${m}分後にリセット`;
  return 'まもなくリセット';
}

/** リセット日時を「金 18:59 にリセット」形式（ローカル時刻）にする。 */
function formatResetDateTimeJa(ms) {
  const d = new Date(ms);
  const wd = ['日', '月', '火', '水', '木', '金', '土'][d.getDay()];
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${wd} ${hh}:${mm} にリセット`;
}

function setTextWithTitle(el, text) {
  el.textContent = text;
  el.title = text;
}

// 公式データ 1 区分（セッション / 週間）のセクションを組み立てる。
//   resetMode: 'remaining' … 「◯時間◯分後にリセット」。data-reset-at を付け、
//              サイドバーの低頻度ティッカーがポーリングを待たず再計算する。
//   resetMode: 'datetime'  … 「金 18:59 にリセット」（週間制限向け・静的表示）。
function buildOauthUsageSection(title, entry, resetMode, options = {}) {
  const sec = document.createElement('div');
  sec.className = 'usage-section';

  const head = document.createElement('div');
  head.className = 'usage-section-head';
  const titleEl = document.createElement('span');
  titleEl.className = 'usage-section-title';
  titleEl.textContent = options.titleLabel || title;
  if (options.titleLabel && options.titleLabel !== title) {
    titleEl.title = title;
    titleEl.setAttribute('aria-label', title);
  }
  const valueEl = document.createElement('span');
  valueEl.className = 'usage-value';
  valueEl.textContent = Number.isFinite(entry.percent) ? `${Math.round(entry.percent)}% 使用済み` : '—';
  head.appendChild(titleEl);
  head.appendChild(valueEl);
  sec.appendChild(head);

  const track = document.createElement('div');
  track.className = 'usage-bar-track';
  const width = Number.isFinite(entry.percent) ? Math.min(100, Math.max(0, entry.percent)) : 0;
  // SR 向けにバーを progressbar として公開する（数値ラベル併記に加えた a11y 対応）。
  track.setAttribute('role', 'progressbar');
  track.setAttribute('aria-label', title);
  track.setAttribute('aria-valuemin', '0');
  track.setAttribute('aria-valuemax', '100');
  track.setAttribute('aria-valuenow', String(Math.round(width)));
  const fill = document.createElement('div');
  fill.className = `usage-bar-fill ${usageLevelClass(entry.percent)}`.trim();
  fill.style.width = `${width}%`;
  track.appendChild(fill);
  sec.appendChild(track);

  const reset = document.createElement('div');
  reset.className = 'usage-reset';
  if (Number.isFinite(entry.resetAtMs)) {
    if (resetMode === 'remaining') {
      reset.dataset.resetAt = String(entry.resetAtMs);
      setTextWithTitle(reset, formatRemainingJa(entry.resetAtMs - Date.now()));
    } else {
      setTextWithTitle(reset, formatResetDateTimeJa(entry.resetAtMs));
    }
  }
  sec.appendChild(reset);
  return sec;
}

// フォールバック（source: 'transcript'）のセクション。「現在の5時間ブロック」のみ表示し、
// 週間セクションは出さない（データが無いものを 0% バーで見せない）。
// ラベルは既存の「ピーク比」語彙（peakLabel）を維持し「使用済み」とは書かない
// （上限比ではなく自己ピーク比のため）。バーは単色青・閾値カラーなし。
function buildTranscriptUsageSection(u) {
  const sec = document.createElement('div');
  sec.className = 'usage-section';

  const head = document.createElement('div');
  head.className = 'usage-section-head';
  const titleEl = document.createElement('span');
  titleEl.className = 'usage-section-title';
  titleEl.textContent = '現在の5時間ブロック';
  const valueEl = document.createElement('span');
  valueEl.className = 'usage-value';
  valueEl.textContent = u.percentText
    ? `${u.tokensText} トークン · ${u.peakLabel || 'ピーク比'}${u.percentText}`
    : `${u.tokensText} トークン`;
  head.appendChild(titleEl);
  head.appendChild(valueEl);
  sec.appendChild(head);

  // 自己ピーク比バー（utilization が無いときはバー行ごと出さない）
  if (typeof u.utilization === 'number' && Number.isFinite(u.utilization)) {
    const width = Math.min(100, Math.max(0, u.utilization * 100));
    const track = document.createElement('div');
    track.className = 'usage-bar-track';
    // SR 向け progressbar。ラベルは「使用済み」ではなく既存の「ピーク比」語彙を使う。
    track.setAttribute('role', 'progressbar');
    track.setAttribute('aria-label', u.peakLabel || 'ピーク比');
    track.setAttribute('aria-valuemin', '0');
    track.setAttribute('aria-valuemax', '100');
    track.setAttribute('aria-valuenow', String(Math.round(width)));
    const fill = document.createElement('div');
    fill.className = 'usage-bar-fill'; // 単色青（閾値カラーなし・誤解防止）
    fill.style.width = `${width}%`;
    track.appendChild(fill);
    sec.appendChild(track);
  }

  const reset = document.createElement('div');
  reset.className = 'usage-reset';
  setTextWithTitle(reset, `リセット ${u.resetText}（残り${u.remainingText}）`);
  sec.appendChild(reset);

  if (u.peakNote) {
    const note = document.createElement('div');
    note.className = 'usage-note';
    setTextWithTitle(note, u.peakNote);
    sec.appendChild(note);
  }
  return sec;
}

// 使用状況ビュー全体を描画する（読み取り専用）。
function renderUsageView(container, usage, options = {}) {
  container.innerHTML = '';
  if (!usage) {
    const p = document.createElement('p');
    p.className = 'usage-empty';
    p.textContent = '使用状況データを取得できません。Claude Code に未ログイン・オフラインの場合や、設定「トークン使用量を表示」が無効の場合はここには何も表示されません。';
    container.appendChild(p);
    return;
  }
  if (usage.source === 'oauth') {
    // スクリーンリーダーが「直近取得値（古い可能性あり）」の前置きを数値より先に
    // 読み上げられるよう、stale 注記はブロック先頭に置く（a11y 改善）。
    if (usage.stale === true) {
      const note = document.createElement('div');
      note.className = 'usage-note';
      setTextWithTitle(note, '直近に取得した値を表示しています（最新の取得に一時的に失敗しました）');
      container.appendChild(note);
    }
    if (usage.session) {
      container.appendChild(buildOauthUsageSection('現在のセッション', usage.session, 'remaining', {
        titleLabel: options.compact ? 'セッション' : '',
      }));
    }
    if (usage.weekly) {
      container.appendChild(buildOauthUsageSection('週間制限（すべてのモデル）', usage.weekly, 'datetime', {
        titleLabel: options.compact ? '週間' : '',
      }));
    }
    return;
  }
  // フォールバック（トランスクリプト集計）
  container.appendChild(buildTranscriptUsageSection(usage));
}

function buildCodexTokenUsageSection(tokens) {
  const sec = document.createElement('div');
  sec.className = 'usage-section';

  const head = document.createElement('div');
  head.className = 'usage-section-head';
  const titleEl = document.createElement('span');
  titleEl.className = 'usage-section-title';
  titleEl.textContent = 'トークン数';
  const valueEl = document.createElement('span');
  valueEl.className = 'usage-value';
  const today = tokens && tokens.todayText ? tokens.todayText : '0';
  setTextWithTitle(valueEl, `今日 ${today}`);
  head.appendChild(titleEl);
  head.appendChild(valueEl);
  sec.appendChild(head);

  const weekly = document.createElement('div');
  weekly.className = 'usage-reset';
  const weeklyText = tokens && tokens.weeklyText ? tokens.weeklyText : '0';
  setTextWithTitle(weekly, `今週 ${weeklyText} トークン`);
  sec.appendChild(weekly);
  return sec;
}

function renderCodexUsageView(container, usage, options = {}) {
  container.innerHTML = '';
  if (!usage) {
    return;
  }
  let rendered = false;

  if (usage.stale === true) {
    const note = document.createElement('div');
    note.className = 'usage-note';
    setTextWithTitle(note, '直近に取得した値を表示しています（最新の取得に一時的に失敗しました）');
    container.appendChild(note);
    rendered = true;
  }
  if (usage.session) {
    container.appendChild(buildOauthUsageSection('現在のセッション', usage.session, 'remaining', {
      titleLabel: options.compact ? 'セッション' : '',
    }));
    rendered = true;
  }
  if (usage.weekly) {
    container.appendChild(buildOauthUsageSection('週間制限', usage.weekly, 'datetime', {
      titleLabel: options.compact ? '週間' : '',
    }));
    rendered = true;
  }
  if (usage.tokens) {
    container.appendChild(buildCodexTokenUsageSection(usage.tokens));
    rendered = true;
  }
  if (!rendered) {
    const p = document.createElement('p');
    p.className = 'usage-empty';
    p.textContent = '使用状況データを取得できません。';
    container.appendChild(p);
  }
}

function renderSidebarUsage(usage) {
  lastUsageSnapshot = usage || null;
  const section = document.getElementById('sidebar-usage');
  if (!section) return;
  const body = section.querySelector('.sidebar-usage-body');
  if (!body) return;

  if (!usage) {
    section.hidden = true;
    body.replaceChildren();
    return;
  }

  renderUsageView(body, usage, { compact: true });
  section.hidden = false;
}

function renderSidebarCodexUsage(usage) {
  lastCodexUsageSnapshot = usage || null;
  const section = document.getElementById('sidebar-codex-usage');
  if (!section) return;
  const body = section.querySelector('.sidebar-usage-body');
  if (!body) return;

  if (!usage || usage.empty === true) {
    section.hidden = true;
    body.replaceChildren();
    return;
  }

  renderCodexUsageView(body, usage, { compact: true });
  section.hidden = false;
}

function tickSidebarUsageReset() {
  document.querySelectorAll('.sidebar-usage [data-reset-at]').forEach((el) => {
    const at = Number(el.dataset.resetAt);
    if (Number.isFinite(at)) setTextWithTitle(el, formatRemainingJa(at - Date.now()));
  });
}

// ☰ メニューボタンの警告ドットバッジ（issue #73）。
// 公式の使用率（セッション・週間のいずれか）が 80% を超えたときだけドットを重ねる
// （80〜90%: アンバー / 90%〜: 赤）。フォールバック（自己ピーク比）は上限比ではないため
// バッジ対象にしない。ポーリングは 60 秒間隔で main 側 60s TTL キャッシュに相乗りする。
// 色のみの表現にしないよう、警告レベルに応じて title / aria-label も切り替える（a11y）。
const USAGE_ALERT_LABELS = {
  '':     '',
  'warn': '使用量: 警告（80%超）',
  'crit': '使用量: 危険（90%超）',
};

// 直近の使用率警告レベル（'' / 'warn' / 'crit'）。
let usageAlertLevel = '';

// 使用率の警告ドットを ☰ メニューボタン（常時表示）に反映する。
// サイドバー閉時でも警告に気付けるようにし、開いているときは使用量カードのバー色で示す。
function applyUsageBadge() {
  const level = usageAlertLevel;
  const menuBtn = document.getElementById('menu-btn');
  const targets = [];
  if (menuBtn) targets.push(menuBtn);
  for (const el of targets) {
    el.classList.toggle('usage-alert-warn', level === 'warn');
    el.classList.toggle('usage-alert-crit', level === 'crit');
  }
  if (menuBtn) {
    const extra = USAGE_ALERT_LABELS[level];
    const label = extra ? `メニュー（${extra}）` : 'メニュー';
    menuBtn.title = label;
    menuBtn.setAttribute('aria-label', label);
  }
}

function usageAlertMaxPercent(...snapshots) {
  const pcts = [];
  for (const usage of snapshots) {
    if (!usage) continue;
    for (const entry of [usage.session, usage.weekly]) {
      if (entry && Number.isFinite(entry.percent)) pcts.push(entry.percent);
    }
  }
  return pcts.length ? Math.max(...pcts) : null;
}

function setupUsageBadge() {
  const refresh = async () => {
    let level = '';
    let usage = null;
    let codexUsage = null;
    try {
      [usage, codexUsage] = await Promise.all([
        VKIpc.invoke('usage:get'),
        VKIpc.invoke('codex-usage:get'),
      ]);
      const max = usageAlertMaxPercent(
        usage && usage.source === 'oauth' ? usage : null,
        codexUsage,
      );
      if (max !== null && max > 80) level = max >= 90 ? 'crit' : 'warn';
    } catch (_e) {
      level = ''; // 取得失敗時はバッジを消す（古い警告を残さない）
    }
    renderSidebarUsage(usage);
    renderSidebarCodexUsage(codexUsage);
    usageAlertLevel = level;
    applyUsageBadge();
  };
  refresh();
  setInterval(refresh, USAGE_POLL_INTERVAL_MS);
  setInterval(tickSidebarUsageReset, USAGE_SIDEBAR_TICK_INTERVAL_MS);
}

// apiHost の入力値から、その場で出す認証関連の案内を判定する（issue #313）。
// 保存・再起動を待たずにその場で気づけるようにするための即時フィードバック。
// null を返した場合は案内なし（ループバックアドレス・'localhost'・未入力）。
// isLoopbackDisplayValue は utils/apiAuth.js（shouldRequireAuth）が実際の認証要否を
// 決めるのに使う isLoopbackHost をベースに、画面の即時案内だけ 'localhost' も
// loopback 扱いに広げたもの（PR #315 レビュー対応）。'127.0.0.1' の完全一致だけで
// 判定すると、::1 や ::ffff:127.0.0.1 のように実際には認証不要な値に対しても
// 「認証が必須になります」と誤って案内してしまう。'localhost' も同様で、
// 127.0.0.1 より自然に入力されやすいぶん、誤案内を見た利用者が「もう保護されて
// いる」と誤認したまま tailscale serve 公開時に apiRequireAuthAlways を有効化し
// 忘れる実害につながるため、案内側だけは isLoopbackHost より広く判定する
// （安藤のセキュリティレビュー指摘）。
function getApiHostAuthNotice(rawValue) {
  const value = typeof rawValue === 'string' ? rawValue.trim() : '';
  if (!value || isLoopbackDisplayValue(value)) return null;
  if (value === '0.0.0.0') {
    return {
      tone: 'warning',
      text: '0.0.0.0 を指定すると LAN 上の誰からでも接続できるうえ、通信が暗号化されないためアクセストークンが平文で流れます。推奨しません（Tailscale の利用をご検討ください）。',
    };
  }
  return {
    tone: 'info',
    text: '127.0.0.1 以外を指定すると、保存して再起動した後はアクセストークンによる認証が必須になります。初回登録用の URL は「モバイルから確認」タブで確認できます。',
  };
}

// 1 フィールド分の入力 HTML を組み立てる。
// id は描画順で採番したユニークな値を呼び出し側から受け取る（キーから id を導出すると
// "a.b" と "a_b" のような別キーがサニタイズ後に衝突しうるため、キー由来にしない）。
function renderSettingsField(f, value, id) {
  const labelText = String(f.label || f.key || '');
  const hasHelp = typeof f.help === 'string' && f.help.trim() !== '';
  const label = escText(labelText);
  // help は初期状態では閉じ、ラベル横のボタンから必要なときだけ開けるようにする。
  // ラベル自体は help が無い行では従来どおり裸で置き、不要な DOM 変更を避ける。
  const help = hasHelp
    ? `<span class="settings-help" id="${escAttr(id + '-help')}" hidden>${escText(f.help)}</span>`
    : '';
  const helpToggle = hasHelp
    ? `<button type="button" class="settings-help-toggle" id="${escAttr(id + '-help-toggle')}" aria-expanded="false" aria-controls="${escAttr(id + '-help')}" aria-label="${escAttr(labelText + 'の説明')}">?</button>`
    : '';
  const labelHtml = `<label class="settings-label" for="${escAttr(id)}">${label}</label>`;
  const labelRow = hasHelp
    ? `<div class="settings-label-row">${labelHtml}${helpToggle}</div>`
    : labelHtml;
  // disabledReason は無効状態でだけ表示するが、状態切替のたびに生成・破棄せず DOM に常駐させる。
  // applyFieldState が hidden と aria-describedby を同期し、入力欄から理由を読み上げられるようにする。
  const disabledReason = typeof f.disabledReason === 'string' && f.disabledReason.trim()
    ? `<span class="settings-disabled-reason" id="${escAttr(id + '-disabled-reason')}" role="status" hidden>${escText(f.disabledReason)}</span>`
    : '';

  if (f.type === 'boolean') {
    const checkLabel = `<label class="settings-check">
        <input type="checkbox" id="${id}" ${value ? 'checked' : ''}>
        <span class="settings-label">${label}</span>
      </label>`;
    const checkLabelRow = hasHelp
      ? `<div class="settings-label-row">${checkLabel}${helpToggle}</div>`
      : checkLabel;
    return `<div class="settings-row settings-row-check">
      ${checkLabelRow}${help}${disabledReason}
    </div>`;
  }

  const strVal = value === null || value === undefined
    ? ''
    : (f.type === 'json'
        ? escAttr(JSON.stringify(value, null, 2))
        : escAttr(String(value)));

  if (f.type === 'json') {
    // textarea の中身は要素内容なので escText 側でよいが、値は文字列前提なので escAttr で統一。
    const body = value === null || value === undefined ? '' : escText(JSON.stringify(value, null, 2));
    return `<div class="settings-row">
      ${labelRow}${help}${disabledReason}
      <textarea id="${id}" rows="4" spellcheck="false">${body}</textarea>
    </div>`;
  }

  if (f.type === 'lines') {
    // 判定は renderer/settingsLinesField.js の linesFieldDisplayText を参照（issue #339）。
    const body = escText(linesFieldDisplayText(value));
    return `<div class="settings-row">
      ${labelRow}${help}${disabledReason}
      <textarea id="${id}" rows="4" spellcheck="false">${body}</textarea>
    </div>`;
  }

  if (f.type === 'password') {
    return `<div class="settings-row">
      ${labelRow}${help}${disabledReason}
      <div class="settings-pwd">
        <input type="password" id="${id}" value="${strVal}" autocomplete="off" spellcheck="false">
        <button type="button" class="settings-reveal" data-target="${id}" title="表示切替">👁</button>
      </div>
    </div>`;
  }

  if (f.type === 'select') {
    // 許可された値だけを選べる制約付きピッカー。f.options は {value,label} の配列。
    const cur = value === null || value === undefined ? '' : String(value);
    const opts = (Array.isArray(f.options) ? f.options : [])
      .map((o) => {
        const ov = escAttr(String(o.value ?? ''));
        const ol = escText(String(o.label ?? o.value ?? ''));
        const sel = String(o.value ?? '') === cur ? ' selected' : '';
        return `<option value="${ov}"${sel}>${ol}</option>`;
      })
      .join('');
    return `<div class="settings-row">
      ${labelRow}${help}${disabledReason}
      <select id="${id}">${opts}</select>
    </div>`;
  }

  const inputType = f.type === 'number' ? 'number' : 'text';
  const ph = f.placeholder ? ` placeholder="${escAttr(f.placeholder)}"` : '';
  const comboListId = f.type === 'combo' ? `${id}-options` : '';
  const comboListAttr = comboListId ? ` list="${escAttr(comboListId)}"` : '';
  const comboOptions = comboListId
    ? `<datalist id="${escAttr(comboListId)}">${(Array.isArray(f.options) ? f.options : []).map((o) => {
        const optionValue = escAttr(String(o.value ?? ''));
        const optionLabel = escAttr(String(o.label ?? o.value ?? ''));
        return `<option value="${optionValue}" label="${optionLabel}"></option>`;
      }).join('')}</datalist>`
    : '';
  // pattern 検証のエラー行と aria 関連付け。help は開いた間だけイベント側で先頭へ足す。
  const errorId = escAttr(id + '-error');
  // apiHost だけ、保存・再起動を待たずその場で認証要否の案内を出すための空の通知欄を
  // 併設する（issue #313）。中身は buildSettingsModal 側で入力イベントに応じて書き換える。
  const inlineNoticeId = escAttr(id + '-notice');
  const inlineNoticeHtml = f.key === 'apiHost'
    ? `<p class="settings-inline-notice" id="${inlineNoticeId}" role="status" aria-live="polite" hidden></p>`
    : '';
  const describedBy = escAttr(`${id}-error${f.key === 'apiHost' ? ` ${id}-notice` : ''}`);
  return `<div class="settings-row">
    ${labelRow}${help}${disabledReason}
    <input type="${inputType}" id="${id}" value="${strVal}"${ph}${comboListAttr} spellcheck="false" aria-describedby="${describedBy}">
    ${comboOptions}
    <span class="settings-error" id="${errorId}" role="alert"></span>
    ${inlineNoticeHtml}
  </div>`;
}

// コピーボタンの aria-label。可視ラベル「コピー」を先頭に含めるため WCAG 2.5.3
// （Label in Name）を満たし、同じタブに複数のコードブロックが並んでも
// 「どのコマンドをコピーするボタンか」が読み上げで区別できる。
// 改行は空白に畳み、長いコマンドは 60 文字で切って読み上げが延々続かないようにする。
const SETTINGS_COPY_LABEL_MAX = 60;
function settingsCopyButtonLabel(text) {
  const oneLine = String(text).replace(/\s+/g, ' ').trim();
  // 切り詰めはコードポイント単位で行う。slice は UTF-16 コードユニット単位なので、
  // 境界が絵文字などサロゲートペアの途中に来ると孤立サロゲートが残り読み上げが化ける。
  const chars = Array.from(oneLine);
  const clipped = chars.length > SETTINGS_COPY_LABEL_MAX
    ? `${chars.slice(0, SETTINGS_COPY_LABEL_MAX).join('')}…`
    : oneLine;
  return `コピー: ${clipped}`;
}

function renderSettingsCopyableCode(text, copy) {
  const pre = `<pre class="settings-content-code"><code>${escText(text)}</code></pre>`;
  if (!copy) return pre;
  return `<div class="settings-content-codeblock">
    ${pre}
    <div class="settings-content-code-actions">
      <span class="settings-content-copy-status" role="status"></span>
      <button type="button" class="settings-content-copy" aria-label="${escAttr(settingsCopyButtonLabel(text))}">コピー</button>
    </div>
  </div>`;
}

function renderApiServerStatusBody(presentation, apiHostTabIndex) {
  const addressHtml = presentation.address
    ? renderSettingsCopyableCode(presentation.address, presentation.copy)
    : '';
  const apiHostLinkHtml = presentation.showApiHostLink && Number.isInteger(apiHostTabIndex)
    ? `<button type="button" class="settings-content-tablink" data-tab-link-index="${escAttr(String(apiHostTabIndex))}" data-tab-link-field="apiHost">API ホストの設定へ移動</button>`
    : '';
  return `<span class="settings-content-status-label">${escText(presentation.label)}</span>
    ${addressHtml}
    <p class="settings-content-status-text">${escText(presentation.message)}</p>
    ${apiHostLinkHtml}`;
}

function renderApiServerStatus(status, apiHostTabIndex) {
  const presentation = getApiServerStatusPresentation(status);
  const busyAttr = status && status.phase === 'pending' ? ' aria-busy="true"' : '';
  return `<section class="settings-content-status" data-status-source="apiServer" data-tone="${escAttr(presentation.tone)}">
    <h3 class="settings-content-heading">現在の待ち受けアドレス</h3>
    <div class="settings-content-status-body" role="status"${busyAttr}>
      ${renderApiServerStatusBody(presentation, apiHostTabIndex)}
    </div>
  </section>`;
}

// 初回登録用 URL（issue #313）の表示・コピーと、アクセストークンの再発行をまとめた
// 自己完結パネル。URL は秘密情報（トークンを含む）のため、この静的な HTML には埋め込まず
// マスク（伏せ字）だけを出しておき、実値は「表示」「コピー」ボタンを押した時にだけ
// IPC（settings:api-token-info）で都度取得する（buildSettingsModal 側で配線）。
//
// トークン本体の表示・コピーはこのパネルには置かない。設定パネル内にトークンだけを
// 入力する箇所は無く、利用者がここで必要とするのは初回登録用 URL だけのため
// （手で curl を叩く場合は ~/.vk-terminals/config.json の apiToken を直接参照する）。
const API_TOKEN_MASK_PLACEHOLDER = '•'.repeat(64);
function renderApiTokenPanel(persisted) {
  // ボタンは既存の .settings-content-copy / .settings-content-tablink と見た目を
  // 揃えつつ、専用クラス（settings-content-apitoken-btn）にする。同じクラス名を共有すると
  // 既存のイベント委譲（コピー・タブ移動）がこのボタンにも反応してしまうため
  // （どちらも無害な no-op に倒れるが、意図が分かりにくく事故の元になる）。
  // 「コピー」ボタンはラベルだけでは何をコピーするか分からないため、aria-label で
  // 対象を補う（renderSettingsCopyableCode と同じ作法）。
  //
  // persisted が false の場合、トークンの永続化に失敗しており次回起動で変わる旨を
  // 警告する（main.js の settings:describe が返す apiTokenPersisted を反映）。
  const persistWarningHtml = persisted === false
    ? `<div class="settings-content-callout" data-tone="warning" role="alert">
        <span class="settings-content-callout-label">注意</span>
        <p class="settings-content-callout-text">このトークンは設定ファイルへの保存に失敗しており、メモリ上だけで動作しています。次回の起動でトークンが変わり、登録済みのスマートフォンは再登録が必要になります。ディスク容量や書き込み権限をご確認ください。</p>
      </div>`
    : '';
  return `<section class="settings-content-apitoken" data-apitoken-panel>
    <h3 class="settings-content-heading">アクセストークン</h3>
    ${persistWarningHtml}
    <h4 class="settings-content-heading">初回登録用の URL</h4>
    <div class="settings-content-apitoken-value-row">
      <code class="settings-content-apitoken-value" data-apitoken-url-value>${API_TOKEN_MASK_PLACEHOLDER}</code>
      <button type="button" class="settings-content-apitoken-btn" data-apitoken-url-reveal aria-pressed="false">表示</button>
      <button type="button" class="settings-content-apitoken-btn" data-apitoken-url-copy aria-label="コピー: 初回登録用の URL">コピー</button>
    </div>
    <span class="settings-content-copy-status" data-apitoken-copy-status role="status"></span>
    <span class="settings-content-apitoken-error" data-apitoken-error role="alert"></span>

    <div class="settings-content-apitoken-reissue">
      <button type="button" class="settings-content-apitoken-btn settings-content-apitoken-btn-danger" data-apitoken-reissue>トークンを再発行</button>
      <span class="settings-content-apitoken-reissue-status" data-apitoken-reissue-status role="status"></span>
    </div>
  </section>`;
}

// ─── 表ブロック・一括切り替えボタン（issue #380）───────────────────────────────
// callout / status と同じ「色だけに依存させない」方針で、バッジには必ず見出し語を
// 前置する。neutral は「特に注意を要さない値」を示すだけの中立色なので見出し語を省く。
const SETTINGS_CONTENT_TABLE_BADGE_TONE_LABELS = {
  info: '情報',
  warning: '注意',
  error: 'エラー',
  success: '良好',
};
// fieldValue / savedValue セルが null・undefined・空文字を受け取ったときの表示。
const SETTINGS_CONTENT_TABLE_EMPTY_VALUE_LABEL = '未設定';
// type: 'password' の欄を参照する fieldValue / savedValue セルの表示（安藤のセキュリティ
// レビュー指摘・issue #380）。設定画面は password 型を <input type="password"> + 👁 で
// 意図的にマスクしているため、表がそれを迂回して平文表示・伏せ字なしで出さないようにする。
const SETTINGS_CONTENT_TABLE_MASKED_VALUE_LABEL = '（マスク中）';
// 横スクロール領域（.settings-content-table-wrap）をキーボードの矢印キーで動かす際の
// 1 回あたりの移動量（px）。マウスホイールの実測（60px 相当で確実に動く）に寄せた
// 控えめな値。厳密な整合性は求められていないため定数 1 つで足りる（issue #380 麗美の
// 実機確認指摘）。
const SETTINGS_CONTENT_TABLE_SCROLL_STEP = 48;

// values から own property のときだけ値を取り出す。素の [] アクセスは
// constructor / toString のようなプロトタイプ継承プロパティも拾ってしまい、
// { type: 'fieldValue', key: 'constructor' } のようなディスクリプタで
// "function Object() { [native code] }" のような値が表示されうる
// （安藤のセキュリティレビュー指摘・issue #380。escText を通るため XSS ではないが、
// savedValue 側は main プロセスの許可リストで守られているのに fieldValue だけ
// 無防備という非対称を解消する）。
function getOwnFieldValue(values, key) {
  return (values && Object.prototype.hasOwnProperty.call(values, key)) ? values[key] : undefined;
}

function renderSettingsTableBadgeHtml(tone, text) {
  const toneLabel = SETTINGS_CONTENT_TABLE_BADGE_TONE_LABELS[tone] || '';
  const labelHtml = toneLabel
    ? `<span class="settings-content-table-badge-label">${escText(toneLabel)}</span>`
    : '';
  return `<span class="settings-content-table-badge" data-tone="${escAttr(tone)}">${labelHtml}${escText(text)}</span>`;
}

// fieldValue セルの表示本体。map に一致すればバッジ（状態表現）、一致しなければ
// 現在の生の値をそのままテキスト表示する。未知の値を隠さないのは、この表自体が
// 「今どうなっているか」を 1 か所に示すための仕組みだから（issue #380 の背景）。
function renderSettingsFieldValueCellBody(rawValue, map) {
  if (rawValue === null || rawValue === undefined || rawValue === '') {
    return escText(SETTINGS_CONTENT_TABLE_EMPTY_VALUE_LABEL);
  }
  const stringValue = String(rawValue);
  const matched = (Array.isArray(map) ? map : []).find((entry) => entry.value === stringValue);
  return matched ? renderSettingsTableBadgeHtml(matched.tone, matched.label) : escText(stringValue);
}

// table ブロックの 1 セルを <td> として描く。
// - fieldValue: 今の入力値（未保存を含む）から都度計算し直す対象。data-fieldvalue-key /
//   data-fieldvalue-map を持たせ、buildSettingsModal 側が applyFieldState と同じ発火点で
//   再計算する（renderSettingsFieldValueCellBody を使い回す）。
// - savedValue: 「設定ファイルに実際に保存されている値」。renderer だけでは分からないため
//   IPC で都度取得する対象。初期表示は「確認中…」にしておき、buildSettingsModal 側が
//   モーダル生成後に settings:content-table-saved-value を呼んで書き換える。
// passwordFieldKeys: type: 'password' な設定欄の key 集合。参照先が password 型なら、
// fieldValue / savedValue のどちらでも値を出さず「（マスク中）」に固定する
// （main 側の resolveSavedFieldValues も password を拒否する多重防御。fieldValue は
// renderer だけで完結するためここでしか守れない）。
function renderSettingsTableCellHtml(cell, values, passwordFieldKeys) {
  if (cell.type === 'badge') {
    return `<td>${renderSettingsTableBadgeHtml(cell.tone, cell.text)}</td>`;
  }
  const masked = !!(passwordFieldKeys && passwordFieldKeys.has(cell.key));
  if (cell.type === 'fieldValue') {
    if (masked) {
      return `<td data-fieldvalue-key="${escAttr(cell.key)}" data-fieldvalue-masked="true">${escText(SETTINGS_CONTENT_TABLE_MASKED_VALUE_LABEL)}</td>`;
    }
    const rawValue = getOwnFieldValue(values, cell.key);
    const mapAttr = escAttr(JSON.stringify(cell.map));
    return `<td data-fieldvalue-key="${escAttr(cell.key)}" data-fieldvalue-map="${mapAttr}">${renderSettingsFieldValueCellBody(rawValue, cell.map)}</td>`;
  }
  if (cell.type === 'savedValue') {
    if (masked) {
      // password 型は data-savedvalue-key を持たせない（IPC 問い合わせ自体を発生させない）。
      return `<td data-savedvalue-masked="true">${escText(SETTINGS_CONTENT_TABLE_MASKED_VALUE_LABEL)}</td>`;
    }
    return `<td data-savedvalue-key="${escAttr(cell.key)}" tabindex="-1" aria-busy="true">確認中…</td>`;
  }
  return `<td>${escText(cell.text)}</td>`;
}

// table ブロック本体。植草の確定仕様（issue #380 decision-record）どおり、横スクロール
// 領域はラッパーに tabindex="0" + role="region" + aria-label を持たせてキーボードでも
// 到達できるようにする。id はモーダル全体で 1 系列（tableIdState）にして、タブをまたいでも
// 重複しないようにする（applyButton 側が「表の直下」を previousElementSibling で
// 見つけるための目印にもなる）。
function renderSettingsTableHtml(block, values, tableIdState, passwordFieldKeys) {
  const tableId = `settings-content-table-${tableIdState.n}`;
  tableIdState.n += 1;
  const colHeadersHtml = block.columns
    .map((column) => `<th scope="col">${escText(column.label)}</th>`)
    .join('');
  const rowsHtml = block.rows.map((row) => {
    const cellsHtml = row.cells.map((cell) => renderSettingsTableCellHtml(cell, values, passwordFieldKeys)).join('');
    return `<tr><th scope="row">${escText(row.label)}</th>${cellsHtml}</tr>`;
  }).join('');
  // 入力値から計算した fieldValue セルを 1 つでも持つ表にだけ、「保存前の入力内容を
  // もとに計算している」という注記を出す（savedValue / badge / text だけの表は
  // 未保存の入力に連動しないため出す意味が無い）。
  const hasFieldValueCell = block.rows.some((row) => row.cells.some((cell) => cell.type === 'fieldValue'));
  const livehintHtml = hasFieldValueCell
    ? `<p class="settings-content-table-livehint" role="status" aria-live="polite" hidden>
        <span class="settings-content-table-livehint-label">未保存</span>
        この表は保存前の入力内容をもとに計算しています。実際に反映するには保存してください。
      </p>`
    : '';
  // フェード（::after）はスクロール担当の .settings-content-table-wrap の外側、
  // overflow を持たない .settings-content-table-fade へ付ける（issue #380 安藤の実測
  // 指摘）。overflow-x: auto を持つ要素の内側にある絶対配置ボックスはスクロール
  // コンテンツの一部として一緒にスクロールしてしまうため、wrap 自身に付けると
  // スクロール量ぶん帯が流れてセルの文字を分断する。id / tabindex=0 / role=region /
  // aria-label は引き続き内側の .settings-content-table-wrap に残す（キーボード
  // ハンドラ・フォーカスリング・fetchSavedValues の closest() がいずれも内側を
  // 見ているため）。
  return `<div class="settings-content-table-fade"><div class="settings-content-table-wrap" id="${escAttr(tableId)}" tabindex="0" role="region" aria-label="${escAttr(`${block.caption}（横にスクロールできます）`)}">
    <table class="settings-content-table">
      <caption class="settings-content-table-caption">${escText(block.caption)}</caption>
      <thead><tr><th scope="col"></th>${colHeadersHtml}</tr></thead>
      <tbody>${rowsHtml}</tbody>
    </table>
  </div></div>${livehintHtml}`;
}

// applyButton ブロック本体。その場では保存しない（renderer 側の click ハンドラが
// markDirty を発火させるだけで、実際の書き込みは既存の「保存」ボタンに委ねる）。
// aria-disabled の理由表示は既存の .settings-disabled-reason と見た目を揃えるため、
// 専用クラスと一緒にそのクラスも付ける（新しい見た目を増やさない）。
function renderSettingsApplyButtonHtml(block) {
  const dangerClass = block.danger ? ' settings-content-apply-button-danger' : '';
  const setsAttr = escAttr(JSON.stringify(block.sets));
  const templateAttr = escAttr(block.confirmTemplate);
  return `<div class="settings-content-table-actions">
    <button type="button" class="settings-content-apply-button${dangerClass}" data-apply-sets="${setsAttr}" data-apply-confirm-template="${templateAttr}">${escText(block.label)}</button>
    <p class="settings-content-table-action-reason settings-disabled-reason" role="status" hidden></p>
  </div>`;
}

// 説明タブ（tabs[].content）の読み取り専用ブロックを HTML 化する。
// blocks は settingsTabs.js の normalizeSettingsTabContent で正規化済み（未知の type や
// 非 http(s) の URL は除去済み）である前提。content は外部ディスクリプタ
// （VK_TERMINALS_SETTINGS）からも入りうるため、テキストは escText / 属性は escAttr を
// 必ず通し、HTML を素通しする実装（markdown → HTML 化など）はしない。
// tabIndexById: tabLink ブロックの参照先タブ ID → タブ番号の Map。
// extraClass: 容器（.settings-content）へ足すクラス。入力欄グループの後ろへ置くときに
// 節の変わり目の余白を戻すために使う（下の .settings-content-after 参照）。
// tableIdState: table ブロックの id 採番用カウンタ（{ n: number }）。呼び出し側
// （buildSettingsModal）がモーダル全体で 1 個だけ生成し、content / contentAfter・
// タブをまたいで使い回すことで id の重複を防ぐ。
function renderSettingsTabContent(blocks, tabIndexById, runtimeStatus = {}, entries = [], extraClass = '', tableIdState = { n: 0 }) {
  const html = (Array.isArray(blocks) ? blocks : []).map((block) => {
    if (block.type === 'heading') {
      // モーダル見出しが <h2> なので、その配下は h3（親セクション）/ h4（子セクション）。
      // 正規化済みでも tag は列挙から出す（`h${level}` を組み立てない）。外部ディスクリプタ
      // 由来の値が将来正規化をすり抜けても任意タグにならないようにするための多重防御。
      const tag = block.level === 4 ? 'h4' : 'h3';
      return `<${tag} class="settings-content-heading">${escText(block.text)}</${tag}>`;
    }
    if (block.type === 'paragraph') {
      return `<p class="settings-content-text">${escText(block.text)}</p>`;
    }
    if (block.type === 'list') {
      const tag = block.ordered ? 'ol' : 'ul';
      const items = block.items.map((item) => `<li>${escText(item)}</li>`).join('');
      return `<${tag} class="settings-content-list">${items}</${tag}>`;
    }
    if (block.type === 'code') {
      return renderSettingsCopyableCode(block.text, block.copy);
    }
    if (block.type === 'links') {
      // href には実 URL を入れず href="#" + click → openExternalUrlSafe に寄せる
      // （Electron の renderer 内で外部サイトが開くのを防ぐ既存パターン）。
      const items = block.items.map(({ label, url }) => `<li>
        <a class="settings-content-link" href="#" draggable="false" data-external-url="${escAttr(url)}" title="${escAttr(`${label}\n${url}`)}" aria-label="${escAttr(`${label}（外部ブラウザで開く）`)}"><span>${escText(label)}</span><span class="settings-content-link-icon" aria-hidden="true">↗</span></a>
      </li>`).join('');
      return `<ul class="settings-content-links">${items}</ul>`;
    }
    if (block.type === 'callout') {
      // 色だけに依存させないため、トーンを表す見出し語をテキストとしても出す。
      const toneLabel = block.tone === 'warning' ? '注意' : '補足';
      return `<div class="settings-content-callout" data-tone="${escAttr(block.tone)}" role="note">
        <span class="settings-content-callout-label">${escText(toneLabel)}</span>
        <p class="settings-content-callout-text">${escText(block.text)}</p>
      </div>`;
    }
    if (block.type === 'status' && block.source === 'apiServer') {
      const apiHostEntry = entries.find(({ field }) => field.key === 'apiHost');
      return renderApiServerStatus(runtimeStatus.apiServer, apiHostEntry?.tabIndex);
    }
    if (block.type === 'apiTokenPanel') {
      return renderApiTokenPanel(runtimeStatus.apiTokenPersisted);
    }
    if (block.type === 'table') {
      return renderSettingsTableHtml(block, runtimeStatus.fieldValues, tableIdState, runtimeStatus.passwordFieldKeys);
    }
    if (block.type === 'applyButton') {
      return renderSettingsApplyButtonHtml(block);
    }
    if (block.type === 'tabLink') {
      const targetIndex = tabIndexById.get(block.tab);
      if (!Number.isInteger(targetIndex)) return '';
      // field があれば移動後にその入力欄まで運ぶ（「〇〇から設定してください」の移動手段は、
      // タブを開くだけでなく目的の欄に着地させて初めて成立する）。
      const fieldAttr = block.field ? ` data-tab-link-field="${escAttr(block.field)}"` : '';
      return `<button type="button" class="settings-content-tablink" data-tab-link-index="${escAttr(String(targetIndex))}"${fieldAttr}>${escText(block.label)}</button>`;
    }
    return '';
  }).join('');

  if (!html) return '';
  const className = extraClass ? `settings-content ${extraClass}` : 'settings-content';
  return `<div class="${escAttr(className)}">${html}</div>`;
}

// 設定モーダルの二重オープンを防ぐロック。settings:describe の応答待ち中は overlay がまだ
// DOM に無いため、要素の有無だけでは二重生成されうる。生成前にロックを取得し、閉じた時は
// buildSettingsModal の close、生成に失敗した時は protect の例外処理が必ず解放する。
const settingsModalGuard = createSingleOpenGuard();

async function openSettingsModal() {
  // URL にホバーしたままマウスを動かさず Tab で ⚙ まで来て Enter で確定する経路では
  // xterm 側の leave が発火しない。設定モーダル（z-index 2000）の手前にツールチップ
  // （2300）が浮いたまま残るのを防ぐ（Claude Code レビュー指摘・LOW）。
  hideTermLinkTooltip();
  // settings:describe の応答待ち中にフォーカスが変わっても、実際に設定を開いた操作元へ
  // 戻せるよう、非同期処理へ入る前の要素をモーダルの寿命と一緒に保持する。
  const restoreFocusElement = document.activeElement;
  try {
    await settingsModalGuard.protect(({ release, setFailureCleanup }) => (
      buildSettingsModal({ release, setFailureCleanup, restoreFocusElement })
    ));
  } catch (e) {
    console.error('設定パネルの生成に失敗しました', e);
  }
}

async function buildSettingsModal({ release, setFailureCleanup, restoreFocusElement }) {
  // 設定ディスクリプタが無い環境でも空の設定モーダルとして開く（使用量はサイドバー上部）。
  let desc = null;
  try {
    desc = await VKIpc.invoke('settings:describe');
  } catch (_e) {
    desc = null;
  }
  const settingsAvailable = !!(desc && desc.available);

  // 描画順に採番したユニーク id と field を対応付ける（保存時もこの対応で走査する）。
  const entries = [];
  const settingsTabs = settingsAvailable ? normalizeSettingsTabs(desc) : [];
  const settingsGroups = settingsAvailable
    ? dedupeSettingsFieldsByKey(desc.groups, settingsTabs)
    : [];
  const useTabbedSettings = settingsTabs.length > 0;
  const settingsSaveHintId = 'settings-save-hint';
  // ダイアログ名（支援技術の読み上げ）に見出しを使うための id。
  const settingsTitleId = 'settings-modal-title';
  const renderGroupHtml = (g, options = {}) => {
    const rows = (g.fields || []).map(f => {
      const id = 'set-field-' + entries.length;
      entries.push({ field: f, id, tabIndex: options.tabIndex });
      return renderSettingsField(f, desc.values[f.key], id);
    }).join('');
    const groupTargets = Array.isArray(g.targetPaths) ? g.targetPaths : [];
    const groupTargetHtml = !useTabbedSettings && desc.hasMultipleTargets && groupTargets.length
      ? `<div class="settings-group-target">保存先: ${groupTargets.map((targetPath) => `<code>${escText(targetPath)}</code>`).join(' / ')}</div>`
      : '';
    const legendHtml = options.omitLegend ? '' : `<legend>${escText(g.label || '')}</legend>`;
    return `<fieldset class="settings-group">
      ${legendHtml}${groupTargetHtml}${rows}</fieldset>`;
  };

  const groupedTabs = useTabbedSettings ? groupSettingsGroupsByTab(settingsGroups, settingsTabs) : [];
  // 保存対象のフィールドを 1 つも持たないタブ（= 説明だけのタブ）を判別する。
  // 「保存後、次回の起動から反映されます。」の継承抑止とフッターの出し分けに使う。
  const tabHasFields = groupedTabs.map(({ groups }) => groups.some(
    (group) => Array.isArray(group.fields) && group.fields.length > 0
  ));
  const tabIndexById = new Map(settingsTabs.map((tab, index) => [tab.id, index]));
  // table ブロックの id 採番はモーダル全体で 1 系列にする（タブをまたいでも、
  // content / contentAfter をまたいでも重複しない）。
  const settingsContentTableIdState = { n: 0 };
  // content より先に全タブのフィールドを組み立て、status ブロックの移動先も
  // スキーマ由来の entries から確実に参照できるようにする。
  const tabGroupsHtml = useTabbedSettings
    ? groupedTabs.map(({ groups }, tabIndex) => groups.map((group) => renderGroupHtml(group, {
      tabIndex,
      // グループが 1 つだけのタブでは legend がタブのラベルと重複して見えるため省くが、
      // 欄が 1 つも無いグループでは残す。legend も欄も無いと枠線と余白だけの空箱になり、
      // 案内文（emptyHtml）も出ない・移動ボタンも残るので、押した人が着地先で
      // 何も読めない行き止まりになる（issue #275）。
      omitLegend: groups.length === 1 && Array.isArray(group.fields) && group.fields.length > 0,
    })).join(''))
    : [];
  // password 型の欄を参照する fieldValue / savedValue セルをマスクするための key 集合
  // （安藤のセキュリティレビュー指摘・issue #380）。tabGroupsHtml の組み立てで entries が
  // 出揃った直後に 1 回だけ求め、以降のタブ・content / contentAfter で使い回す。
  const settingsContentTablePasswordFieldKeys = new Set(
    entries.filter(({ field }) => field.type === 'password').map(({ field }) => field.key)
  );
  const settingsTabsHtml = useTabbedSettings ? `<div class="settings-tabs" role="tablist" aria-label="設定カテゴリ">
    ${settingsTabs.map((tab, index) => {
      const tabId = `settings-tab-${index}`;
      const panelId = `settings-panel-${index}`;
      return `<button type="button" class="settings-tab${index === 0 ? ' is-active' : ''}" id="${escAttr(tabId)}" role="tab" aria-selected="${index === 0 ? 'true' : 'false'}" aria-controls="${escAttr(panelId)}" tabindex="${index === 0 ? '0' : '-1'}" data-tab-index="${index}">
        <span>${escText(tab.label)}</span>
        <span class="settings-tab-dirty" aria-hidden="true"></span>
      </button>`;
    }).join('')}
  </div>` : '';
  const groupsHtml = settingsAvailable
    ? (useTabbedSettings
        ? groupedTabs.map(({ tab, groups }, tabIndex) => {
          const tabId = `settings-tab-${tabIndex}`;
          const panelId = `settings-panel-${tabIndex}`;
          const targetPaths = deriveSettingsTargetPathsForGroups(groups);
          const targetHtml = targetPaths.length
            ? `<div class="settings-group-target settings-tab-target">保存先: ${targetPaths.map((targetPath) => `<code>${escText(targetPath)}</code>`).join(' / ')}</div>`
            : '';
          // desc.note（「保存後、次回の起動から反映されます。」）は保存対象があるタブにだけ
          // 継承する。説明だけのタブに出すと保存できるかのような誤誘導になるため。
          const tabNote = (tab && tab.note) ? tab.note : (tabHasFields[tabIndex] ? desc.note : '');
          const noteHtml = tabNote ? `<p class="settings-note settings-tab-note">${escText(tabNote)}</p>` : '';
          const runtimeStatus = {
            apiServer: desc.apiServerStatus,
            apiTokenPersisted: desc.apiTokenPersisted,
            // table ブロックの fieldValue セルが初期表示に使う「今の入力値」。開いた直後は
            // 保存済みの値そのものなので、entries の初期値と同じ desc.values を渡す。
            fieldValues: desc.values,
            passwordFieldKeys: settingsContentTablePasswordFieldKeys,
          };
          const contentHtml = renderSettingsTabContent(tab && tab.content, tabIndexById, runtimeStatus, entries, '', settingsContentTableIdState);
          // 入力欄グループの後ろに描く説明ブロック。content と同じ種別・同じ描画処理で、
          // 置く位置だけが違う（入力欄を読み終えたあとに読ませたい補足はこちらに書く）。
          const contentAfterHtml = renderSettingsTabContent(tab && tab.contentAfter, tabIndexById, runtimeStatus, entries, 'settings-content-after', settingsContentTableIdState);
          // 説明コンテンツ（content / contentAfter）も設定グループも注記も無い、完全に空の
          // タブだけに空状態を示す。
          // 案内文の役目は「意図せず白紙になった画面で、何も見落としていないと伝える」ことなので、
          // note に代替手段（「この機能は環境変数で設定します」など）を書いたタブでは出さない。
          // 出すとその文章を打ち消してしまう。fields が空でもグループがあれば、グループ名
          // （legend）を読める状態で残すので空タブ扱いにしない（グループが 1 つだけのときも
          // legend を省かないのは上の omitLegend のとおり）。
          // ※ この条件は settingsTabs.js の「移動先が空の tabLink を落とす」判定と対。片方だけ
          //   変えると行き止まりが残るか、内容があるのに移動ボタンが出なくなる（issue #275）。
          const emptyHtml = !contentHtml && !contentAfterHtml && groups.length === 0 && !tabNote
            ? '<p class="settings-empty">このタブに表示できる設定項目はありません。</p>'
            : '';
          return `<section class="settings-tab-panel" id="${escAttr(panelId)}" role="tabpanel" aria-labelledby="${escAttr(tabId)}" tabindex="0"${tabIndex === 0 ? '' : ' hidden'}>
            ${targetHtml}${noteHtml}${contentHtml}${tabGroupsHtml[tabIndex]}${contentAfterHtml}${emptyHtml}
          </section>`;
        }).join('')
        : settingsGroups.map(g => renderGroupHtml(g)).join(''))
    : '';

  const appVersion = (desc && desc.appVersion) ? desc.appVersion : '';
  const targetPathLabel = settingsAvailable
    ? (desc.targetPath || (Array.isArray(desc.targetPaths) ? desc.targetPaths[0] : '') || '')
    : '';
  const settingsTargetHtml = settingsAvailable
    ? (useTabbedSettings
      ? ''
      : desc.hasMultipleTargets
      ? '<p class="settings-target">保存先: 項目またはグループごとに異なります（各項目・グループの下に表示）</p>'
      : `<p class="settings-target">保存先: <code>${escText(targetPathLabel)}</code></p>`)
    : '';
  const settingsHeaderHtml = useTabbedSettings
    ? `<div class="settings-header has-tabs">
        <div class="settings-titlebar">
          <h2 id="${settingsTitleId}">${escText((settingsAvailable && desc.title) || 'VK Terminals')}${appVersion ? `<span class="settings-version">VK Terminals v${escText(appVersion)}</span>` : ''}</h2>
          <button class="settings-close" aria-label="閉じる" title="閉じる">✕</button>
        </div>
        ${settingsTabsHtml}
      </div>`
    : `<div class="settings-header">
        <h2 id="${settingsTitleId}">${escText((settingsAvailable && desc.title) || 'VK Terminals')}${appVersion ? `<span class="settings-version">VK Terminals v${escText(appVersion)}</span>` : ''}</h2>
        <button class="settings-close" aria-label="閉じる" title="閉じる">✕</button>
      </div>`;
  const overlay = document.createElement('div');
  overlay.className = 'settings-overlay';
  // .settings-modal の tabindex="-1" は、開いたときの初期フォーカスの着地点（issue #282）。
  // これが落ちると focusTraps.activate の initialFocus が無言で空振りする（isFocusable は
  // 「本当に focus できるか」までは見ないためフォールバックも走らない）。結果、フォーカスが
  // パネルの外に残り、#282 で直した症状へ静かに戻る。外さないこと。
  overlay.innerHTML = `
    <div class="settings-modal" role="dialog" aria-modal="true" aria-labelledby="${settingsTitleId}" tabindex="-1">
      ${settingsHeaderHtml}
      <div class="settings-view settings-view-config" role="region">
        ${settingsAvailable && desc.note && !useTabbedSettings ? `<p class="settings-note">${escText(desc.note)}</p>` : ''}
        ${settingsTargetHtml}
        ${settingsAvailable
          ? `<form class="settings-form" onsubmit="return false">${groupsHtml}</form>`
          : '<p class="settings-empty">この環境では編集できる設定項目がありません。</p>'}
      </div>
      ${settingsAvailable ? `<div class="settings-footer${useTabbedSettings ? ' has-tabs' : ''}">
        <span class="settings-msg" role="status"></span>
        ${useTabbedSettings ? `<span class="settings-save-hint" id="${settingsSaveHintId}">すべてのタブの変更をまとめて保存</span>` : ''}
        <button type="button" class="settings-cancel">キャンセル</button>
        <button type="button" class="settings-save"${useTabbedSettings ? ` aria-describedby="${settingsSaveHintId}"` : ''}>保存</button>
      </div>` : ''}
    </div>`;
  document.body.appendChild(overlay);
  // close を組み立てる前の例外では、まだキー操作やタイマーは登録されていないため、
  // この生成途中の overlay だけを外してロックを解放する。
  setFailureCleanup(() => {
    overlay.remove();
    release();
  });

  const modal = overlay.querySelector('.settings-modal');

  // 説明タブのコピーボタンごとの「フィードバックを消すタイマー」。連打で表示が
  // 重ならないよう押下時に張り替え、モーダルを閉じるときは全部止める（DOM から
  // 外れたノードへ書き込むのとタイマーが残るのを防ぐ）。
  const copyResetTimers = new Map();
  let apiServerStatusPollTimer = null;
  // 表の「未保存」注記（.settings-content-table-livehint）の更新デバウンス用（issue #380）。
  // 一括切り替えボタンで複数欄が同時に変わったとき、欄ごとに読み上げが重なって
  // 聞き取れなくなるのを避けるため、300ms 静止してから 1 回だけ更新する。
  let contentTableLivehintTimer = null;
  // 一括切り替え直後のフラッシュ演出を解除するタイマー（issue #380）。複数行を
  // 同時にフラッシュしうるので、コピーのフィードバックと同じく Set で束ねて管理する。
  const flashResetTimers = new Set();
  const clearCopyResetTimers = () => {
    copyResetTimers.forEach((timerId) => clearTimeout(timerId));
    copyResetTimers.clear();
  };
  const stopApiServerStatusPolling = () => {
    if (apiServerStatusPollTimer) clearInterval(apiServerStatusPollTimer);
    apiServerStatusPollTimer = null;
  };
  const clearContentTableLivehintTimer = () => {
    if (contentTableLivehintTimer) clearTimeout(contentTableLivehintTimer);
    contentTableLivehintTimer = null;
  };
  const clearFlashResetTimers = () => {
    flashResetTimers.forEach((timerId) => clearTimeout(timerId));
    flashResetTimers.clear();
  };

  // 保存成功後の自動クローズ。武装したまま放置すると、遅れて発火した close() が
  // 「今開いているモーダル」ではなくこのクロージャの overlay を対象にロックを解放し、
  // 二重オープンの抑止を壊す。寿命の判断は renderer/autoClose.js に集約してあり、
  // ここは「いつ武装し、いつ取り消すか」だけを決める。
  const autoClose = createAutoCloseController({ onFire: () => close() });
  let unregisterEscapeLayer = () => {};
  let releaseFocusTrap = () => {};
  const close = () => {
    // markClosed() が false を返すのは 2 回目以降。遅れて発火したタイマーが
    // 後から開いたモーダルのロックを巻き戻さないよう、閉じる処理は冪等にしておく。
    if (!autoClose.markClosed()) return;
    unregisterEscapeLayer();
    // 背後の inert はフォーカスを戻すより前に外す。付いたままだと復帰先への focus() が
    // 空振りし、閉じた後にフォーカスが画面全体へ落ちてしまう（issue #282）。
    releaseFocusTrap();
    clearCopyResetTimers();
    stopApiServerStatusPolling();
    clearContentTableLivehintTimer();
    clearFlashResetTimers();
    // 画面から消す前に、いまフォーカスが設定パネル内にあるかを見る。#257 ではこれが
    // 「自動クローズを待つ間に Tab でパネル外へ出た場合に、操作先からフォーカスを
    // 奪わない」ための条件だったが、#282 のトラップでその経路自体は無くなった。
    // それでも条件を残すのは、フォーカスがパネル内にもユーザーの操作先にも無い
    // （= body へ落ちている）場合を拾う !active / active === document.body の枝が要るため。
    // 背景クリックで閉じたときの着地点がこれに当たる。
    const active = document.activeElement;
    const shouldRestore = !active || active === document.body || overlay.contains(active);
    overlay.remove();
    release();
    if (shouldRestore) {
      (restoreFocusElement?.isConnected
        ? restoreFocusElement
        : document.getElementById('settings-btn'))?.focus();
    }
  };
  // ここから後の例外では、close に overlay・キー操作・各タイマーをまとめて片付けさせる。
  // close はトラップの解除も行うため、以降で例外が出ても背後が inert のまま残らない。
  setFailureCleanup(close);
  unregisterEscapeLayer = escapeLayers.register(close);
  // パネルの中へフォーカスを閉じ込め、背後（ペインの ✕ や ☰）を操作できないようにする。
  // aria-modal="true" と宣言している以上、実際にも背後を止めておく（issue #282）。
  //
  // 初期フォーカスは先頭の操作対象（ヘッダーの ✕）ではなく、tabindex="-1" を付けた
  // パネル本体に置く。マウスで開いたときの programmatic focus には Chromium が
  // :focus-visible のリングを出さないため、✕ に当てるとリングが見えないまま閉じる操作が
  // 準備された状態になり、設定を読みながら Space を押しただけでパネルが閉じてしまう。
  // パネル本体なら Space はスクロールになり、支援技術にはダイアログ名から読み下せて、
  // 最初の Tab は ✕ → タブ → 内容 → キャンセル → 保存という自然な並びで始まる。
  releaseFocusTrap = focusTraps.activate(modal, { initialFocus: modal });

  overlay.addEventListener('mousedown', (e) => {
    if (e.target !== overlay) return;
    // 削除済み overlay への既定のフォーカス移動で、close() の復帰先が
    // body に上書きされないよう、背景クリックの既定動作を先に止める。
    e.preventDefault();
    close();
  });
  modal.querySelector('.settings-close').addEventListener('click', close);

  // 設定項目が無い環境ではフォーム関連の配線は不要（閉じるだけ）。
  if (!settingsAvailable) return;

  const msg = modal.querySelector('.settings-msg');
  const cancelButton = modal.querySelector('.settings-cancel');
  cancelButton.addEventListener('click', close);

  // 説明タブ内の外部リンク（links ブロック）。href は "#" のままにして、
  // 既存パターンどおり shell.openExternal 経由で OS の既定ブラウザを開く。
  modal.querySelectorAll('.settings-content-link').forEach((link) => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      openExternalUrlSafe(link.dataset.externalUrl || '');
    });
  });

  // entries（フィールド定義）と DOM を突き合わせるヘルパー。visibleWhen による行の
  // 表示状態（isEntryVisible）は、検証のスキップだけでなくタブ移動の着地判定でも使う。
  const getEntryInput = (id) => modal.querySelector('#' + id);
  const getEntryRow = (id) => {
    const input = getEntryInput(id);
    if (!input) return null;
    return input.closest('.settings-row') || input.parentElement || input;
  };
  const isEntryVisible = (id) => {
    const row = getEntryRow(id);
    return !row || !row.hidden;
  };
  const isEntryDisabled = (id) => getEntryInput(id)?.getAttribute('aria-disabled') === 'true';
  // 読み上げ順が開閉の回数に左右されないよう、存在・表示状態から毎回固定順で組み立てる。
  // disabledReason は既存仕様どおり無効時だけ末尾へ加え、help の開閉とは独立させる。
  const syncEntryDescribedBy = (id) => {
    const input = getEntryInput(id);
    if (!input) return;
    const help = modal.querySelector('#' + id + '-help');
    const error = modal.querySelector('#' + id + '-error');
    const notice = modal.querySelector('#' + id + '-notice');
    const reason = modal.querySelector('#' + id + '-disabled-reason');
    const describedBy = [
      help && !help.hidden ? help.id : '',
      error ? error.id : '',
      notice ? notice.id : '',
      reason && !reason.hidden ? reason.id : '',
    ].filter(Boolean);
    if (describedBy.length > 0) input.setAttribute('aria-describedby', describedBy.join(' '));
    else input.removeAttribute('aria-describedby');
  };
  // help はモーダルを開くたびに閉じた DOM から始まる。個別配線ではなく委譲にすることで、
  // 全フィールド型を同じ経路で扱い、ボタン上のフォーカスもブラウザ標準どおり維持する。
  modal.addEventListener('click', (event) => {
    const button = event.target.closest('.settings-help-toggle');
    if (!button) return;
    const helpId = button.getAttribute('aria-controls');
    const help = helpId ? modal.querySelector('#' + helpId) : null;
    if (!help) return;
    const expanded = button.getAttribute('aria-expanded') === 'true';
    help.hidden = expanded;
    button.setAttribute('aria-expanded', expanded ? 'false' : 'true');
    // ボタンの id が対応するエントリ id の唯一の正なので、行内の DOM 構造には依存しない。
    const entryId = button.id.slice(0, -'-help-toggle'.length);
    syncEntryDescribedBy(entryId);
  });
  const getCurrentSettingValues = () => {
    const values = {};
    for (const { field, id } of entries) {
      const input = getEntryInput(id);
      if (!input) continue;
      values[field.key] = field.type === 'boolean' ? input.checked : input.value;
    }
    return values;
  };

  let switchToFieldTab = () => {};
  let clearDirtyTabs = () => {};
  let lockSettingsFooter = () => {};
  let unlockSettingsFooter = () => {};
  // 表ブロック・一括切り替えボタン（issue #380）。table / applyButton は
  // tabs[].content / tabs[].contentAfter にしか現れない（どちらも useTabbedSettings が
  // true のときしか描画されない。renderSettingsTabContent の呼び出し元を参照）ため、
  // 実体は下の if 節の中だけで差し替える。settingsAvailable な間は applyFieldState
  // （このずっと下で定義）がタブ表示かどうかを問わず呼ばれるため、ここで no-op を
  // 既定にしておき、タブ無しモードでは何もしないで済むようにする（食い違いの指摘を
  // 受けて、content だけに触れていた誤りをコメント側で修正: 実際は contentAfter にも
  // 置ける）。
  let refreshSettingsContentTables = () => {};
  let updateSettingsApplyButtons = () => {};
  let scheduleSettingsContentTableLivehint = () => {};
  // 保存成功後に savedValue セル（＝設定ファイルに実際に保存されている値）を取り直す
  // ためのフック（issue #380 安藤のレビュー指摘）。保存でファイルの中身が変わったのに
  // 取り直さないと、保存後も編集を続けた場合に savedValue が古い値を表示し続ける。
  let refreshSettingsContentSavedValues = () => {};

  if (useTabbedSettings) {
    const tablist = modal.querySelector('.settings-tabs');
    const tabButtons = Array.from(modal.querySelectorAll('.settings-tab'));
    const tabPanels = Array.from(modal.querySelectorAll('.settings-tab-panel'));
    const saveButton = modal.querySelector('.settings-save');
    const saveHint = modal.querySelector('.settings-save-hint');
    let activeTabIndex = 0;
    let footerLocked = false;
    // フッターの「保存」は全タブ横断だが、説明だけのタブを見ている間は保存対象が無いので隠す。
    // ただし他タブに未保存の変更が残っている場合は隠さない（隠すと「閉じる」しか押せず、
    // 編集内容を保存できないまま破棄してしまうため）。
    const updateSettingsFooter = () => {
      // 保存成功後は自動クローズまでの間ボタン構成を固定する。dirty 解除に連動して
      // 「保存」が消えると、押した直後にボタンが入れ替わって位置がずれるため。
      // 固定はタブを切り替えるまで（activateTab で解除）。タブを移る操作をした時点で
      // 「押した直後の並び替わり」は起きないので、そのタブに合った構成へ戻してよい。
      if (footerLocked) return;
      const showSave = tabHasFields[activeTabIndex] !== false
        || tabButtons.some((button) => button.classList.contains('is-dirty'));
      saveButton.hidden = !showSave;
      if (saveHint) saveHint.hidden = !showSave;
      cancelButton.textContent = showSave ? 'キャンセル' : '閉じる';
    };
    lockSettingsFooter = () => { footerLocked = true; };
    // 固定を解いて、そのタブに合った構成へ戻す。markDirty の updateSettingsFooter は
    // 固定中だと素通りするため、解除したこちらから改めて反映し直す。
    unlockSettingsFooter = () => {
      if (!footerLocked) return;
      footerLocked = false;
      updateSettingsFooter();
    };
    // タブは同じスクロールコンテナを共有するため、切り替え時に scrollTop をそのまま
    // 引き継ぐと移動先が途中から表示される（説明タブの導入を読み飛ばす／目的の入力欄が
    // 画面外になる）。かといって毎回 0 に戻すと、読みかけの位置を捨てて往復のたびに
    // 探し直しになる。そこでタブごとに位置を覚えて復元する（未訪問のタブは先頭から）。
    const scrollContainers = Array.from(modal.querySelectorAll('.settings-view-config, .settings-form'));
    const tabScrollTops = new Map();
    const saveTabScroll = (index) => {
      tabScrollTops.set(index, scrollContainers.map((el) => el.scrollTop));
    };
    const restoreTabScroll = (index) => {
      const saved = tabScrollTops.get(index);
      scrollContainers.forEach((el, i) => {
        el.scrollTop = saved ? saved[i] : 0;
      });
    };
    // タブを離れたときに片付けたい処理（アクセストークンの表示状態のリセット等）を
    // 登録する場所。タブは隠すだけで DOM を破棄しないため、伏せ字に戻す等の後始末は
    // 明示的に行わないと残り続ける（issue #313 レビュー対応・中-5）。
    const onSettingsTabChangedCallbacks = [];
    // タブを切り替える。切り替え時は現タブのスクロール位置を控え、移動先タブの前回位置
    // （未訪問なら先頭）へ復元する。位置を保ちたい呼び出し元は、同じタブを指定すれば
    // スクロールには触れない（tabChanged が false のときは保存も復元もしない）。
    const activateTab = (nextIndex, options = {}) => {
      if (nextIndex < 0 || nextIndex >= tabButtons.length) return;
      const tabChanged = activeTabIndex !== nextIndex;
      // パネルを差し替える前に控える。hidden にすると中身の高さが変わり、
      // スクロール位置がブラウザ側で丸められてしまうため。
      if (tabChanged) saveTabScroll(activeTabIndex);
      tabButtons.forEach((button, index) => {
        const active = index === nextIndex;
        button.classList.toggle('is-active', active);
        button.setAttribute('aria-selected', active ? 'true' : 'false');
        button.setAttribute('tabindex', active ? '0' : '-1');
      });
      tabPanels.forEach((panel, index) => {
        panel.hidden = index !== nextIndex;
      });
      activeTabIndex = nextIndex;
      if (tabChanged) {
        // 保存直後のフッター固定は、タブを移った時点で解除する（B-5: 説明タブに
        // 「保存」が出たまま残らないようにする）。
        footerLocked = false;
        // 併せて保存後の自動クローズも取り消す。固定を解いて「保存後のタブ移動」を
        // 正式に許した以上、移動先を読んでいる最中にパネルごと消えるのは矛盾する。
        // 「保存しました」の表示は残したまま、閉じるタイミングはユーザーに委ねる。
        autoClose.cancel();
        onSettingsTabChangedCallbacks.forEach((cb) => cb());
      }
      updateSettingsFooter();
      if (tabChanged) restoreTabScroll(nextIndex);
      if (options.focus) tabButtons[nextIndex].focus();
    };
    // 指定タブへ移動したうえで、目的の入力欄までスクロールしてフォーカスまで運ぶ。
    // tabLink（説明タブの導線）と switchToFieldTab（検証エラー時の誘導）で共有する。
    // 着地できたときだけ true を返す。visibleWhen で隠れている行は focus() も
    // scrollIntoView も効かないため、成功扱いにせず呼び出し側のフォールバックに委ねる。
    const revealSettingsEntry = (entry) => {
      if (!entry || !Number.isInteger(entry.tabIndex)) return false;
      activateTab(entry.tabIndex);
      const input = getEntryInput(entry.id);
      if (!input || !isEntryVisible(entry.id)) return false;
      if (typeof input.scrollIntoView === 'function') input.scrollIntoView({ block: 'center' });
      // 中央に寄せた直後にブラウザ既定のスクロールで位置がずれないよう、
      // フォーカス側のスクロールは抑止する。
      input.focus({ preventScroll: true });
      return true;
    };
    const moveTabFocus = (delta) => {
      const currentIndex = tabButtons.findIndex((button) => button.getAttribute('aria-selected') === 'true');
      const baseIndex = currentIndex >= 0 ? currentIndex : 0;
      activateTab((baseIndex + delta + tabButtons.length) % tabButtons.length, { focus: true });
    };
    tablist.addEventListener('click', (e) => {
      const button = e.target.closest('.settings-tab');
      if (!button || !tablist.contains(button)) return;
      activateTab(Number(button.dataset.tabIndex));
    });
    tablist.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        moveTabFocus(-1);
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        moveTabFocus(1);
      } else if (e.key === 'Home') {
        e.preventDefault();
        activateTab(0, { focus: true });
      } else if (e.key === 'End') {
        e.preventDefault();
        activateTab(tabButtons.length - 1, { focus: true });
      }
    });
    for (const { id, tabIndex } of entries) {
      if (!Number.isInteger(tabIndex)) continue;
      const input = modal.querySelector('#' + id);
      if (!input) continue;
      const markDirty = () => {
        const button = tabButtons[tabIndex];
        const tabLabel = settingsTabs[tabIndex] ? settingsTabs[tabIndex].label : '';
        if (!button) return;
        button.classList.add('is-dirty');
        button.setAttribute('aria-label', `${tabLabel}（未保存の変更あり）`);
        updateSettingsFooter();
      };
      input.addEventListener('input', markDirty);
      input.addEventListener('change', markDirty);
    }
    clearDirtyTabs = () => {
      tabButtons.forEach((button) => {
        button.classList.remove('is-dirty');
        button.removeAttribute('aria-label');
      });
      updateSettingsFooter();
    };
    // 保存時の検証エラーで最初の不正欄へ誘導する。tabLink と同じ revealSettingsEntry を
    // 通すので、タブ移動だけでなく着地（中央寄せ＋フォーカス）まで揃う。
    switchToFieldTab = (fieldEl) => {
      const entry = entries.find(({ id }) => fieldEl && fieldEl.id === id);
      revealSettingsEntry(entry);
    };
    // 説明タブ内の移動ボタン（tabLink ブロック）。
    // field 指定があればその入力欄まで運び、無ければ移動先タブのボタンへフォーカスを移す
    // （キーボード操作でも流れが途切れないようにする）。
    // status の確定後に追加されるエラー時の移動ボタンにも同じ導線を使えるよう、
    // モーダル上で委譲する。
    modal.addEventListener('click', (event) => {
      const button = event.target.closest('.settings-content-tablink');
      if (!button) return;
      const targetIndex = Number(button.dataset.tabLinkIndex);
      if (!Number.isInteger(targetIndex)) return;
      const fieldKey = button.dataset.tabLinkField || '';
      const entry = fieldKey
        ? entries.find(({ field }) => field.key === fieldKey)
        : null;
      if (entry && revealSettingsEntry(entry)) return;
      activateTab(targetIndex, { focus: true });
    });
    // 説明タブの code ブロックと実行時 status ブロックのコピーボタン。
    // status ブロックは「確認中」から確定表示へ中身が更新されるため、後段でイベント委譲する。
    // フィードバックの表示と消灯は同じ 2 プロパティ（textContent / data-state）を
    // 対称に触るので 1 か所に寄せる。state は 'ok' / 'error' / ''（消灯）。
    const setCopyStatus = (status, state) => {
      if (!status) return;
      if (!state) {
        status.textContent = '';
        status.removeAttribute('data-state');
        return;
      }
      // 色だけに依存させないため、成否はテキストでも伝える。
      status.textContent = state === 'ok' ? 'コピーしました' : 'コピーできませんでした';
      if (state === 'ok') status.removeAttribute('data-state');
      else status.setAttribute('data-state', state);
    };
    // code ブロックと実行時 status ブロックで同じコピー処理を使う。status は「確認中」
    // から確定状態へ中身を更新するため、生成済みボタンへの個別配線ではなく、
    // モーダル内のイベント委譲にして更新後も同じ経路へ流す。
    modal.addEventListener('click', async (event) => {
      const button = event.target.closest('.settings-content-copy');
      if (!button) return;
      const wrapper = button.closest('.settings-content-codeblock');
      const status = wrapper ? wrapper.querySelector('.settings-content-copy-status') : null;
      // コピー元は data-* に持たせず DOM のコード本文から取る。表示している内容と
      // 貼られる内容が構造的に一致することを保証するため。
      const codeEl = wrapper ? wrapper.querySelector('.settings-content-code code') : null;
      const text = codeEl ? codeEl.textContent : '';
      let ok = true;
      if (!text) {
        ok = false;
      } else {
        try {
          // navigator.clipboard は file:// では secure context 判定に依存するため使わず、
          // Electron の clipboard を使う。書き込み自体は main プロセスで行い、
          // preload 経由で成否だけを受け取る（issue #268）。
          ok = await VKClipboard.writeText(text);
        } catch (_e) {
          ok = false;
        }
      }
      setCopyStatus(status, ok ? 'ok' : 'error');
      const pending = copyResetTimers.get(button);
      if (pending) clearTimeout(pending);
      copyResetTimers.set(button, setTimeout(() => {
        copyResetTimers.delete(button);
        setCopyStatus(status, '');
      }, 2000));
    });

    // ─── アクセストークンパネル（issue #313） ─────────────────────────────────
    // 初回登録用 URL は既定で伏せておき、「表示」「コピー」ボタンを押した時だけ
    // IPC（settings:api-token-info）で都度取得する。取得のたびに main 側から
    // 最新の値を引くため、再発行後もこの取得経路を通す限り古い値を返さない。
    const apiTokenPanel = modal.querySelector('[data-apitoken-panel]');
    if (apiTokenPanel) {
      const urlValueEl = apiTokenPanel.querySelector('[data-apitoken-url-value]');
      const urlRevealBtn = apiTokenPanel.querySelector('[data-apitoken-url-reveal]');
      const urlCopyBtn = apiTokenPanel.querySelector('[data-apitoken-url-copy]');
      const urlCopyStatusEl = apiTokenPanel.querySelector('[data-apitoken-copy-status]');
      const tokenErrorEl = apiTokenPanel.querySelector('[data-apitoken-error]');
      const reissueBtn = apiTokenPanel.querySelector('[data-apitoken-reissue]');
      const reissueStatusEl = apiTokenPanel.querySelector('[data-apitoken-reissue-status]');
      let urlRevealed = false;
      let urlCopyResetTimer = null;

      // タブを離れたら、表示中の秘密情報を伏せ字へ戻す（issue #313 レビュー対応・中-5）。
      // 設定モーダルはタブを hidden にするだけで DOM を破棄しないため、これを行わないと
      // 表示したまま別タブへ移って戻った時に伏せ字へ戻らず秘密情報が残り続ける。
      onSettingsTabChangedCallbacks.push(() => {
        if (urlRevealed) {
          urlRevealed = false;
          urlValueEl.textContent = API_TOKEN_MASK_PLACEHOLDER;
          urlRevealBtn.textContent = '表示';
          urlRevealBtn.setAttribute('aria-pressed', 'false');
        }
      });

      const showTokenError = (message) => {
        if (!tokenErrorEl) return;
        tokenErrorEl.textContent = message;
      };
      const clearTokenError = () => showTokenError('');

      // main 側から都度取得する。preload の許可リスト（INVOKE_CHANNELS）に
      // channel が無い場合や IPC 自体が失敗した場合、ここで無言の null を返すと
      // 呼び出し側が何も起きなかったように見えてしまう（issue #313 レビュー対応・
      // 重大-1）。必ずパネル上にエラー文言を出す。
      const fetchApiTokenInfo = async () => {
        try {
          const info = await VKIpc.invoke('settings:api-token-info');
          if (!info || !info.registrationUrl) {
            showTokenError('初回登録用の URL の取得に失敗しました（応答が不正です）。');
            return null;
          }
          clearTokenError();
          return info;
        } catch (e) {
          showTokenError('初回登録用の URL の取得に失敗しました: ' + (e && e.message ? e.message : '不明なエラー'));
          return null;
        }
      };

      if (urlRevealBtn && urlValueEl) {
        urlRevealBtn.addEventListener('click', async () => {
          if (urlRevealed) {
            urlRevealed = false;
            urlValueEl.textContent = API_TOKEN_MASK_PLACEHOLDER;
            urlRevealBtn.textContent = '表示';
            urlRevealBtn.setAttribute('aria-pressed', 'false');
            return;
          }
          const info = await fetchApiTokenInfo();
          if (!info) return;
          urlRevealed = true;
          urlValueEl.textContent = info.registrationUrl;
          urlRevealBtn.textContent = '隠す';
          urlRevealBtn.setAttribute('aria-pressed', 'true');
        });
      }

      if (urlCopyBtn) {
        urlCopyBtn.addEventListener('click', async () => {
          const info = await fetchApiTokenInfo();
          let ok = !!info;
          if (ok) {
            try {
              ok = await VKClipboard.writeText(info.registrationUrl);
            } catch (_e) {
              ok = false;
            }
          }
          setCopyStatus(urlCopyStatusEl, ok ? 'ok' : 'error');
          if (urlCopyResetTimer) clearTimeout(urlCopyResetTimer);
          urlCopyResetTimer = setTimeout(() => {
            urlCopyResetTimer = null;
            setCopyStatus(urlCopyStatusEl, '');
          }, 2000);
        });
      }

      if (reissueBtn) {
        reissueBtn.addEventListener('click', () => {
          // OS ネイティブの window.confirm() ではなく、アプリ内モーダルで確認する
          // （issue #313 レビュー対応・重大-3。理由は openReissueTokenConfirmDialog 定義を参照）。
          openReissueTokenConfirmDialog(async () => {
            let result;
            try {
              result = await VKIpc.invoke('settings:reissue-api-token');
            } catch (e) {
              result = { ok: false, error: e.message };
            }
            if (result && result.ok) {
              if (reissueStatusEl) {
                reissueStatusEl.textContent = '再発行しました。登録済みだった端末は使えなくなります。';
                reissueStatusEl.removeAttribute('data-state');
              }
              // 表示中だった値は古いトークンのままにしない。
              if (urlRevealed && result.registrationUrl) {
                urlValueEl.textContent = result.registrationUrl;
              }
              // 永続化に成功した以上、以前表示していた「保存に失敗した」警告は消してよい。
              if (result.persisted) {
                const persistWarning = apiTokenPanel.querySelector('[data-tone="warning"]');
                if (persistWarning) persistWarning.remove();
              }
            } else if (reissueStatusEl) {
              reissueStatusEl.textContent = 'エラー: ' + (result && result.error ? result.error : '不明なエラー');
              reissueStatusEl.setAttribute('data-state', 'error');
            }
          });
        });
      }
    }

    // createWindow() より API 起動が後なので、設定パネルを極端に早く開くと「確認中」に
    // なる。確定前に限って軽量 IPC を 250ms ごとに最大 20 回（5 秒）取り直し、
    // 確定時・上限到達時・close() のいずれかで止める。
    const statusElement = modal.querySelector('[data-status-source="apiServer"]');
    if (statusElement && desc.apiServerStatus && desc.apiServerStatus.phase === 'pending') {
      let pollCount = 0;
      let pollInFlight = false;
      const apiHostEntry = entries.find(({ field }) => field.key === 'apiHost');
      const applyApiServerStatus = (status) => {
        const current = modal.querySelector('[data-status-source="apiServer"]');
        if (!current) {
          stopApiServerStatusPolling();
          return;
        }
        const presentation = getApiServerStatusPresentation(status);
        const body = current.querySelector('.settings-content-status-body');
        current.dataset.tone = presentation.tone;
        if (body) {
          body.innerHTML = renderApiServerStatusBody(presentation, apiHostEntry?.tabIndex);
          if (status && status.phase === 'pending') {
            body.setAttribute('aria-busy', 'true');
          } else {
            body.removeAttribute('aria-busy');
          }
        }
        if (!status || status.phase !== 'pending') stopApiServerStatusPolling();
      };
      const refreshApiServerStatus = async () => {
        if (pollInFlight) return;
        pollInFlight = true;
        pollCount += 1;
        try {
          const nextStatus = await VKIpc.invoke('settings:api-server-status');
          if (!modal.isConnected) return;
          const settledStatus = nextStatus && nextStatus.phase !== 'pending'
            ? nextStatus
            : (pollCount >= 20 ? { phase: 'unavailable' } : nextStatus);
          applyApiServerStatus(settledStatus);
        } catch (_e) {
          if (!modal.isConnected) return;
          // 一時的な取得失敗でも上限までは確認中を維持する。上限では行き止まりを避ける
          // 案内に切り替え、同期 I/O を伴う main 側の状態取得を止める。
          if (pollCount >= 20) {
            applyApiServerStatus({ phase: 'unavailable' });
          }
        } finally {
          pollInFlight = false;
        }
      };
      apiServerStatusPollTimer = setInterval(refreshApiServerStatus, 250);
    }

    // ─── 表ブロック・一括切り替えボタン（issue #380） ─────────────────────────
    // fieldValue セルの再計算・savedValue セルの取得・applyButton の状態更新・
    // 「未保存」注記の更新デバウンスをまとめて配線する。
    refreshSettingsContentTables = (values) => {
      const currentValues = values || getCurrentSettingValues();
      modal.querySelectorAll('[data-fieldvalue-key]').forEach((td) => {
        // password 型はマスク済み固定表示のまま動かさない（renderSettingsTableCellHtml が
        // data-fieldvalue-map を持たせていないので、そもそも書き換える材料が無い）。
        if (td.dataset.fieldvalueMasked === 'true') return;
        const key = td.dataset.fieldvalueKey;
        let map = [];
        try {
          map = JSON.parse(td.dataset.fieldvalueMap || '[]');
        } catch (_e) {
          map = [];
        }
        // 素の [] アクセスはプロトタイプ継承プロパティを拾うため getOwnFieldValue を通す
        // （renderSettingsTableCellHtml の初期描画と同じ判断・安藤のレビュー指摘）。
        td.innerHTML = renderSettingsFieldValueCellBody(getOwnFieldValue(currentValues, key), map);
      });
    };

    // 対象欄として扱ってよいか（issue #380）。無効化中（disabledWhen）・非表示
    // （visibleWhen で隠れている）・type: 'password'（マスク対象）のいずれかに該当する
    // 欄は一括切り替えの対象から外す。判定はこの 1 箇所へ集約し、確認ダイアログの
    // 件数計算・実際の書き込み・aria-disabled の判定のすべてがここを通る
    // （安藤のセキュリティレビュー指摘: 非表示の欄は disabled 判定をすり抜けて書き込め、
    // pattern 検証も非表示中は素通りするため、書き込み自体をここで止める必要がある）。
    const isApplyTarget = (entry) => (
      !!entry
      && entry.field.type !== 'password'
      && isEntryVisible(entry.id)
      && !isEntryDisabled(entry.id)
    );

    // 一括切り替えの 1 件（set）が、対象フィールドへ実際にセットする「次の値」を求める。
    // boolean は checked 判定用の真偽値、それ以外は value 比較・代入用の文字列を返す。
    // 確認ダイアログの要否判定（willOverwrite）と実際の書き込み
    // （applySettingsContentTableTargets）で判定基準がずれないよう 1 箇所へ集約する
    // （boolean 欄へ value: null を指定すると "false" !== "" で常に確認ダイアログが
    // 出ていた不具合の再発防止・安藤のレビュー指摘）。
    const resolveApplySetNextValue = (field, rawValue) => {
      if (field.type === 'boolean') {
        return rawValue === true || rawValue === 'true';
      }
      return String((rawValue === null || rawValue === undefined) ? '' : rawValue);
    };

    // savedValue セルは「設定ファイルに実際に保存されている値」を表すため、入力のたびに
    // 取り直す必要は無い（入力しても保存するまでファイルは変わらない）。開いたときと
    // 再試行ボタンを押したときにだけ IPC（settings:content-table-saved-value）へ問い合わせる。
    // 行数の多い表でも 1 回の invoke にまとめる（main.js 側の直列 I/O でアプリごと
    // 固まるのを防ぐ・安藤のセキュリティレビュー指摘）。
    // tableId → 問い合わせ中の td 集合。一括切り替えボタンを「確認中のセルが残っている間は
    // 待たせる」ための判定に使う。key ではなく td を単位にするのは、同じ key を参照する
    // セルが同じ表に複数あっても、片方が完了しただけで busy が解けないようにするため。
    const pendingSavedValueByTable = new Map();
    const markSavedValuePending = (tableId, td, pending) => {
      if (!tableId) return;
      if (!pendingSavedValueByTable.has(tableId)) pendingSavedValueByTable.set(tableId, new Set());
      const tds = pendingSavedValueByTable.get(tableId);
      if (pending) tds.add(td);
      else tds.delete(td);
    };
    const renderSavedValueCellError = (td, onRetry) => {
      td.textContent = '';
      const errText = document.createElement('span');
      errText.textContent = '取得できません';
      const retryBtn = document.createElement('button');
      retryBtn.type = 'button';
      retryBtn.className = 'settings-content-table-retry';
      retryBtn.textContent = '再試行';
      retryBtn.addEventListener('click', onRetry);
      td.appendChild(errText);
      td.appendChild(document.createTextNode(' '));
      td.appendChild(retryBtn);
    };
    // 複数セル分をまとめて 1 回の IPC 呼び出しで取得する。再試行は対象を 1 件に絞った
    // 同じ経路を通す（バッチ IPC 自体は 1 件でも複数件でも同じ形）。
    const fetchSavedValues = async (tds) => {
      if (tds.length === 0) return;
      tds.forEach((td) => {
        // 再試行ボタン押下時、非同期処理の直前でセルの中身を丸ごと置き換えるとボタン
        // 自身が DOM から消えてフォーカスが body へ落ちる（植草さんの指摘）。フォーカスが
        // このセルの中にあるときだけ、消える前に td 自身（レンダリング時に付与した
        // tabindex="-1"）へ退避させる。自動起動時（フォーカスがまだ他所にある）は
        // 何もしないので、開いた直後にフォーカスを奪うことはない。
        if (td.contains(document.activeElement)) {
          td.focus({ preventScroll: true });
        }
        const wrap = td.closest('.settings-content-table-wrap');
        markSavedValuePending(wrap ? wrap.id : '', td, true);
        td.textContent = '確認中…';
        td.setAttribute('aria-busy', 'true');
      });
      updateSettingsApplyButtons();

      const keys = tds.map((td) => td.dataset.savedvalueKey);
      let resultMap;
      try {
        resultMap = await VKIpc.invoke('settings:content-table-saved-value', keys);
      } catch (e) {
        // main 側（resolveSavedFieldValues）が Object.create(null) を返すのに合わせ、
        // フォールバックも同じ形にする（安藤のレビュー指摘。到達経路は無いが意図を揃える）。
        resultMap = Object.create(null);
        const error = e && e.message;
        keys.forEach((key) => { resultMap[key] = { ok: false, error }; });
      }
      // 取得中にモーダルが閉じられていたら、切り離し済みの DOM へは反映しない。
      if (!modal.isConnected) return;

      tds.forEach((td) => {
        const key = td.dataset.savedvalueKey;
        const wrap = td.closest('.settings-content-table-wrap');
        markSavedValuePending(wrap ? wrap.id : '', td, false);
        td.removeAttribute('aria-busy');
        const result = resultMap ? resultMap[key] : null;
        if (result && result.ok) {
          const value = result.value;
          td.textContent = (value === null || value === undefined || value === '')
            ? SETTINGS_CONTENT_TABLE_EMPTY_VALUE_LABEL
            : String(value);
        } else {
          // 失敗したセルだけに留める（表全体は止めない）。「取得できません」＋再試行ボタン。
          renderSavedValueCellError(td, () => fetchSavedValues([td]));
        }
      });
      updateSettingsApplyButtons();
    };
    // 保存成功後、表内の savedValue セル全部を取り直す（フックの実体。保存ハンドラから
    // 呼ばれる。issue #380 安藤のレビュー指摘）。
    refreshSettingsContentSavedValues = () => (
      fetchSavedValues(Array.from(modal.querySelectorAll('[data-savedvalue-key]')))
    );

    // applyButton の aria-disabled（対象が全件無効化・非表示・マスク対象の場合）と
    // aria-busy（リンクした表の savedValue セルが確認中の場合）を、対象欄の状態から
    // 再計算する。
    updateSettingsApplyButtons = () => {
      modal.querySelectorAll('.settings-content-apply-button').forEach((button) => {
        let sets = [];
        try {
          sets = JSON.parse(button.dataset.applySets || '[]');
        } catch (_e) {
          sets = [];
        }
        const foundEntries = sets
          .map((set) => entries.find(({ field }) => field.key === set.key))
          .filter((entry) => entry !== undefined);
        const allIneligible = foundEntries.length === 0 || foundEntries.every((entry) => !isApplyTarget(entry));
        const reasonEl = button.parentElement
          ? button.parentElement.querySelector('.settings-content-table-action-reason')
          : null;
        if (allIneligible) {
          button.setAttribute('aria-disabled', 'true');
          if (reasonEl) {
            reasonEl.hidden = false;
            reasonEl.textContent = '対象の項目がすべて無効化されているため使用できません';
          }
        } else {
          button.removeAttribute('aria-disabled');
          if (reasonEl) reasonEl.hidden = true;
        }

        // 表の直下（previousElementSibling）に置かれた表とだけ紐付ける（issue #380
        // decision-record）。表を伴わない単独ボタンは busy 判定の対象外。表と
        // ボタンの間に「未保存」注記（.settings-content-table-livehint）が挟まる
        // ことがあるため、1 つだけ読み飛ばして表を探す。
        // フェード用の外側の箱（.settings-content-table-fade）が
        // .settings-content-table-wrap を包んでいるため（issue #380 安藤の実測指摘・
        // フェードがスクロールに追従してセルの文字を分断する不具合の修正）、直前の
        // 兄弟要素は外側の箱になる。id を持つのは内側の .settings-content-table-wrap の
        // ままなので、querySelector で潜って取る。
        const actionsEl = button.closest('.settings-content-table-actions');
        let prevEl = actionsEl ? actionsEl.previousElementSibling : null;
        if (prevEl && prevEl.classList.contains('settings-content-table-livehint')) {
          prevEl = prevEl.previousElementSibling;
        }
        const linkedTableWrap = prevEl && prevEl.classList.contains('settings-content-table-fade')
          ? prevEl.querySelector('.settings-content-table-wrap')
          : null;
        const linkedTableId = linkedTableWrap ? linkedTableWrap.id : '';
        const pendingTds = linkedTableId ? pendingSavedValueByTable.get(linkedTableId) : null;
        if (pendingTds && pendingTds.size > 0) {
          button.setAttribute('aria-busy', 'true');
        } else {
          button.removeAttribute('aria-busy');
        }
      });
    };

    // 「未保存」注記（.settings-content-table-livehint）は 300ms デバウンスしてから
    // 1 回だけ更新する。セルごとに aria-live を付けず、この 1 か所へ読み上げ通知を
    // 集約するための仕組み（一括切り替えで複数欄が同時に変わっても読み上げが重ならない）。
    scheduleSettingsContentTableLivehint = () => {
      clearContentTableLivehintTimer();
      contentTableLivehintTimer = setTimeout(() => {
        contentTableLivehintTimer = null;
        if (!modal.isConnected) return;
        const dirty = tabButtons.some((button) => button.classList.contains('is-dirty'));
        modal.querySelectorAll('.settings-content-table-livehint').forEach((el) => {
          el.hidden = !dirty;
        });
      }, 300);
    };

    // 一括切り替えボタンの本体。press 直後は保存せず、対象の入力欄へ値をセットして
    // 既存の input/change イベント経路（markDirty・applyFieldState・pattern 再検証）に
    // 乗せるだけにする。対象は isApplyTarget を対象ごとにその場で取り直しながら判定する
    // （直前の書き込みで連動して無効化・非表示になる欄があるため、事前に一括で確定させず、
    // 迂回せず最初から対象外にする）。
    const applySettingsContentTableTargets = (button, sets) => {
      const currentActiveIndex = tabButtons.findIndex((b) => b.getAttribute('aria-selected') === 'true');
      let appliedCount = 0;
      const changedEntries = [];
      for (const set of sets) {
        const entry = entries.find(({ field }) => field.key === set.key);
        if (!isApplyTarget(entry)) continue;
        const input = getEntryInput(entry.id);
        if (!input) continue;
        const nextValue = resolveApplySetNextValue(entry.field, set.value);
        if (entry.field.type === 'boolean') {
          input.checked = nextValue;
        } else {
          const previousValue = input.value;
          input.value = nextValue;
          // number / select はブラウザが受理しない値（非数値・未知の選択肢）を書き込むと
          // 黙って空文字・未選択へ落ちる。書き込んだ直後に読み直し、意図どおり入らなかった
          // 場合は値を元へ戻したうえで対象外（skippedCount）へ回す。型に合わない値を
          // 「切り替えました」と誤報告しない・欄の見た目を空のまま残さないための対応
          // （安藤のレビュー指摘）。
          if (input.value !== nextValue) {
            input.value = previousValue;
            continue;
          }
        }
        input.dispatchEvent(new Event('input'));
        input.dispatchEvent(new Event('change'));
        appliedCount += 1;
        changedEntries.push(entry);
      }

      // 今見ているタブ内で変わった行だけを一時的にフラッシュする。アニメーションは
      // prefers-reduced-motion を CSS 側で尊重する（renderer/style.css 参照）。タイマーは
      // モーダルを閉じるときに clearFlashResetTimers() でまとめて片付ける。
      changedEntries
        .filter((entry) => entry.tabIndex === currentActiveIndex)
        .forEach((entry) => {
          const row = getEntryRow(entry.id);
          if (!row) return;
          row.classList.add('settings-content-table-flash');
          const timerId = setTimeout(() => {
            flashResetTimers.delete(timerId);
            row.classList.remove('settings-content-table-flash');
          }, 300);
          flashResetTimers.add(timerId);
        });

      const skippedCount = sets.length - appliedCount;
      // 「変更できない状態」は無効化中・非表示の欄にしか当てはまらない。password 欄
      // （isApplyTarget が除外）は普通に編集できる欄だし、型不一致（number への非数値・
      // select の未知の選択肢）も欄自体は変更可能で今回のセット内容が受理されなかった
      // だけなので、理由を問わない中立な言い回しにする（植草さんのレビュー指摘）。
      const summary = skippedCount > 0
        ? `${appliedCount}件の設定を切り替えました（${skippedCount}件は対象外です。無効化中・非表示・保護対象の項目や、反映できない値だったため）。保存するには「保存」を押してください。`
        : `${appliedCount}件の設定を切り替えました。保存するには「保存」を押してください。`;
      showGenericToast(summary);
    };

    modal.querySelectorAll('.settings-content-apply-button').forEach((button) => {
      button.addEventListener('click', () => {
        if (button.getAttribute('aria-disabled') === 'true' || button.getAttribute('aria-busy') === 'true') return;
        let sets = [];
        try {
          sets = JSON.parse(button.dataset.applySets || '[]');
        } catch (_e) {
          sets = [];
        }
        // 押した時点のスナップショットで、確認ダイアログを挟むかどうかと表示件数を決める。
        // 実際の書き込みは applySettingsContentTableTargets 側で対象ごとに状態を取り直す
        // ため、連動で状態が変わるケースでは適用結果の件数と多少ずれうる（許容する）。
        const eligible = sets
          .map((set) => ({ set, entry: entries.find(({ field }) => field.key === set.key) }))
          .filter(({ entry }) => isApplyTarget(entry));
        if (eligible.length === 0) return; // ボタンは aria-disabled のはずだが念のための保険

        const willOverwrite = eligible.some(({ set, entry }) => {
          const input = getEntryInput(entry.id);
          if (!input) return false;
          const nextValue = resolveApplySetNextValue(entry.field, set.value);
          const currentValue = entry.field.type === 'boolean' ? input.checked : input.value;
          return currentValue !== nextValue;
        });

        const doApply = () => applySettingsContentTableTargets(button, sets);

        if (willOverwrite) {
          const template = button.dataset.applyConfirmTemplate || '';
          const message = template.replace('{count}', String(eligible.length));
          openApplyContentTableConfirmDialog(message, doApply);
        } else {
          doApply();
        }
      });
    });

    // 横スクロール領域（.settings-content-table-wrap）のキーボード操作（issue #380
    // 麗美の実機確認指摘）。tabindex="0" で Tab 到達はできても、Chromium は
    // overflow-x だけを持つフォーカス可能要素に既定のキーボードスクロールを割り当てない
    // ため、到達しても隠れた列を読む手段が無かった（マウスホイールでは実際にスクロール
    // できており、実装そのものは機能している）。ArrowLeft/ArrowRight で少しずつ、
    // Home/End で両端へ移動できるようにする。
    modal.addEventListener('keydown', (event) => {
      // event.target は「今フォーカスしている要素」そのもの。closest() で祖先まで
      // 拾わないのは、ラッパー内の子（再試行ボタン等、実際にフォーカスを持てる要素）に
      // フォーカスがあるときはこの分岐を素通りさせ、表の外・入力欄・ボタンでの
      // キー操作を奪わないため（「スクロール領域自体にフォーカスがあるときだけ」）。
      const wrap = event.target;
      if (!(wrap instanceof HTMLElement) || !wrap.classList.contains('settings-content-table-wrap')) return;
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight' && event.key !== 'Home' && event.key !== 'End') return;
      // 収まりきっている表（スクロールの必要が無い）では既定動作に任せ、キー操作を
      // 飲み込まない。Tab はそもそもこの 4 キーに含まれないため常に素通しされる。
      if (wrap.scrollWidth <= wrap.clientWidth) return;
      if (event.key === 'ArrowLeft') wrap.scrollLeft -= SETTINGS_CONTENT_TABLE_SCROLL_STEP;
      else if (event.key === 'ArrowRight') wrap.scrollLeft += SETTINGS_CONTENT_TABLE_SCROLL_STEP;
      else if (event.key === 'Home') wrap.scrollLeft = 0;
      else wrap.scrollLeft = wrap.scrollWidth;
      event.preventDefault();
    });

    // savedValue セルの初期取得は、updateSettingsApplyButtons の実体（上の代入）より
    // 後ろで蹴る。ここより前で呼ぶと fetchSavedValues 内の呼び出しが代入前の no-op
    // スタブを掴んだままになり、初回だけ aria-busy が反映されない（安藤のレビュー指摘）。
    fetchSavedValues(Array.from(modal.querySelectorAll('[data-savedvalue-key]')));

    updateSettingsApplyButtons();
    updateSettingsFooter();
  }

  // password の表示/非表示トグル
  modal.querySelectorAll('.settings-reveal').forEach(rev => {
    rev.addEventListener('click', () => {
      const input = modal.querySelector('#' + rev.dataset.target);
      if (!input) return;
      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      rev.textContent = show ? '🙈' : '👁';
    });
  });

  // ─── pattern 検証（issue #140） ──────────────────────────────────────────────
  // 検証対象は field.pattern（正規表現文字列）を持つフィールドのみ。type ではなく
  // pattern の有無で判定することで、text/number など type を問わず汎用的に扱う。
  const validatable = entries.filter(
    ({ field }) => typeof field.pattern === 'string' && field.pattern !== ''
  );

  // 1 フィールドの検証結果を DOM に反映する。valid かどうかを返す。
  // - valid: aria-invalid を外し、エラー文をクリア（赤枠も CSS 側で解除される）。
  // - invalid: aria-invalid="true" を付与し、invalidMessage（無ければ汎用文）を表示。
  //   invalidMessage は textContent で流し込むため HTML として解釈されない（XSS 安全）。
  const applyFieldValidity = (field, id) => {
    const input = getEntryInput(id);
    const errEl = modal.querySelector('#' + id + '-error');
    if (!input) return true;
    if (!isEntryVisible(id) || isEntryDisabled(id)) {
      input.removeAttribute('aria-invalid');
      if (errEl) errEl.textContent = '';
      return true;
    }
    const valid = isPatternValid(field.pattern, input.value);
    if (valid) {
      input.removeAttribute('aria-invalid');
      if (errEl) errEl.textContent = '';
    } else {
      input.setAttribute('aria-invalid', 'true');
      if (errEl) errEl.textContent = field.invalidMessage || '入力形式が正しくありません';
    }
    return valid;
  };

  // エラー表示を一旦消す（保存時の再判定前リセットに使う）。
  const clearFieldValidity = (field, id) => {
    const input = getEntryInput(id);
    const errEl = modal.querySelector('#' + id + '-error');
    if (input) input.removeAttribute('aria-invalid');
    if (errEl) errEl.textContent = '';
  };

  const disabledFieldValues = new Map();
  const applyFieldState = () => {
    const values = getCurrentSettingValues();
    for (const { field, id } of entries) {
      const row = getEntryRow(id);
      const input = getEntryInput(id);
      if (!row || !input) continue;
      const visible = isFieldVisible(field, values);
      const disabled = visible && isFieldDisabled(field, values);
      row.hidden = !visible;
      row.classList.toggle('settings-row-disabled', disabled);

      const reason = modal.querySelector('#' + id + '-disabled-reason');
      if (disabled) {
        if (!isEntryDisabled(id)) {
          disabledFieldValues.set(id, { value: input.value, checked: input.checked });
        }
        input.setAttribute('aria-disabled', 'true');
        if (reason) {
          reason.hidden = false;
        }
        clearFieldValidity(field, id);
      } else {
        input.removeAttribute('aria-disabled');
        disabledFieldValues.delete(id);
        if (reason) reason.hidden = true;
        if (!visible) clearFieldValidity(field, id);
      }
      syncEntryDescribedBy(id);
    }
    // 表ブロック・一括切り替えボタン（issue #380）も、入力欄の表示・無効化と同じ
    // 発火点（applyFieldState）で再計算する。useTabbedSettings が false のときは
    // no-op（宣言側の既定値のまま）。
    refreshSettingsContentTables(values);
    updateSettingsApplyButtons();
    scheduleSettingsContentTableLivehint();
  };

  // 表示中の欄に pattern 違反が残っているか。DOM の aria-invalid ではなく値から判定する。
  // 各欄の再検証リスナはこの下で登録されており、同じ input イベントでは onEntryEdited の
  // 方が先に走るため、この時点の aria-invalid は 1 打鍵ぶん古い。値を見れば登録順に
  // 依存しない。非表示・無効の欄は applyFieldValidity 同様に検証対象から外す。
  const hasInvalidVisibleEntry = () => validatable.some(({ field, id }) => {
    const input = getEntryInput(id);
    if (!input || !isEntryVisible(id) || isEntryDisabled(id)) return false;
    return !isPatternValid(field.pattern, input.value);
  });

  // フッターの総括メッセージは「表示が実態と食い違った時点」で消す。
  //  - 「保存しました」(ok): 編集を再開した時点で食い違う（未保存の変更を抱えている）
  //  - 「入力内容に問題があります」(err): 不正な欄がゼロになった時点で食い違う
  // err を打鍵のたびに消さないのは、直している最中に何を指摘されたのかを見失わせない
  // ため。1 つでも不正が残っていれば出したままにする。逆に直しきったあとも残すと、
  // 問題が無いのに「まだどこかにある」と言い続けることになり、存在しない不正欄を
  // 探させてしまう。
  const clearStaleSettingsMessage = () => {
    const stale = msg.classList.contains('ok')
      || (msg.classList.contains('err') && !hasInvalidVisibleEntry());
    if (!stale) return;
    msg.textContent = '';
    msg.className = 'settings-msg';
  };

  // 保存後にユーザーが操作を続けているならパネルを勝手に閉じない、という原則は
  // タブ移動（activateTab）だけでなく同じタブに留まったままの編集にも要る。適用しないと
  // 「保存 → 続けて編集 → 2.5 秒で消えて編集が失われる」「保存 → 不正値で再保存 →
  // エラーを出したまま消える」が起きる。タブ表示のときしか動かない markDirty ではなく、
  // 全モードで動くこのループに寄せる。
  const onEntryEdited = () => {
    autoClose.cancel();
    // 保存直後のフッター固定は、編集を始めた時点で理由（押した直後にボタンが
    // 並び替わるのを防ぐ）が消える。
    unlockSettingsFooter();
    // 表示中の欄が変わると「不正な欄が残っているか」の答えも変わるので、
    // 総括メッセージの判定より先に表示状態を更新しておく。
    applyFieldState();
    clearStaleSettingsMessage();
  };
  // aria-disabled はフォーカス順を保つ代わりにブラウザ標準では編集を止めないため、
  // 操作イベントを JavaScript で遮断する。万一 input/change が発火しても退避値へ戻し、
  // 条件再評価や dirty 化より前で止める。
  for (const { id } of entries) {
    const input = getEntryInput(id);
    if (!input) continue;
    const blockDisabledPointer = (event) => {
      if (!isEntryDisabled(id)) return;
      event.preventDefault();
      if (event.type === 'mousedown') input.focus();
    };
    input.addEventListener('mousedown', blockDisabledPointer);
    input.addEventListener('click', blockDisabledPointer);
    input.addEventListener('beforeinput', (event) => {
      if (isEntryDisabled(id)) event.preventDefault();
    });
    input.addEventListener('keydown', (event) => {
      if (!isEntryDisabled(id) || event.key === 'Tab') return;
      const copyShortcut = (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'c';
      // キャレット移動キーを許可するのは text 系 input と textarea だけ。select では
      // 同じキーが選択値を変えるため、Tab とコピー以外をすべて遮断する。
      // number も矢印キーで値が変わるため、キャレット移動キーを含めて遮断する。
      const textInputTypes = ['text', 'search', 'tel', 'url', 'email', 'password'];
      const hasTextCaret = input.tagName === 'TEXTAREA'
        || (input.tagName === 'INPUT' && textInputTypes.includes(input.type));
      const textNavigation = hasTextCaret
        && ['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key);
      if (!copyShortcut && !textNavigation) event.preventDefault();
    });
    const restoreDisabledValue = (event) => {
      if (!isEntryDisabled(id)) return;
      const snapshot = disabledFieldValues.get(id);
      if (snapshot) {
        input.value = snapshot.value;
        input.checked = snapshot.checked;
      }
      event.stopImmediatePropagation();
    };
    input.addEventListener('input', restoreDisabledValue);
    input.addEventListener('change', restoreDisabledValue);
    input.addEventListener('input', onEntryEdited);
    input.addEventListener('change', onEntryEdited);
  }
  applyFieldState();

  // apiHost はその場で認証要否の案内を出す（issue #313）。保存・再起動して初めて
  // 気づく流れを避けるため、入力のたびに即時判定する。
  const apiHostEntryForNotice = entries.find(({ field }) => field.key === 'apiHost');
  if (apiHostEntryForNotice) {
    const apiHostInput = getEntryInput(apiHostEntryForNotice.id);
    const apiHostNoticeEl = modal.querySelector('#' + apiHostEntryForNotice.id + '-notice');
    if (apiHostInput && apiHostNoticeEl) {
      const applyApiHostNotice = () => {
        const notice = getApiHostAuthNotice(apiHostInput.value);
        if (!notice) {
          apiHostNoticeEl.hidden = true;
          apiHostNoticeEl.textContent = '';
          apiHostNoticeEl.removeAttribute('data-tone');
          return;
        }
        apiHostNoticeEl.hidden = false;
        apiHostNoticeEl.textContent = notice.text;
        apiHostNoticeEl.setAttribute('data-tone', notice.tone);
      };
      applyApiHostNotice();
      apiHostInput.addEventListener('input', applyApiHostNotice);
    }
  }

  // "優しく遅らせ、素早く許す": 打鍵中は警告せず blur で初回検証。エラーが付いた後だけ
  // input イベントで再検証し、valid になれば即解除する。
  for (const { field, id } of validatable) {
    const input = getEntryInput(id);
    if (!input) continue;
    input.addEventListener('blur', () => { applyFieldValidity(field, id); });
    input.addEventListener('input', () => {
      if (input.getAttribute('aria-invalid') === 'true') applyFieldValidity(field, id);
    });
  }

  modal.querySelector('.settings-save').addEventListener('click', async () => {
    // 保存前の検証ゲート: 全エラー表示を一旦クリアしてから対象を一括再判定する。
    for (const { field, id } of validatable) clearFieldValidity(field, id);
    let firstInvalid = null;
    for (const { field, id } of validatable) {
      const valid = applyFieldValidity(field, id);
      if (!valid && !firstInvalid) firstInvalid = modal.querySelector('#' + id);
    }
    // 1 つでも不一致なら settings:save を呼ばず中断し、最初の不正欄へフォーカスする。
    if (firstInvalid) {
      msg.textContent = '入力内容に問題があります';
      msg.className = 'settings-msg err';
      // タブ表示のときは switchToFieldTab が着地まで済ませている（二重に呼んでも冪等）。
      // タブ無しモードでは何もしないので、ここで中央寄せとフォーカスを行う。
      switchToFieldTab(firstInvalid);
      if (typeof firstInvalid.scrollIntoView === 'function') {
        firstInvalid.scrollIntoView({ block: 'center' });
      }
      firstInvalid.focus({ preventScroll: true });
      return;
    }

    const out = {};
    for (const { field, id } of entries) {
      const input = getEntryInput(id);
      if (!input) continue;
      out[field.key] = field.type === 'boolean' ? input.checked : input.value;
    }
    msg.textContent = '保存中...';
    msg.className = 'settings-msg';
    try {
      const res = await VKIpc.invoke('settings:save', out);
      if (res && res.ok) {
        // dirty 解除でフッターの構成が変わらないよう、先に固定してから解除する。
        lockSettingsFooter();
        clearDirtyTabs();
        // 保存でファイルの中身が変わったので、savedValue セル（＝保存済みの値）を
        // 取り直す。取り直さないと、保存後も編集を続けた場合に古い値が残り続ける
        // （安藤のレビュー指摘・issue #380）。
        refreshSettingsContentSavedValues();
        msg.textContent = '保存しました。次回の起動から反映されます。';
        msg.classList.add('ok');
        autoClose.arm();
      } else {
        msg.textContent = 'エラー: ' + (res && res.error ? res.error : '不明なエラー');
        msg.classList.add('err');
      }
    } catch (e) {
      msg.textContent = 'エラー: ' + e.message;
      msg.classList.add('err');
    }
  });
}

// ─── Init ─────────────────────────────────────────────────────────────────────
async function initApp() {
  // エージェントルーム（issue #58）の有効/無効を main から取得（最初の render より前に確定させる）。
  try {
    const cfg = await VKIpc.invoke('app:get-config');
    agentRoomEnabled = !!(cfg && cfg.agentroom);
    newPaneStartupDir = (cfg && typeof cfg.newPaneStartupDir === 'string') ? cfg.newPaneStartupDir : '';
    newPaneAutoLaunchClaude = !!(cfg && cfg.newPaneAutoLaunchClaude);
    // main 側でも正規化済みだが、取得失敗・欠落に備えてここでも既定 'busy' に落とす。
    confirmClosePref = normalizeConfirmClose(cfg && cfg.confirmClose);
    // main 側でも正規化済みだが、取得失敗・欠落に備えてここでも既定 'click' に落とす（issue #385）。
    terminalLinkClickModePref = normalizeTerminalLinkClickMode(cfg && cfg.terminalLinkClickMode);
    waitingExcludeCwdPatterns = normalizeWaitingExcludeCwdPatterns(cfg && cfg.waitingExcludeCwdPatterns);
    commandsConfigured = !!(cfg && typeof cfg.commandsFile === 'string' && cfg.commandsFile.trim());
    renderWidget();
    // ヘッダー／タブのアプリ名。呼び出し側（例: vk-orchestrator）が env で上書きすると
    // main が app:get-config で伝えてくる。未指定時は index.html の既定 'VK Terminals'。
    if (cfg && typeof cfg.appTitle === 'string' && cfg.appTitle.trim()) {
      const titleEl = document.querySelector('.app-title');
      if (titleEl) titleEl.textContent = cfg.appTitle.trim();
      document.title = cfg.appTitle.trim();
    }
  } catch (_e) { /* 取得失敗時は無効のまま */ }

  // Dispose any existing terminals
  // ホバー中に一括破棄されるとリンクの leave が発火しないため、closePane() と同様に
  // ここでもツールチップを明示的に隠す（安藤レビュー指摘・LOW）。
  hideTermLinkTooltip();
  for (const [paneId, t] of Object.entries(terminals)) {
    // terminals を丸ごと差し替えるため、closePane() と同様にタイマーを破棄する。
    // 残ったままだと古い terminals[paneId] をクロージャで掴み続け、消えたペインに
    // 対して判定・status 更新が走る（issue vektor-inc/vk-orchestrator#212）。
    clearRunningIdleTimer(t);
    clearWaitingCheckTimer(t);
    try { t.term.dispose(); } catch (e) {}
    VKIpc.send('terminal:kill', t.termId);
  }
  terminals = {};
  focusedPaneId = null;
  // 破棄済みペイン分のフォーカスガード記録も一掃する（issue #385。terminals と同じ扱い）。
  paneFocusBeforeMousedown.clear();

  const paneId = newId();
  // stashOrder: サイドバー格納ペインの並び（issue #89）。sidebarWidth: セッション内の可変幅。
  tree = { type: 'grid', order: [paneId], colFr: null, rowFr: null, stashOrder: [], sidebarWidth: DEFAULT_SIDEBAR_WIDTH };
  // 起動時の初回ペインも手動の新規ペイン（＋ボタン・分割）と同じく newPaneStartupDir に従う。
  // 存在しないパスは main 側 terminal:create が HOME へフォールバックする。
  await createTerminal(paneId, newPaneStartupDir || null);
  focusedPaneId = paneId;

  render();
  requestAnimationFrame(() => {
    fitTerminal(paneId);
    terminals[paneId]?.term.focus();
  });
}

// サイドバーは root の flex 子として常駐させるため、初回 render 前に配線する。
setupSidebarMenu();

initApp().then(() => {
  // 起動完了を main プロセスに通知（main 側で additionalPanes を順次作成する）
  VKIpc.send('terminal:renderer-ready');
});

// 設定モーダルの歯車ボタンを配線する（設定のみ。使用量はサイドバー上部へ常時表示）。
setupSettingsPanel();

// 使用率警告ドットバッジ（☰ メニューボタン）とサイドバー使用量カードを配線する。
setupUsageBadge();
setInterval(tickWidgetStale, TASKS_ELAPSED_TICK_MS);

// ─── State reporting to main process ─────────────────────────────────────────
setInterval(() => {
  const states = {};
  for (const [paneId, t] of Object.entries(terminals)) {
    if (!t) continue;
    // エージェントルーム（issue #58）: API 失効後の取り残しを防ぐため、ここで TTL を含めて
    // 定期再評価する（updatePaneStatus / API 受信以外の契機を補う）。変化時のみ再描画。
    if (agentRoomEnabled) refreshAgentRoomIfChanged(paneId);
    states[paneId] = {
      termId: t.termId,
      cwd: t.cwdFull || '',
      cwdShort: t.cwd || '~',
      // waiting は内部判定フラグ。後方互換のため引き続き出力（task-queue 連携などが参照）。
      waiting: t.waiting,
      // externalWaiting は POST /api/set-status 由来の外部権威フラグ。
      externalWaiting: t.externalWaiting || false,
      // status は issue #23 で追加した表示用ステータス（'idle' | 'running' | 'waiting'）。
      // 既存フィールドは破壊せず、新規追加のみ。
      status: t.status || 'idle',
      lastOutputTime: t.lastOutputTime,
      lastInputTime: t.lastInputTime,
      lastLines: t.lastLines,
      // backgroundAgents（issue #340）: バックグラウンドで動く Claude Code サブ
      // エージェント数。整数（0 以上）または不明を表す null。既存フィールドの
      // 意味・値には影響しない追加のみのフィールド。
      backgroundAgents: readBackgroundAgents(t),
      // taskTitle: OSC 0/2 由来のタイトル（後方互換のため既存キーを維持）
      // apiTitle:  POST /api/set-title 由来のタイトル（issue #22 で分離）
      // apiUrl:    POST /api/set-title 由来の URL（issue #29）。apiTitle 表示時のみリンク化される
      // apiPrUrl:  POST /api/set-title 由来の PR URL（issue #44）。タイトル右の独立ボタン用
      // displayTitle: 実際にペイン上部に表示している値（apiTitle || taskTitle）
      taskTitle: t.taskTitle || '',
      apiTitle: t.apiTitle || '',
      apiUrl: t.apiUrl || '',
      apiPrUrl: t.apiPrUrl || '',
      apiPrMerged: !!t.apiPrMerged,
      // apiWaitingMerge（issue #363）: apiPrMerged と同じ経路（POST /api/set-title →
      // terminal:title IPC）で受け取ったマージ待ち状態。フィールド名は送信側
      // （vk-orchestrator#389）が GET /api/states から読み戻す名前 `apiWaitingMerge` に
      // 合わせている（`apiPrWaitingMerge` ではない。合わせないと送信側が毎回 undefined を
      // 読んで false を送り、マージ待ち表示が巻き戻る）。モバイル（mobile.js）も
      // この states レポートを GET /api/states 経由でそのまま参照するため、
      // ここに追加するだけで PC・モバイル双方に配線が乗る。
      apiWaitingMerge: !!t.apiWaitingMerge,
      displayTitle: getDisplayTitle(t),
      // collapsed: グリッド化で折り畳み機能を撤去したため常に false（後方互換のためキーは維持）。
      collapsed: false,
      // stashed: サイドバーへ格納中かどうか（issue #89）。外部監視ツール向けの新規フィールド。
      stashed: !!(tree && Array.isArray(tree.stashOrder) && tree.stashOrder.includes(paneId)),
      // lock: HTTP API POST /api/set-lock 由来の操作ロック状態。未設定は null（全許可）。
      lock: (t.lock && typeof t.lock.close === 'boolean') ? { close: t.lock.close } : null,
      // agentRoom（issue #58）: 解決済みのルーム状態 { name: state }。
      // agentroom 有効時のみ出力（モバイルページ等の将来連携用）。
      ...(agentRoomEnabled ? { agentRoom: resolveRoomAgents(t) } : {}),
    };
  }
  VKIpc.send('terminal:report-states', states);
}, 2000);

// ─── Agent room update from main (HTTP API POST /api/agentroom) ──────────────
// replace=true: そのペインのルーム状態を agents で丸ごと置換。
// replace=false: agents の分だけ既存状態にマージ（1 人更新）。
// いずれも agentRoomUpdatedAt を更新して「新鮮」扱いにする。
VKIpc.on('terminal:agentroom', (termId, agents, replace) => {
  const paneId = Object.keys(terminals).find(k => terminals[k]?.termId === termId);
  if (!paneId) return;
  const t = terminals[paneId];
  if (!t || !agents || typeof agents !== 'object') return;
  if (replace) {
    t.agentRoom = { ...agents };
  } else {
    t.agentRoom = { ...(t.agentRoom || {}), ...agents };
  }
  t.agentRoomUpdatedAt = Date.now();
  updateAgentRoom(paneId);
});

// ─── New pane request from HTTP API ──────────────────────────────────────────
VKIpc.on('terminal:request-new-pane', async (payload = {}) => {
  const { requestId, cwd, noClaude, engine, stashed, useDefaults, model } = payload;
  const reply = (result) => VKIpc.send('terminal:new-pane-created', { requestId, ...result });
  const targetPaneId = findLargestVisiblePaneId() || focusedPaneId || (tree ? getAllLeafIds(tree)[0] : null);
  if (!targetPaneId) {
    reply({ error: 'no pane available' });
    return;
  }
  try {
    // 表示面積が最大のペインを長辺方向に分割し、全体の空きが大きい場所へ追加する
    const rect = getPaneRect(targetPaneId);
    const direction = (rect && rect.height > rect.width) ? 'v' : 'h';
    // useDefaults: true でオプトインした呼び出し（モバイルの「ペインを追加」ボタン）だけ、
    // cwd/noClaude 省略時に config 既定値（newPaneStartupDir / !newPaneAutoLaunchClaude）を補い、
    // デスクトップの「＋」ボタン（addPane(newPaneStartupDir || null, { noClaude: !newPaneAutoLaunchClaude })）
    // と挙動を揃える。明示指定があればそれを優先する。
    // useDefaults を渡さない既存呼び出し元（orchestrator 等）は従来どおり passthrough し、
    // noClaude 省略時は main.js 側の既定（globalPlainMode）解決に委ねる＝既存挙動を変えない（issue #217）。
    let effectiveCwd = cwd;
    let splitOptions = typeof noClaude === 'boolean' ? { noClaude } : {};
    if (useDefaults === true) {
      if (typeof cwd !== 'string' || !cwd) effectiveCwd = newPaneStartupDir || null;
      if (typeof noClaude !== 'boolean') splitOptions = { noClaude: !newPaneAutoLaunchClaude };
    }
    // engine / model は noClaude と同じく main へ素通しする（issue #367 / #310）。値の
    // 妥当性は HTTP 受け口と main 側の terminal:create の両方で検証されるため、ここでは
    // 判定しない。未指定なら splitOptions に載らない＝main 側は従来どおり素の claude を
    // 起動する。エンジン別の model 検証とコマンド組み立ては main 側
    // （terminal:create）に一元化してあるため、ここでは engine と model を独立に素通しする。
    if (typeof engine === 'string') splitOptions = { ...splitOptions, engine };
    if (typeof model === 'string') splitOptions = { ...splitOptions, model };
    const result = await splitPane(targetPaneId, direction, effectiveCwd, splitOptions);
    if (!result || !result.termId) {
      reply({ error: 'split failed or termId unavailable' });
      return;
    }
    if (stashed === true) {
      stashPane(result.paneId);
    }
    reply({ termId: result.termId });
  } catch (e) {
    reply({ error: e?.message || 'failed to create pane' });
  }
});

VKIpc.on('terminal:request-close-pane', (payload = {}) => {
  const { requestId, termId } = payload;
  const reply = (result) => VKIpc.send('terminal:close-pane-done', { requestId, ...result });
  // termId → paneId 逆引き（既存の terminal:title / set-status ハンドラと同じパターン）
  const paneId = Object.keys(terminals).find(k => String(terminals[k]?.termId) === String(termId));
  if (!paneId) {
    reply({ error: 'terminal not found' });
    return;
  }
  try {
    closePane(paneId, { force: true });
    reply({ ok: true, termId: termId });
  } catch (e) {
    reply({ error: e?.message || 'failed to close pane' });
  }
});

// ─── Title update from main (HTTP API POST /api/set-title) ──────────────────
// API 由来のタイトルは apiTitle に保存し、OSC 由来の taskTitle とは別フィールドで管理する。
// これにより claude TUI が継続的に発行する OSC 0/2 で API 設定タイトルが上書きされない。
// 空文字を送ると apiTitle がクリアされ、OSC 由来の taskTitle にフォールバックする。
// 第3引数 url（issue #29）: タイトル全体をリンク化するための URL。
//   - undefined → 後方互換のため URL 変更なしと解釈（ただし main 側は常に第3引数を送る）
//   - 空文字  → apiUrl をクリア
//   - 文字列 → http(s): スキームのみ（main 側で検証済み）。apiUrl にセット
// 第4引数 prUrl（issue #44）: タイトル右側の独立した [ PR ↗ ] ボタン用 URL。
//   - undefined → 後方互換のため prUrl 変更なしと解釈（ただし main 側は常に第4引数を送る）
//   - 空文字  → apiPrUrl をクリア（PR ボタン非表示）
//   - 文字列 → http(s): スキームのみ（main 側で検証済み）。apiPrUrl にセット
// 第5引数 prMerged: PR ボタンのマージ済み表示フラグ。boolean のときのみ apiPrMerged に反映する。
// 第6引数 waitingMerge（issue #363）: PR ボタンのマージ待ち表示フラグ。prMerged と同じく
// boolean のときのみ apiWaitingMerge に反映する（後方互換のため、それ以外の型は無視して
// 既存値を保持する）。prMerged と同時に true が来た場合の優先順位は getPrBadgePresentation 側で判定する。
// フィールド名はワイヤ上（POST /api/set-title の waitingMerge）に合わせている。
// title / url / prUrl / prMerged / waitingMerge はペアで都度送る置換セマンティクス。
VKIpc.on('terminal:title', (termId, title, url, prUrl, prMerged, waitingMerge) => {
  const paneId = Object.keys(terminals).find(k => terminals[k]?.termId === termId);
  if (!paneId) return;
  terminals[paneId].apiTitle = title || '';
  // url が string で渡ってきた場合のみ書き換える（旧来の 2 引数呼び出しとの後方互換のため）
  if (typeof url === 'string') {
    terminals[paneId].apiUrl = url;
  }
  // prUrl も同様。後方互換のため string 以外は無視する。
  if (typeof prUrl === 'string') {
    terminals[paneId].apiPrUrl = prUrl;
  }
  // prMerged も同様。後方互換のため boolean 以外は無視する。
  if (typeof prMerged === 'boolean') {
    terminals[paneId].apiPrMerged = prMerged;
  }
  // waitingMerge も同様。後方互換のため boolean 以外は無視する。
  if (typeof waitingMerge === 'boolean') {
    terminals[paneId].apiWaitingMerge = waitingMerge;
  }
  updatePaneTitle(paneId);
});

// ─── Status update from main (HTTP API POST /api/set-status) ────────────────
// 外部権威の入力待ちフラグを明示的に設定する。markPaneInput / 自動入力では解除しない。
VKIpc.on('terminal:set-status', (termId, waiting) => {
  const paneId = Object.keys(terminals).find(k => terminals[k]?.termId === termId);
  if (!paneId) return;
  const t = terminals[paneId];
  if (!t) return;
  t.externalWaiting = !!waiting;
  recomputeStatus(paneId);
});

// ─── Lock update from main (HTTP API POST /api/set-lock) ────────────────────
// lock.close === false のときだけ閉じる操作を保護する。未設定/null は全許可。
VKIpc.on('terminal:set-lock', (termId, lock) => {
  const paneId = Object.keys(terminals).find(k => String(terminals[k]?.termId) === String(termId));
  if (!paneId) return;
  const t = terminals[paneId];
  if (!t) return;
  t.lock = (lock && typeof lock.close === 'boolean') ? { close: lock.close } : null;
  updatePaneCloseLock(paneId);
});

// ─── Auto-input notification from main (HTTP API経由の入力時) ─────────────────
VKIpc.on('terminal:auto-input', (termId) => {
  const paneId = Object.keys(terminals).find(k => terminals[k]?.termId === termId);
  if (!paneId) return;
  markPaneInput(paneId);
  const paneEl = document.querySelector(`.pane[data-id="${paneId}"]`);
  if (!paneEl) return;
  const badge = paneEl.querySelector('.auto-input-badge');
  if (badge) {
    badge.textContent = '🤖 自動入力';
    // インラインスタイルではなく hidden 属性でトグルし、共通バッジ basis
    // (.pane-badge の display: inline-flex) を活かす（issue #35）
    badge.hidden = false;
    paneEl.classList.add('auto-input');
    // 先発の自動非表示タイマーが残っていればクリアしてから新規予約する
    // （短時間に複数回イベントが来た際に後発のバッジが 3 秒より早く消える問題対策／issue #38）
    const existing = paneEl.dataset.autoInputTimer;
    if (existing) clearTimeout(Number(existing));
    paneEl.dataset.autoInputTimer = String(setTimeout(() => {
      const el = document.querySelector(`.pane[data-id="${paneId}"]`);
      if (!el) return;
      const b = el.querySelector('.auto-input-badge');
      if (b) b.hidden = true;
      el.classList.remove('auto-input');
      delete el.dataset.autoInputTimer;
    }, 3000));
  }
});
