'use strict';

const TERM_SIGNAL = 'SIGTERM';
const KILL_SIGNAL = 'SIGKILL';
const DEFAULT_TERM_GRACE_MS = 1500;
const DEFAULT_STOP_TIMEOUT_MS = 5000;
const DEFAULT_POLL_INTERVAL_MS = 100;

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

// ps の pid/ppid 一覧を、子孫探索・親の再照合・生存確認に使う索引へ変換する。
function parseProcessTable(output) {
  const childrenByParent = new Map();
  const parentByPid = new Map();
  const livePids = new Set();
  for (const line of String(output).split('\n')) {
    const match = line.trim().match(/^(\d+)\s+(\d+)$/);
    if (!match) continue;
    const pid = Number(match[1]);
    const parentPid = Number(match[2]);
    livePids.add(pid);
    parentByPid.set(pid, parentPid);
    const children = childrenByParent.get(parentPid) || [];
    children.push(pid);
    childrenByParent.set(parentPid, children);
  }
  return { childrenByParent, parentByPid, livePids };
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
  const now = dependencies.now || Date.now;
  const wait = dependencies.wait || delay;
  // PID 再利用を見分けられるよう、初回発見時の親 PID も保持する。
  const targets = new Map();
  const startedAt = now();

  while (true) {
    const { childrenByParent, parentByPid, livePids } = parseProcessTable(
      await dependencies.listProcesses()
    );
    for (const pid of collectDescendantPids(rootPid, childrenByParent)) {
      if (!targets.has(pid)) targets.set(pid, parentByPid.get(pid));
    }

    // シェルが見えない初回結果はプロセス表を信用せず、停止成功にはしない。
    // 追跡開始後に見えなくなった場合は、ペイン自体が終了したものとして失敗させる。
    if (!livePids.has(rootPid)) {
      if (targets.size === 0) throw new Error('failed to read process table');
      return false;
    }

    const remaining = [...targets.keys()].filter((pid) => {
      if (!livePids.has(pid)) return false;
      const currentParent = parentByPid.get(pid);
      return currentParent === targets.get(pid) || targets.has(currentParent) || currentParent === 1;
    });
    if (remaining.length === 0) return true;

    const elapsedMs = now() - startedAt;
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
  createAgentGenerationStore,
  mergeAgentGenerations,
  validateRestartAgentRequest,
  parseProcessTable,
  collectDescendantPids,
  stopSignalForElapsed,
  quoteShellArgument,
  stopAgentChildren,
};
