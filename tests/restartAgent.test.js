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

const validators = {
  isValidEngine: (value) => value === 'claude' || value === 'codex',
  isValidModelForEngine: (engine, value) => (
    (engine === 'claude' && value === 'sonnet') || (engine === 'codex' && value === 'gpt-5.6-sol')
  ),
  isValidCwd: (value) => value === '/valid dir',
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
    [{ termId: '1', expectedGeneration: 0, cwd: '/missing' }, 'invalid cwd'],
  ];
  for (const [input, error] of cases) {
    assert.deepEqual(validateRestartAgentRequest(input, validators), { ok: false, error });
  }
});

test('プロセス表: PTY シェル配下の全子孫だけを列挙する', () => {
  const table = parseProcessTable('  10     1\n  20    10\n  30    20\n  40     1\ninvalid\n');
  assert.deepEqual(new Set(collectDescendantPids(10, table)), new Set([20, 30]));
  assert.equal(collectDescendantPids(10, table).includes(10), false);
  assert.equal(collectDescendantPids(10, table).includes(40), false);
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
