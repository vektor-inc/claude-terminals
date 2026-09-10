'use strict';

const TERM_SIGNAL = 'SIGTERM';
const KILL_SIGNAL = 'SIGKILL';
const DEFAULT_TERM_GRACE_MS = 1500;
const DEFAULT_STOP_TIMEOUT_MS = 5000;
const DEFAULT_POLL_INTERVAL_MS = 100;
// lstart（起動時刻）を「同一プロセスかどうか」の判定に使う際の許容幅（ミリ秒）。
// macOS の ps は起動時刻をカーネルが保持する値から直接出すため呼び出しごとに安定するが、
// Linux の procps は lstart を「/proc/stat の btime + プロセスの起動 tick」から呼び出しの
// たびに計算し直す。btime は壁時計と単調時計のオフセット由来のため、NTP のステップ補正・
// スリープ復帰・手動での時刻変更が起きると、追跡中の全 PID の起動時刻文字列が一斉にずれ
// うる（安藤の指摘・MEDIUM-A）。厳密一致ではなく、この許容幅以内なら同一プロセスとみなす。
// PID の再利用は起動時刻が大きく離れるため、この許容幅では誤認しない。
// DEFAULT_STOP_TIMEOUT_MS（停止操作 1 回の上限）とは目的が異なる独立した値として持つ
// （安藤の指摘・LOW-2）。停止タイムアウトを将来伸ばしても、プロセス同一視の許容幅が
// 黙って一緒に広がらないようにするため。lstart の想定されるずれ幅（NTP のステップ補正・
// procps の再計算誤差）に対して余裕を持たせつつ、PID 再利用との取り違えを避けられる
// 範囲として 2000ms を既定にしている。
const DEFAULT_LSTART_TOLERANCE_MS = 2000;

// ペインごとの AI 世代番号を main プロセスだけで保持する。
// renderer 由来の状態へ依存させないことで、再起動完了との更新順を一意にする。
function createAgentGenerationStore() {
  const generations = new Map();

  return {
    initialize(termId, hasAgent) {
      generations.set(String(termId), hasAgent ? 1 : 0);
    },
    get(termId) {
      return generations.get(String(termId)) ?? 0;
    },
    increment(termId) {
      const id = String(termId);
      const next = (generations.get(id) ?? 0) + 1;
      generations.set(id, next);
      return next;
    },
    delete(termId) {
      generations.delete(String(termId));
    },
  };
}

// renderer のオブジェクト形状と既存キーを維持したまま、termId で世代番号を足す。
function mergeAgentGenerations(states, getGeneration) {
  if (!states || typeof states !== 'object' || Array.isArray(states)) return states;
  return Object.fromEntries(Object.entries(states).map(([paneId, state]) => {
    if (!state || typeof state !== 'object' || Array.isArray(state)) return [paneId, state];
    return [paneId, { ...state, agentGeneration: getGeneration(state.termId) }];
  }));
}

// HTTP 入力はペインへ触る前にまとめて検証する。engine / model の正は既存関数を注入し、
// この API 専用の許可ルールを二重に持たない。
// cwd はここでは形式（文字列・制御文字なし）だけを見る同期チェックに留める。
// 実在確認（stat）は非同期になるため、この関数の戻り値を見た呼び出し側で別途行う。
function validateRestartAgentRequest(value, validators) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, error: 'termId required' };
  }
  const termIdType = typeof value.termId;
  if ((termIdType !== 'string' && termIdType !== 'number') || String(value.termId) === '') {
    return { ok: false, error: 'termId required' };
  }
  if (!Number.isSafeInteger(value.expectedGeneration) || value.expectedGeneration < 0) {
    return { ok: false, error: 'expectedGeneration required' };
  }

  const engine = value.engine === undefined ? 'claude' : value.engine;
  if (!validators.isValidEngine(engine)) {
    return { ok: false, error: 'invalid engine' };
  }
  if (value.model !== undefined && !validators.isValidModelForEngine(engine, value.model)) {
    return { ok: false, error: 'invalid model' };
  }
  if (value.cwd !== undefined) {
    // PTY への write はキーストロークとして扱われるため、制御文字はクォートに渡さない。
    if (typeof value.cwd !== 'string' || !value.cwd || /[\x00-\x1f\x7f]/.test(value.cwd)) {
      return { ok: false, error: 'invalid cwd' };
    }
    // 実在確認（fs.promises.stat）は非同期のため、ここでは行わない。
    // 呼び出し側が ok: true を確認した後、cwd が undefined でなければ別途 await で確認すること。
  }

  return {
    ok: true,
    termId: String(value.termId),
    expectedGeneration: value.expectedGeneration,
    cwd: value.cwd,
    engine,
    model: value.model,
  };
}

// ps の pid/ppid/lstart 一覧を、子孫探索・同一性の再照合・生存確認に使う索引へ変換する。
// lstart（起動時刻）は、PID が再利用された別プロセスや、孤児化して reaper に引き取られた
// プロセスを、同じ PID の「同じプロセス」と誤認しないための鍵として使う。
// parentByPid（親 PID 索引）はどこからも参照されなくなったため持たない（安藤の指摘・LOW-C）。
function parseProcessTable(output) {
  const childrenByParent = new Map();
  const livePids = new Set();
  const startedAtByPid = new Map();
  for (const line of String(output).split('\n')) {
    // lstart は曜日・月・日・時刻・年を含む文字列（例: "Wed Sep 10 18:20:00 2026"）で、
    // 内部に空白を含むため末尾までまとめて 1 グループとして捉える。呼び出し側（main.js）が
    // LC_ALL=C を指定して ps を起動するため、この書式で安定する（ロケール依存で崩れない）。
    const match = line.trim().match(/^(\d+)\s+(\d+)\s+(.+)$/);
    if (!match) continue;
    const pid = Number(match[1]);
    const parentPid = Number(match[2]);
    const startedAt = match[3];
    livePids.add(pid);
    startedAtByPid.set(pid, startedAt);
    const children = childrenByParent.get(parentPid) || [];
    children.push(pid);
    childrenByParent.set(parentPid, children);
  }
  return { childrenByParent, livePids, startedAtByPid };
}

// isSameProcessStart のパース失敗を知らせる警告は、プロセス毎に一度だけ出す
// （ps の書式が想定外の環境では毎回のポーリングで呼ばれうるため、毎回出すとログが
// 溢れる。安藤の指摘・LOW-3）。この警告が一度も出ない環境では lstart 比較が正しく
// 機能していることの目安にもなる。
let hasWarnedAboutUnparsableLstart = false;

/**
 * 2つの lstart 生値（ps の "pid=,ppid=,lstart=" 出力に含まれる起動時刻文字列）が
 * 「同一プロセス」とみなせるかどうかを判定する。単純な文字列の厳密一致ではなく、
 * Date.parse した時刻の差が toleranceMs 以内かどうかで比較する（安藤の指摘・MEDIUM-A。
 * Linux の procps は呼び出しのたびに lstart を計算し直すため、システム時刻の補正の
 * 影響でわずかにずれることがある。冒頭の DEFAULT_LSTART_TOLERANCE_MS のコメント参照）。
 *
 * どちらか一方でもパースできない場合は fail-closed（＝「別プロセスだと断定できない」
 * として true を返す）。呼び出し側（stopAgentChildren）はこの結果を「まだ追跡を続ける
 * （kill 対象に残す）」判定に使うため、パース不能を理由に誤って追跡から外さないように
 * するための安全側の既定。fail-closed に倒れると起動時刻による同一性判定が実質的に
 * 無効化される（常に「同一」扱いになる）ため、想定外の ps 書式に気づけるよう、
 * 最初の1回だけ console.warn する（安藤の指摘・LOW-3）。
 *
 * @param {string} rawA
 * @param {string} rawB
 * @param {number} toleranceMs
 * @returns {boolean}
 */
function isSameProcessStart(rawA, rawB, toleranceMs) {
  const msA = Date.parse(rawA);
  const msB = Date.parse(rawB);
  if (!Number.isFinite(msA) || !Number.isFinite(msB)) {
    if (!hasWarnedAboutUnparsableLstart) {
      hasWarnedAboutUnparsableLstart = true;
      console.warn(
        `[restartAgent] failed to parse process start time (lstart) for comparison: ${JSON.stringify(rawA)} / ${JSON.stringify(rawB)}. `
        + 'Falling back to fail-closed (treating as the same process); process-identity checks by start time are effectively disabled until the ps output format is fixed. '
        + '(this warning is shown once per process)'
      );
    }
    return true;
  }
  return Math.abs(msA - msB) <= toleranceMs;
}

function collectDescendantPids(rootPid, childrenByParent) {
  const root = Number(rootPid);
  const descendants = [];
  const pending = [...(childrenByParent.get(root) || [])];
  const seen = new Set([root]);
  while (pending.length > 0) {
    const pid = pending.pop();
    if (seen.has(pid)) continue;
    seen.add(pid);
    descendants.push(pid);
    pending.push(...(childrenByParent.get(pid) || []));
  }
  return descendants;
}

function stopSignalForElapsed(elapsedMs, termGraceMs = DEFAULT_TERM_GRACE_MS) {
  return elapsedMs < termGraceMs ? TERM_SIGNAL : KILL_SIGNAL;
}

/**
 * 値を POSIX シェルの単一引数としてクォートする。
 * この関数は POSIX のクォートだけを担う。PTY への write で制御文字を無害化する責任は
 * 呼び出し側の入力検証にある。
 */
function quoteShellArgument(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// 直列化の待機ループ（Map を読み直しながら先行処理を待つ while）は、呼び出し側の
// スコープに直接書くこと。ここに独立した async 関数として切り出すと、while を抜けて
// からこの関数の呼び出し元へ制御が戻るまでに 1 microtask 分の隙間ができ、その隙間で
// 複数の待機者が同時に「Map が空」と誤認して並走できてしまう（実際に発生することを
// 確認済み。詳細は main.js の /api/restart-agent ハンドラのコメントを参照）。
// そのため、この直列化ロジックはユーティリティ関数として export せず、呼び出し側
// （main.js）にインラインで持たせている。

// PTY のログインシェル自身は対象にせず、その配下に存在した全 PID の消滅を確認する。
// 親の終了で孤児化した子も見失わないよう、観測済み PID は完了まで追跡し続ける。
async function stopAgentChildren(shellPid, dependencies, options = {}) {
  if (dependencies.platform === 'win32') {
    throw new Error('restart-agent is not supported on Windows');
  }
  const rootPid = Number(shellPid);
  // 0 / 1 は広範なプロセスを対象にしうるため、PTY シェルの PID として受け付けない。
  if (!Number.isInteger(rootPid) || rootPid <= 1) {
    throw new Error(`invalid shell pid: ${shellPid}`);
  }
  const termGraceMs = options.termGraceMs ?? DEFAULT_TERM_GRACE_MS;
  const timeoutMs = options.timeoutMs ?? DEFAULT_STOP_TIMEOUT_MS;
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const lstartToleranceMs = options.lstartToleranceMs ?? DEFAULT_LSTART_TOLERANCE_MS;
  const now = dependencies.now || Date.now;
  const wait = dependencies.wait || delay;
  // PID の同一性は「PID + 起動時刻（lstart）」で判定する。親 PID の一致や固定 PID（1）への
  // 決め打ちには頼らない。reaper（孤児を引き取るプロセス）の PID は環境によって異なり
  // （例: Linux の `systemd --user` セッションでは 1 ではなくユーザーマネージャの PID になる）、
  // 親 PID だけを見ていると「孤児化して reaper に引き取られた既知の子」を「無関係な別プロセス」
  // と誤認して追跡から外してしまう。起動時刻が isSameProcessStart の許容幅内で一致していれば、
  // 親がどこへ変わっても同じプロセスとして追跡を続けてよい。
  const targets = new Map(); // pid -> 発見時の起動時刻（lstart）
  const operationStartedAt = now();

  while (true) {
    const { childrenByParent, livePids, startedAtByPid } = parseProcessTable(
      await dependencies.listProcesses()
    );
    for (const pid of collectDescendantPids(rootPid, childrenByParent)) {
      if (!targets.has(pid)) targets.set(pid, startedAtByPid.get(pid));
    }

    // シェルが見えない初回結果はプロセス表を信用せず、停止成功にはしない。
    // 追跡開始後に見えなくなった場合は、ペイン自体が終了したものとして失敗させる。
    if (!livePids.has(rootPid)) {
      if (targets.size === 0) throw new Error('failed to read process table');
      return false;
    }

    const remaining = [...targets.keys()].filter((pid) => (
      livePids.has(pid) && isSameProcessStart(startedAtByPid.get(pid), targets.get(pid), lstartToleranceMs)
    ));
    if (remaining.length === 0) return true;

    const elapsedMs = now() - operationStartedAt;
    if (elapsedMs >= timeoutMs) return false;
    const signal = stopSignalForElapsed(elapsedMs, termGraceMs);
    // 親子の停止順は保証せず、各ポーリングで残っている追跡対象へ同じ信号を送る。
    for (const pid of remaining) {
      try {
        dependencies.killProcess(pid, signal);
      } catch (error) {
        if (error?.code !== 'ESRCH') throw error;
      }
    }
    await wait(Math.min(pollIntervalMs, Math.max(0, timeoutMs - elapsedMs)));
  }
}

module.exports = {
  DEFAULT_TERM_GRACE_MS,
  DEFAULT_STOP_TIMEOUT_MS,
  DEFAULT_POLL_INTERVAL_MS,
  DEFAULT_LSTART_TOLERANCE_MS,
  createAgentGenerationStore,
  mergeAgentGenerations,
  validateRestartAgentRequest,
  parseProcessTable,
  collectDescendantPids,
  stopSignalForElapsed,
  isSameProcessStart,
  quoteShellArgument,
  stopAgentChildren,
};
