'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createAgentGenerationStore,
  mergeAgentGenerations,
  validateRestartAgentRequest,
  parseProcessTable,
  collectDescendantPids,
  stopSignalForElapsed,
  quoteShellArgument,
  stopAgentChildren,
} = require('../utils/restartAgent');

// cwd の実在確認（fs.promises.stat）は非同期のため、validateRestartAgentRequest の
// 検証対象ではない（main.js 側で await して別途確認する）。ここでは engine / model の
// 検証だけを注入する。
const validators = {
  isValidEngine: (value) => value === 'claude' || value === 'codex',
  isValidModelForEngine: (engine, value) => (
    (engine === 'claude' && value === 'sonnet') || (engine === 'codex' && value === 'gpt-5.6-sol')
  ),
};

test('世代番号: AI 起動ペインは 1、素のシェルは 0 で始まり、成功時だけ増やせる', () => {
  const store = createAgentGenerationStore();
  store.initialize('1', true);
  store.initialize('2', false);
  assert.equal(store.get('1'), 1);
  assert.equal(store.get('2'), 0);
  assert.equal(store.increment('1'), 2);
  assert.equal(store.get('1'), 2);
  store.delete('1');
  assert.equal(store.get('1'), 0);
});

test('状態マージ: renderer のキーと値を維持し、termId に対応する世代番号だけ追加する', () => {
  const states = {
    'pane-1': { termId: '1', status: 'running' },
    'pane-2': { termId: '2', status: 'idle', agentGeneration: 99 },
  };
  assert.deepEqual(mergeAgentGenerations(states, (termId) => Number(termId) + 10), {
    'pane-1': { termId: '1', status: 'running', agentGeneration: 11 },
    'pane-2': { termId: '2', status: 'idle', agentGeneration: 12 },
  });
  assert.equal(states['pane-1'].agentGeneration, undefined);
});

test('restart-agent 検証: 必須値を正規化し、engine 省略時は claude にする', () => {
  assert.deepEqual(validateRestartAgentRequest({ termId: 1, expectedGeneration: 0 }, validators), {
    ok: true,
    termId: '1',
    expectedGeneration: 0,
    cwd: undefined,
    engine: 'claude',
    model: undefined,
  });
  assert.deepEqual(validateRestartAgentRequest({
    termId: '2', expectedGeneration: 3, cwd: '/valid dir', engine: 'codex', model: 'gpt-5.6-sol',
  }, validators), {
    ok: true,
    termId: '2',
    expectedGeneration: 3,
    cwd: '/valid dir',
    engine: 'codex',
    model: 'gpt-5.6-sol',
  });
});

test('restart-agent 検証: 不正値をペイン操作前に拒否する', () => {
  const cases = [
    [{ expectedGeneration: 0 }, 'termId required'],
    [{ termId: '1' }, 'expectedGeneration required'],
    [{ termId: '1', expectedGeneration: -1 }, 'expectedGeneration required'],
    [{ termId: '1', expectedGeneration: 1.5 }, 'expectedGeneration required'],
    [{ termId: '1', expectedGeneration: Number.MAX_SAFE_INTEGER + 1 }, 'expectedGeneration required'],
    [{ termId: '1', expectedGeneration: 0, engine: 'gemini' }, 'invalid engine'],
    [{ termId: '1', expectedGeneration: 0, model: 'opus; whoami' }, 'invalid model'],
    [{ termId: '1', expectedGeneration: 0, cwd: '' }, 'invalid cwd'],
    [{ termId: '1', expectedGeneration: 0, cwd: '/tmp/a\rb' }, 'invalid cwd'],
    [{ termId: '1', expectedGeneration: 0, cwd: '/tmp/a\x15b' }, 'invalid cwd'],
    [{ termId: [1], expectedGeneration: 0 }, 'termId required'],
    [{ termId: {}, expectedGeneration: 0 }, 'termId required'],
  ];
  for (const [input, error] of cases) {
    assert.deepEqual(validateRestartAgentRequest(input, validators), { ok: false, error });
  }
});

test('プロセス表: PTY シェル配下の全子孫だけを列挙する', () => {
  const { childrenByParent } = parseProcessTable('  10     1\n  20    10\n  30    20\n  40     1\ninvalid\n');
  assert.deepEqual(new Set(collectDescendantPids(10, childrenByParent)), new Set([20, 30]));
  assert.equal(collectDescendantPids(10, childrenByParent).includes(10), false);
  assert.equal(collectDescendantPids(10, childrenByParent).includes(40), false);
});

test('停止段階: 猶予内は SIGTERM、猶予後は SIGKILL', () => {
  assert.equal(stopSignalForElapsed(1499, 1500), 'SIGTERM');
  assert.equal(stopSignalForElapsed(1500, 1500), 'SIGKILL');
});

test('cwd のシェル引数化: 空白・シングルクォート・改行をコマンドとして解釈させない', () => {
  assert.equal(quoteShellArgument('/tmp/a b'), "'/tmp/a b'");
  assert.equal(quoteShellArgument("/tmp/a'b"), "'/tmp/a'\\''b'");
  assert.equal(quoteShellArgument('/tmp/a\nwhoami'), "'/tmp/a\nwhoami'");
});

test('子プロセス停止: SIGTERM 後に残る PID を SIGKILL へ上げ、消滅確認後に成功する', async () => {
  let clock = 0;
  let reads = 0;
  const signals = [];
  const processTables = [
    '10 1\n20 10\n30 20\n',
    '10 1\n20 10\n30 20\n',
    '10 1\n20 10\n30 20\n',
    '10 1\n',
  ];
  const stopped = await stopAgentChildren(10, {
    platform: 'darwin',
    now: () => clock,
    wait: async (ms) => { clock += ms; },
    listProcesses: async () => processTables[Math.min(reads++, processTables.length - 1)],
    killProcess: (pid, signal) => signals.push([pid, signal]),
  }, { termGraceMs: 100, timeoutMs: 300, pollIntervalMs: 50 });

  assert.equal(stopped, true);
  assert.equal(signals.some(([, signal]) => signal === 'SIGTERM'), true);
  assert.equal(signals.some(([, signal]) => signal === 'SIGKILL'), true);
  assert.equal(signals.some(([pid]) => pid === 10), false);
});

test('子プロセス停止: 全体タイムアウトでは false を返し、Windows は明示的に失敗する', async () => {
  let clock = 0;
  const stopped = await stopAgentChildren(10, {
    platform: 'linux',
    now: () => clock,
    wait: async (ms) => { clock += ms; },
    listProcesses: async () => '10 1\n20 10\n',
    killProcess: () => {},
  }, { termGraceMs: 10, timeoutMs: 20, pollIntervalMs: 10 });
  assert.equal(stopped, false);

  await assert.rejects(() => stopAgentChildren(10, {
    platform: 'win32',
    listProcesses: async () => '',
    killProcess: () => {},
  }), /not supported on Windows/);
});

test('子プロセス停止: shellPid が 0 / 非整数のときは fail-closed で throw する', async () => {
  const dependencies = {
    platform: 'darwin',
    listProcesses: async () => '10 1\n',
    killProcess: () => {},
  };
  await assert.rejects(() => stopAgentChildren(0, dependencies), /invalid shell pid/);
  await assert.rejects(() => stopAgentChildren(1, dependencies), /invalid shell pid/);
  await assert.rejects(() => stopAgentChildren(1.5, dependencies), /invalid shell pid/);
  await assert.rejects(() => stopAgentChildren('not-a-pid', dependencies), /invalid shell pid/);
});

test('子プロセス停止: ps が空／書式違いの出力しか返さないときは true を返さない（fail-closed）', async () => {
  const emptyOutput = stopAgentChildren(10, {
    platform: 'darwin',
    listProcesses: async () => '',
    killProcess: () => {},
  });
  await assert.rejects(() => emptyOutput, /failed to read process table/);

  const malformedOutput = stopAgentChildren(10, {
    platform: 'darwin',
    // pid/ppid の書式（数字 2 つ）に一致しない行しかない状態を模す。
    listProcesses: async () => 'not-a-pid-line\nanother garbage line\n',
    killProcess: () => {},
  });
  await assert.rejects(() => malformedOutput, /failed to read process table/);
});

test('プロセス表: 循環する親子関係を与えても root（シェル自身）は子孫に含まれない', () => {
  // 20 の「子」として誤って root(10) が記録されている壊れたプロセス表を模す。
  const table = parseProcessTable('10 1\n20 10\n30 20\n');
  table.childrenByParent.set(20, [...(table.childrenByParent.get(20) || []), 10]);
  const descendants = collectDescendantPids(10, table.childrenByParent);
  assert.equal(descendants.includes(10), false);
  assert.deepEqual(new Set(descendants), new Set([20, 30]));
});

test('子プロセス停止: PID 再利用（発見時と親 PID が変わった PID）は kill 対象から外れる', async () => {
  let reads = 0;
  let clock = 0;
  const signals = [];
  // 1 回目: pid 20 は shell(10) の子として発見され、その場で SIGTERM が送られる。
  // 2 回目以降: pid 20 は無関係な親(999)の子として存在し続ける（= 別プロセスに再利用された）。
  // 時計は猶予を超えて進めるが、再利用後の pid 20 は SIGKILL まで送られてはいけない。
  const processTables = [
    '10 1\n20 10\n',
    '10 1\n20 999\n999 1\n',
    '10 1\n20 999\n999 1\n',
  ];
  const stopped = await stopAgentChildren(10, {
    platform: 'darwin',
    now: () => clock,
    wait: async (ms) => { clock += ms; },
    listProcesses: async () => processTables[Math.min(reads++, processTables.length - 1)],
    killProcess: (pid, signal) => signals.push([pid, signal]),
  }, { termGraceMs: 50, timeoutMs: 300, pollIntervalMs: 100 });

  assert.equal(stopped, true);
  const signalsToPid20 = signals.filter(([pid]) => pid === 20);
  assert.equal(signalsToPid20.length, 1);
  assert.equal(signalsToPid20[0][1], 'SIGTERM');
});

test('直列化: 同一 termId への3件以上の並行要求は先行処理の完了を待ち、後発が先発の起動を止めない', async () => {
  // main.js の /api/restart-agent ハンドラと同じ形（呼び出し側スコープに直接書いた while
  // ループ）を再現する。while ループを別の async 関数へ切り出すと、ループを抜けてから
  // 呼び出し元へ制御が戻るまでに 1 microtask 分の隙間ができ、3件以上が同じ先行処理を
  // 待っている場合にその隙間で複数の待機者が同時に「Map が空」と誤認して並走できてしまう
  // （切り出し版では 20/20 試行で再現することを別途確認済み）。このテストはインライン版が
  // その隙間を作らないことを検証する。
  const operations = new Map();
  const timeline = [];

  async function simulateRequest(id) {
    let previousOperation;
    while ((previousOperation = operations.get('term-1'))) {
      try { await previousOperation; } catch (_error) {}
    }
    // while を抜けてから Map への登録までは await を挟まない（本番コードと同じ不可分区間）。
    if (timeline.some((entry) => entry.active)) {
      throw new Error(`${id} started while another request for the same termId was still active`);
    }
    const entry = { id, active: true };
    timeline.push(entry);
    const operation = (async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      return id;
    })();
    operations.set('term-1', operation);
    try {
      await operation;
    } finally {
      entry.active = false;
      if (operations.get('term-1') === operation) operations.delete('term-1');
    }
  }

  // 実際の HTTP サーバでは、別々の接続の readJsonBody コールバックが別々の I/O イベントとして
  // 起動される（Node は各コールバックの後にマイクロタスクを掃き出してから次の I/O を処理する）。
  // Promise.all で3件を同一の同期区間から起動すると、この分離が再現できないため、
  // setImmediate で開始タイミングを分ける。
  function scheduleRequest(id) {
    return new Promise((resolve, reject) => {
      setImmediate(() => {
        simulateRequest(id).then(resolve, reject);
      });
    });
  }

  await Promise.all([scheduleRequest('a'), scheduleRequest('b'), scheduleRequest('c')]);
  assert.deepEqual(timeline.map((entry) => entry.id), ['a', 'b', 'c']);
});
