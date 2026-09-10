'use strict';

const { stripAnsiForPattern } = require('./stripAnsi');
const {
  createTrustPromptGate,
  isTrustPrompt,
  TRUST_WINDOW_MS: DEFAULT_TRUST_WINDOW_MS,
  READY_GRACE_MS: DEFAULT_READY_GRACE_MS,
} = require('./trustPromptGate');

// ─── AI エンジンの「起動完了」検知パターン（issue #392 の追加対応でここへ集約）───────
//
// 元々は main.js の terminal:create（ペイン作成直後の初回起動を監視するクロージャ）の
// 内側だけに存在していた。POST /api/restart-agent（ログインシェルを保ったまま AI だけ
// 起動し直す経路）にも同じ「起動完了検知 → trustGate.markReadyDetected」を効かせる
// 必要が生じたため、判定を2箇所に作り直さずに済むようここへ切り出した
// （判定を二重に持つと片方だけ緩い抜け道ができるため。trustPromptGate.js 自体を
// 再利用する方針と同じ考え方）。
//
// Claude: 起動完了バナー・ショートカット案内などのいずれかに一致（main.js から移設。
// 判定内容は変更していない）。
const CLAUDE_READY_PATTERN = /\?\s*for\s*shortcuts|\?\s*to\s*show\s*shortcuts|for\s*shortcuts|Welcome to Claude|Try\s*["']?\/help|Bypass(ing)?\s*Permissions|accept edits/i;
// Codex（issue #367。codex-cli 0.147.0 実機確認）: 起動完了バナーに "OpenAI Codex" が
// 出る。vk-orchestrator 側の CODEX_READY_PATTERN（setup-entry-autostart.js）と同じ
// パターンを採用する（main.js から移設。判定内容は変更していない）。
const CODEX_READY_PATTERN = /OpenAI Codex/i;

/**
 * AI エンジン種別に応じた「起動完了検知」の正規表現を返す。
 * 未登録の engine は CLAUDE_READY_PATTERN へ倒す（安全側の既定。main.js の元コメント参照）。
 *
 * @param {string} engine - 'claude' | 'codex' 等。isValidEngine 済みの値を渡すこと。
 * @returns {RegExp}
 */
function getReadyPatternForEngine(engine) {
  return engine === 'codex' ? CODEX_READY_PATTERN : CLAUDE_READY_PATTERN;
}

/**
 * 信頼確認プロンプトへの自動 Enter 送信を、ペイン作成時（main.js の terminal:create 内の
 * promptWatcher）と同じ判定（時間窓・ready 検知からの猶予・isTrustPrompt）で行う監視を
 * pty へ取り付ける（issue #392 の追加対応。POST /api/restart-agent が信頼確認画面で
 * 静止したまま止まる不具合への対応）。
 *
 * 判定ロジック（時間窓・ready 猶予・isTrustPrompt の文脈判定）は一切ここで作り直さず、
 * utils/trustPromptGate.js（createTrustPromptGate・isTrustPrompt）をそのまま再利用する。
 * このモジュールが新たに持つのは「pty の出力を読んでゲートへ渡し、許可されたら実際に
 * Enter を書き込む」配線部分だけ。
 *
 * 起点時刻（spawnTime）は呼び出し側が渡す。terminal:create ではペイン作成時刻、
 * restart-agent では「再起動した時刻」を渡すことで、ペイン作成からしばらく経って
 * からの再起動でも、その再起動から改めて時間窓が開く。
 *
 * node-pty の onData（utils/eventEmitter2.js ベース）は複数回の登録をサポートしており、
 * 呼び出しごとに独立したリスナーが追加される。この関数は自分専用の onData を1つ
 * 追加登録するだけで、terminal:create が既に登録している「renderer への転送」用の
 * onData には触れない（ペイン作成経路の既存の挙動を変えない）。
 *
 * @param {object} ptyProcess - node-pty の IPty インスタンス（onData / write を持つ）。
 * @param {object} options
 * @param {number} options.spawnTime - この監視の起点時刻（呼び出し側の時計と同じ単位・
 *   原点の値）。システム時刻の巻き戻りの影響を受けない単調増加時計
 *   （performance.now()）を渡すこと（terminal:create の spawnTime と同じ理由）。
 * @param {string} [options.engine] - 'claude' | 'codex'（未指定は 'claude' 扱い）。
 * @param {number} [options.trustWindowMs] - createTrustPromptGate へそのまま渡す
 *   （既定 utils/trustPromptGate.js の TRUST_WINDOW_MS）。
 * @param {number} [options.readyGraceMs] - createTrustPromptGate へそのまま渡す
 *   （既定 utils/trustPromptGate.js の READY_GRACE_MS）。
 * @param {() => boolean} [options.isAlive] - 自動 Enter 送信の直前に呼び、false の場合は
 *   write しない（対象の pty が既に入れ替わっている・終了している場合の保険）。
 *   既定は常に true。
 * @param {() => number} [options.now] - 時刻取得関数。既定は performance.now。
 *   テストから実時間を待たずに制御できるようにするための注入口。
 * @param {(message: string) => void} [options.log] - 検知・送信時のログ出力先。既定は
 *   何もしない関数（呼び出し側で LOG_PREFIX 等を付けたい場合に渡す）。
 * @returns {{ dispose: () => void, resetBuffer: () => void }} 監視を止めるための
 *   disposable（dispose は冪等・複数回呼んでも安全）と、蓄積済みバッファを空にする
 *   resetBuffer。resetBuffer は、attach の後に呼び出し側が pty へ書き込む行（例:
 *   restart-agent の `cd` コマンド）のエコーがバッファへ残ったまま次の判定に混ざらない
 *   よう、そのエコーを書き終えた直後に呼ぶための口（issue #392 の追加対応・安藤の
 *   指摘・LOW-G）。
 */
function attachTrustAutoResponder(ptyProcess, options = {}) {
  const {
    spawnTime,
    engine,
    trustWindowMs = DEFAULT_TRUST_WINDOW_MS,
    readyGraceMs = DEFAULT_READY_GRACE_MS,
    isAlive = () => true,
    now = () => performance.now(),
    log = () => {},
  } = options;

  const trustGate = createTrustPromptGate({ spawnTime, trustWindowMs, readyGraceMs });
  const READY_PATTERN = getReadyPatternForEngine(engine);

  let buffer = '';
  let subscription = null;

  // データが一切届かない場合でも（想定外の異常系。通常は起動バナー等で必ず何か届く）
  // 時間窓 + ready 猶予の上限が過ぎたら必ず監視を解除する安全網。
  // terminal:create 側の WATCH_TIMEOUT_MS タイマーと同種の役割。
  const safetyTimeoutId = setTimeout(() => {
    dispose();
  }, trustWindowMs + readyGraceMs);
  // このタイマーだけでプロセスの終了を止めないようにする（unref が無い環境では無視）。
  // 単体テストが dispose() を呼ばずに終わるケースを含め、後始末のための保険タイマーが
  // イベントループを掴み続けない設計にしておく。
  if (typeof safetyTimeoutId.unref === 'function') safetyTimeoutId.unref();

  function dispose() {
    if (safetyTimeoutId) clearTimeout(safetyTimeoutId);
    if (subscription) {
      subscription.dispose();
      subscription = null;
    }
  }

  function stopIfDone(nowValue) {
    // restart-agent 経路には initialCommand の概念が無いため、pending は常に false。
    if (trustGate.shouldStopWatching(nowValue, { initialCommandPending: false })) {
      dispose();
    }
  }

  subscription = ptyProcess.onData((data) => {
    const stripped = stripAnsiForPattern(data);
    buffer = (buffer + stripped).slice(-4096);
    const nowValue = now();

    if (isTrustPrompt(buffer) && trustGate.canAutoRespond(nowValue)) {
      trustGate.markTrustHandled();
      buffer = '';
      log('trust prompt detected after restart, sending Enter');
      if (isAlive()) {
        ptyProcess.write('\r');
      }
      stopIfDone(nowValue);
      return;
    }

    if (READY_PATTERN.test(buffer)) {
      trustGate.markReadyDetected(nowValue);
    }

    stopIfDone(nowValue);
  });

  return {
    dispose,
    resetBuffer() {
      buffer = '';
    },
  };
}

module.exports = {
  getReadyPatternForEngine,
  attachTrustAutoResponder,
};
