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
function validateRestartAgentRequest(value, validators) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, error: 'termId required' };
  }
  if (value.termId === undefined || value.termId === null || String(value.termId) === '') {
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
  if (value.cwd !== undefined && !validators.isValidCwd(value.cwd)) {
    return { ok: false, error: 'invalid cwd' };
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

// ps の pid/ppid 一覧を、親 PID から直接の子 PID を引ける Map に変換する。
function parseProcessTable(output) {
  const childrenByParent = new Map();
  for (const line of String(output).split('\n')) {
    const match = line.trim().match(/^(\d+)\s+(\d+)$/);
    if (!match) continue;
    const pid = Number(match[1]);
    const parentPid = Number(match[2]);
    const children = childrenByParent.get(parentPid) || [];
    children.push(pid);
    childrenByParent.set(parentPid, children);
  }
  return childrenByParent;
}

function collectDescendantPids(rootPid, childrenByParent) {
  const descendants = [];
  const pending = [...(childrenByParent.get(Number(rootPid)) || [])];
  const seen = new Set();
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

// POSIX シェルの単一引数として安全に渡せるよう、シングルクォートを閉じて再開する。
function quoteShellArgument(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// PTY のログインシェル自身は対象にせず、その配下に存在した全 PID の消滅を確認する。
// 親の終了で孤児化した子も見失わないよう、観測済み PID は完了まで追跡し続ける。
async function stopAgentChildren(shellPid, dependencies, options = {}) {
  if (dependencies.platform === 'win32') {
    throw new Error('restart-agent is not supported on Windows');
  }
  const termGraceMs = options.termGraceMs ?? DEFAULT_TERM_GRACE_MS;
  const timeoutMs = options.timeoutMs ?? DEFAULT_STOP_TIMEOUT_MS;
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const now = dependencies.now || Date.now;
  const wait = dependencies.wait || delay;
  const targets = new Set();
  const startedAt = now();

  while (true) {
    const processTable = parseProcessTable(await dependencies.listProcesses());
    for (const pid of collectDescendantPids(shellPid, processTable)) targets.add(pid);

    const livePids = new Set();
    for (const pids of processTable.values()) {
      for (const pid of pids) livePids.add(pid);
    }
    const remaining = [...targets].filter((pid) => livePids.has(pid));
    if (remaining.length === 0) return true;

    const elapsedMs = now() - startedAt;
    if (elapsedMs >= timeoutMs) return false;
    const signal = stopSignalForElapsed(elapsedMs, termGraceMs);
    // 子から先に止めると、親が終了処理中に新しい孫を作る時間を減らせる。
    for (const pid of remaining.reverse()) {
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
