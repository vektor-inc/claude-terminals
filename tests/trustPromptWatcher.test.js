'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  getReadyPatternForEngine,
  attachTrustAutoResponder,
} = require('../utils/trustPromptWatcher');
const {
  CLAUDE_CURRENT_TRUST_PROMPT,
  CODEX_CURRENT_TRUST_PROMPT,
} = require('./fixtures/trustPrompts');

// node-pty の IPty#onData（utils/eventEmitter2.js ベース）を模した最小限のフェイク。
// 複数回の onData 登録をサポートする（実装が multi-listener 前提であることの検証も兼ねる）。
// emit(data) で pty からの出力を模擬し、登録済みリスナーすべてへ配る。
function createFakePty() {
  const listeners = [];
  const writes = [];
  return {
    pid: 12345,
    onData(listener) {
      listeners.push(listener);
      return {
        dispose() {
          const idx = listeners.indexOf(listener);
          if (idx !== -1) listeners.splice(idx, 1);
        },
      };
    },
    emit(data) {
      // fire 中に登録内容が変わっても安全なようにコピーへ反復する
      // （node-pty の EventEmitter2.fire と同じ考え方）。
      for (const listener of listeners.slice()) listener(data);
    },
    write(data) {
      writes.push(data);
    },
    get writes() {
      return writes;
    },
    get listenerCount() {
      return listeners.length;
    },
  };
}

// テストから実時間を待たずに制御できるよう、呼び出しごとに明示的に進める疑似時計。
function createFakeClock(start = 0) {
  let current = start;
  return {
    now: () => current,
    advance(ms) {
      current += ms;
      return current;
    },
  };
}

// ─── getReadyPatternForEngine: main.js から移設した選択ロジック ────────────────────

test('getReadyPatternForEngine: claude は起動完了バナー文言に一致する', () => {
  const pattern = getReadyPatternForEngine('claude');
  assert.equal(pattern.test('Welcome to Claude'), true);
  assert.equal(pattern.test('? for shortcuts'), true);
  assert.equal(pattern.test('OpenAI Codex'), false);
});

test('getReadyPatternForEngine: codex は起動完了バナー文言に一致する', () => {
  const pattern = getReadyPatternForEngine('codex');
  assert.equal(pattern.test('OpenAI Codex'), true);
  assert.equal(pattern.test('Welcome to Claude'), false);
});

test('getReadyPatternForEngine: 未登録の engine は claude 用（安全側の既定）へ倒れる', () => {
  const pattern = getReadyPatternForEngine('unknown-engine');
  assert.equal(pattern.test('Welcome to Claude'), true);
});

// ─── attachTrustAutoResponder: 再起動経路の信頼確認プロンプト自動応答（issue #392）────

test('再起動経路: 時間窓の内側で信頼確認プロンプトが出たら Enter を1回だけ書き込む', () => {
  const pty = createFakePty();
  const clock = createFakeClock(0);

  attachTrustAutoResponder(pty, {
    spawnTime: 0,
    engine: 'claude',
    trustWindowMs: 30000,
    readyGraceMs: 3000,
    now: clock.now,
  });

  clock.advance(1000);
  pty.emit(CLAUDE_CURRENT_TRUST_PROMPT);

  assert.deepEqual(pty.writes, ['\r']);

  // 同じプロンプト文言がバッファに残ったまま追加データが来ても、二重送信しない
  // （trustGate.markTrustHandled により以後 canAutoRespond が false になる）。
  pty.emit('additional output after trust confirmation');
  assert.deepEqual(pty.writes, ['\r']);
});

test('再起動経路: codex の信頼確認プロンプトにも Enter を送る', () => {
  const pty = createFakePty();
  const clock = createFakeClock(0);

  attachTrustAutoResponder(pty, {
    spawnTime: 0,
    engine: 'codex',
    now: clock.now,
  });

  clock.advance(500);
  pty.emit(CODEX_CURRENT_TRUST_PROMPT);

  assert.deepEqual(pty.writes, ['\r']);
});

test('再起動経路: 再起動時刻からの時間窓（trustWindowMs）を過ぎたら自動応答しない', () => {
  const pty = createFakePty();
  const clock = createFakeClock(0);

  attachTrustAutoResponder(pty, {
    spawnTime: 0,
    engine: 'claude',
    trustWindowMs: 30000,
    readyGraceMs: 3000,
    now: clock.now,
  });

  // 時間窓（30秒）を過ぎてから信頼確認プロンプトが出た場合は送らない。
  clock.advance(30001);
  pty.emit(CLAUDE_CURRENT_TRUST_PROMPT);

  assert.deepEqual(pty.writes, []);
});

test('再起動経路: ready 検知から readyGraceMs を過ぎたら、時間窓の内側でも自動応答しない', () => {
  const pty = createFakePty();
  const clock = createFakeClock(0);

  attachTrustAutoResponder(pty, {
    spawnTime: 0,
    engine: 'claude',
    trustWindowMs: 30000,
    readyGraceMs: 3000,
    now: clock.now,
  });

  // 起動完了（ready）を検知させる。
  clock.advance(1000);
  pty.emit('Welcome to Claude');

  // ready 検知から readyGraceMs（3秒）を超えてから信頼確認の文脈が来ても、
  // trustWindowMs（30秒）の内側ではあるが送らない。
  clock.advance(3001);
  pty.emit(CLAUDE_CURRENT_TRUST_PROMPT);

  assert.deepEqual(pty.writes, []);
});

test('再起動経路: 再起動した時刻を起点にする（ペイン作成時刻がとっくに過ぎていても効く）', () => {
  const pty = createFakePty();
  const clock = createFakeClock(0);

  // ペイン作成から30分後に再起動した想定。restartSpawnTime は main.js が
  // performance.now() を都度渡す前提のため、ここでは大きな値をそのまま起点にする。
  const paneCreatedAt = 0;
  const restartedAt = paneCreatedAt + 30 * 60 * 1000;
  clock.advance(restartedAt);

  attachTrustAutoResponder(pty, {
    spawnTime: restartedAt,
    engine: 'claude',
    trustWindowMs: 30000,
    readyGraceMs: 3000,
    now: clock.now,
  });

  // 再起動から1秒後（ペイン作成からは30分と1秒後）でも、再起動を起点とした
  // 時間窓の内側なので自動応答される。
  clock.advance(1000);
  pty.emit(CLAUDE_CURRENT_TRUST_PROMPT);

  assert.deepEqual(pty.writes, ['\r']);
});

test('再起動経路: isAlive が false を返す場合は書き込まない（pty 入れ替わり後の保険）', () => {
  const pty = createFakePty();
  const clock = createFakeClock(0);

  attachTrustAutoResponder(pty, {
    spawnTime: 0,
    engine: 'claude',
    now: clock.now,
    isAlive: () => false,
  });

  clock.advance(100);
  pty.emit(CLAUDE_CURRENT_TRUST_PROMPT);

  assert.deepEqual(pty.writes, []);
});

test('再起動経路: 時間窓が閉じたら onData の登録を解除し、監視を終了する', () => {
  const pty = createFakePty();
  const clock = createFakeClock(0);

  attachTrustAutoResponder(pty, {
    spawnTime: 0,
    engine: 'claude',
    trustWindowMs: 30000,
    readyGraceMs: 3000,
    now: clock.now,
  });

  assert.equal(pty.listenerCount, 1);

  // 時間窓を過ぎたデータを1回流すと、shouldStopWatching が true になり自分で解除する。
  clock.advance(30001);
  pty.emit('some unrelated output');

  assert.equal(pty.listenerCount, 0);
});

test('再起動経路: dispose() を呼ぶと即座に監視を止められる', () => {
  const pty = createFakePty();
  const clock = createFakeClock(0);

  const responder = attachTrustAutoResponder(pty, {
    spawnTime: 0,
    engine: 'claude',
    now: clock.now,
  });

  responder.dispose();
  assert.equal(pty.listenerCount, 0);

  // 解除後に信頼確認プロンプトが来ても反応しない。
  pty.emit(CLAUDE_CURRENT_TRUST_PROMPT);
  assert.deepEqual(pty.writes, []);

  // dispose は冪等（2回目を呼んでも例外にならない）。
  assert.doesNotThrow(() => responder.dispose());
});

test('ペイン作成経路: terminal:create と同じ node-pty の onData は多重登録でき、互いに独立する', () => {
  // main.js の terminal:create は renderer 転送用の onData を既に1つ登録している前提。
  // restart-agent 側の attachTrustAutoResponder がその上に自分専用の onData を
  // 追加登録しても、既存のリスナー（ここでは rendererForward）には影響しないことを確認する。
  const pty = createFakePty();
  const clock = createFakeClock(0);
  const rendererForward = [];
  pty.onData((data) => rendererForward.push(data));

  attachTrustAutoResponder(pty, { spawnTime: 0, engine: 'claude', now: clock.now });

  assert.equal(pty.listenerCount, 2);
  pty.emit('hello');
  assert.deepEqual(rendererForward, ['hello']);
});
