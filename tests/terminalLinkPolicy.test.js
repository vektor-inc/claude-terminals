'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  isMacPlatform,
  isLinkOpenModifierPressed,
  normalizeTerminalLinkClickMode,
  isDragDistance,
  createTerminalLinkHandlers,
} = require('../utils/terminalLinkPolicy');

// createTerminalLinkHandlers() は必須級の deps（wasPaneFocused / wasDragged）が
// 欠けていると console.warn を出す（レビュー指摘・LOW-C）。多くのテストが意図的に
// これらを省略するため、各テストで console.warn を退避・復元して出力を汚さない。
function withSilencedWarn(fn) {
  const original = console.warn;
  console.warn = () => {};
  try {
    return fn();
  } finally {
    console.warn = original;
  }
}

// 各テストで使う既定の event を作るヘルパー。button 省略時は「左クリック相当」
// （実際の左クリックイベントは button === 0 だが、activate() は button が number 型で
// ないときは弾かないため、テストでは省略して「主ボタン扱い」を表現する）。
function makeEvent(overrides = {}) {
  return {
    metaKey: false,
    ctrlKey: false,
    preventDefault() { this.prevented = true; },
    ...overrides,
  };
}

test('isMacPlatform: platform 文字列から macOS 系かどうかを判定する', () => {
  assert.equal(isMacPlatform('MacIntel'), true);
  assert.equal(isMacPlatform('iPhone'), true);
  assert.equal(isMacPlatform('Win32'), false);
  assert.equal(isMacPlatform('Linux x86_64'), false);
  assert.equal(isMacPlatform(''), false);
});

test('isLinkOpenModifierPressed: macOS は metaKey、Windows/Linux は ctrlKey だけを見る', () => {
  assert.equal(isLinkOpenModifierPressed({ metaKey: true, ctrlKey: false }, true), true);
  assert.equal(isLinkOpenModifierPressed({ metaKey: false, ctrlKey: true }, true), false);
  assert.equal(isLinkOpenModifierPressed({ metaKey: false, ctrlKey: true }, false), true);
  assert.equal(isLinkOpenModifierPressed({ metaKey: true, ctrlKey: false }, false), false);
});

test('isLinkOpenModifierPressed: 修飾キーが無いイベントでは false', () => {
  assert.equal(isLinkOpenModifierPressed({ metaKey: false, ctrlKey: false }, true), false);
  assert.equal(isLinkOpenModifierPressed({ metaKey: false, ctrlKey: false }, false), false);
  assert.equal(isLinkOpenModifierPressed(null, true), false);
  assert.equal(isLinkOpenModifierPressed(undefined, false), false);
});

test('normalizeTerminalLinkClickMode: 既知の値はそのまま通し、未知の値・未設定は既定 click に正規化する（issue #385）', () => {
  assert.equal(normalizeTerminalLinkClickMode('click'), 'click');
  assert.equal(normalizeTerminalLinkClickMode('modifier'), 'modifier');
  assert.equal(normalizeTerminalLinkClickMode('unknown-value'), 'click');
  assert.equal(normalizeTerminalLinkClickMode(undefined), 'click');
  assert.equal(normalizeTerminalLinkClickMode(null), 'click');
  assert.equal(normalizeTerminalLinkClickMode(''), 'click');
});

// ─── HIGH-1: 主ボタン以外（右クリック・中クリック）では開かない ──────────────────────
test('createTerminalLinkHandlers: click モードでも、右クリック（button: 2）では openUrl を呼ばない（レビュー指摘・HIGH-1）', () => {
  const calls = [];
  const handlers = createTerminalLinkHandlers({
    isMac: true,
    getClickMode: () => 'click',
    wasPaneFocused: () => true,
    wasDragged: () => false,
    openUrl: (url) => calls.push(url),
  });
  const event = makeEvent({ button: 2 });
  handlers.activate(event, 'https://example.com');
  assert.deepEqual(calls, []);
  assert.equal(event.prevented, undefined);
});

test('createTerminalLinkHandlers: click モードでも、中クリック（button: 1）では openUrl を呼ばない（Linux のプライマリ選択貼り付けと衝突するため・レビュー指摘・HIGH-1）', () => {
  const calls = [];
  const handlers = createTerminalLinkHandlers({
    isMac: true,
    getClickMode: () => 'click',
    wasPaneFocused: () => true,
    wasDragged: () => false,
    openUrl: (url) => calls.push(url),
  });
  const event = makeEvent({ button: 1 });
  handlers.activate(event, 'https://example.com');
  assert.deepEqual(calls, []);
});

test('createTerminalLinkHandlers: 左クリック（button: 0）は主ボタンとして扱う', () => {
  const calls = [];
  const handlers = createTerminalLinkHandlers({
    isMac: true,
    getClickMode: () => 'click',
    wasPaneFocused: () => true,
    wasDragged: () => false,
    openUrl: (url) => calls.push(url),
  });
  const event = makeEvent({ button: 0 });
  handlers.activate(event, 'https://example.com');
  assert.deepEqual(calls, ['https://example.com']);
  assert.equal(event.prevented, true);
});

// ─── HIGH-2: ドラッグ選択（同一リンク内をなぞる操作を含む）では開かない ────────────────
test('createTerminalLinkHandlers: wasDragged() が true のときは openUrl を呼ばない（URL をドラッグしてコピーしようとした操作・レビュー指摘・HIGH-2）', () => {
  const calls = [];
  const handlers = createTerminalLinkHandlers({
    isMac: true,
    getClickMode: () => 'click',
    wasPaneFocused: () => true,
    wasDragged: () => true,
    openUrl: (url) => calls.push(url),
  });
  const event = makeEvent();
  handlers.activate(event, 'https://example.com');
  assert.deepEqual(calls, []);
  assert.equal(event.prevented, undefined);
});

test('createTerminalLinkHandlers: modifier モードでも、ドラッグ選択では修飾キー付きでも openUrl を呼ばない（フォーカスガードと同様、両モード共通）', () => {
  const calls = [];
  const handlers = createTerminalLinkHandlers({
    isMac: true,
    getClickMode: () => 'modifier',
    wasPaneFocused: () => true,
    wasDragged: () => true,
    openUrl: (url) => calls.push(url),
  });
  const event = makeEvent({ metaKey: true });
  handlers.activate(event, 'https://example.com');
  assert.deepEqual(calls, []);
});

test('createTerminalLinkHandlers: wasDragged 未指定時はドラッグ扱いしない（false 相当）', () => {
  const calls = [];
  const handlers = withSilencedWarn(() => createTerminalLinkHandlers({
    isMac: true,
    getClickMode: () => 'click',
    wasPaneFocused: () => true,
    openUrl: (url) => calls.push(url),
  }));
  handlers.activate(makeEvent(), 'https://example.com');
  assert.deepEqual(calls, ['https://example.com']);
});

// ─── MEDIUM-A: ダブルクリック・トリプルクリック（event.detail > 1）では開かない ───────────
test('createTerminalLinkHandlers: ダブルクリック（event.detail: 2）では openUrl を呼ばない（単語選択と同じ操作・レビュー指摘・MEDIUM-A）', () => {
  const calls = [];
  const handlers = createTerminalLinkHandlers({
    isMac: true,
    getClickMode: () => 'click',
    wasPaneFocused: () => true,
    wasDragged: () => false,
    openUrl: (url) => calls.push(url),
  });
  const event = makeEvent({ detail: 2 });
  handlers.activate(event, 'https://example.com');
  assert.deepEqual(calls, []);
  assert.equal(event.prevented, undefined);
});

test('createTerminalLinkHandlers: トリプルクリック（event.detail: 3）では openUrl を呼ばない（行選択と同じ操作）', () => {
  const calls = [];
  const handlers = createTerminalLinkHandlers({
    isMac: true,
    getClickMode: () => 'click',
    wasPaneFocused: () => true,
    wasDragged: () => false,
    openUrl: (url) => calls.push(url),
  });
  handlers.activate(makeEvent({ detail: 3 }), 'https://example.com');
  assert.deepEqual(calls, []);
});

test('createTerminalLinkHandlers: 1回目のクリック（event.detail: 1）は開く。連続クリックのたびに何度も開くわけではないことの対比', () => {
  const calls = [];
  const handlers = createTerminalLinkHandlers({
    isMac: true,
    getClickMode: () => 'click',
    wasPaneFocused: () => true,
    wasDragged: () => false,
    openUrl: (url) => calls.push(url),
  });
  handlers.activate(makeEvent({ detail: 1 }), 'https://example.com');
  assert.deepEqual(calls, ['https://example.com']);
});

test('createTerminalLinkHandlers: event.detail 未指定（テストの makeEvent 既定）では開く（1回目クリック相当）', () => {
  const calls = [];
  const handlers = createTerminalLinkHandlers({
    isMac: true,
    getClickMode: () => 'click',
    wasPaneFocused: () => true,
    wasDragged: () => false,
    openUrl: (url) => calls.push(url),
  });
  handlers.activate(makeEvent(), 'https://example.com');
  assert.deepEqual(calls, ['https://example.com']);
});

// ─── フォーカスガード（issue #385） ──────────────────────────────────────────────
test('createTerminalLinkHandlers: click モード（既定）・フォーカス済みペインなら修飾キー無しでも openUrl を呼ぶ（issue #385）', () => {
  const calls = [];
  const handlers = createTerminalLinkHandlers({
    isMac: true,
    getClickMode: () => 'click',
    wasPaneFocused: () => true,
    wasDragged: () => false,
    openUrl: (url) => calls.push(url),
  });
  const event = makeEvent();
  handlers.activate(event, 'https://example.com');
  assert.deepEqual(calls, ['https://example.com']);
  assert.equal(event.prevented, true);
});

test('createTerminalLinkHandlers: click モードでも、フォーカスされていないペインへの最初のクリックでは openUrl を呼ばない（issue #385・最重要のフォーカスガード）', () => {
  const calls = [];
  const handlers = createTerminalLinkHandlers({
    isMac: true,
    getClickMode: () => 'click',
    wasPaneFocused: () => false,
    wasDragged: () => false,
    openUrl: (url) => calls.push(url),
  });
  const event = makeEvent();
  handlers.activate(event, 'https://example.com');
  assert.deepEqual(calls, []);
  // フォーカス移動だけに使うクリックのため、xterm 本来の挙動（フォーカス移譲・カーソル配置）を
  // 妨げないよう preventDefault は呼ばない（指示仕様）。
  assert.equal(event.prevented, undefined);
});

test('createTerminalLinkHandlers: wasPaneFocused 未指定時は fail-closed（false 相当）として扱う（レビュー指摘・MEDIUM-2）', () => {
  // wasPaneFocused はこの issue #385 で新設した依存で、世の中に「渡し忘れたら true 扱い」の
  // 旧挙動は存在しない。渡し忘れ・接続ミスは安全側（開かない）へ倒れることを確認する。
  const calls = [];
  const handlers = withSilencedWarn(() => createTerminalLinkHandlers({
    isMac: true,
    getClickMode: () => 'click',
    wasDragged: () => false,
    openUrl: (url) => calls.push(url),
  }));
  handlers.activate(makeEvent(), 'https://example.com');
  assert.deepEqual(calls, []);
});

test('createTerminalLinkHandlers: modifier モードでは従来どおり修飾キー無しのクリックでは openUrl を呼ばない（最重要のセキュリティ分岐）', () => {
  const calls = [];
  const handlers = createTerminalLinkHandlers({
    isMac: true,
    getClickMode: () => 'modifier',
    wasPaneFocused: () => true,
    wasDragged: () => false,
    openUrl: (url) => calls.push(url),
  });
  const event = makeEvent();
  handlers.activate(event, 'https://example.com');
  assert.deepEqual(calls, []);
  assert.equal(event.prevented, undefined);
});

test('createTerminalLinkHandlers: modifier モードで修飾キー付きクリックなら openUrl を 1 回だけ呼ぶ', () => {
  const calls = [];
  const handlers = createTerminalLinkHandlers({
    isMac: true,
    getClickMode: () => 'modifier',
    wasPaneFocused: () => true,
    wasDragged: () => false,
    openUrl: (url) => calls.push(url),
  });
  const event = makeEvent({ metaKey: true });
  handlers.activate(event, 'https://example.com');
  assert.deepEqual(calls, ['https://example.com']);
  assert.equal(event.prevented, true);
});

test('createTerminalLinkHandlers: modifier モードでは Windows/Linux では ctrlKey だけを見る（metaKey では開かない）', () => {
  const calls = [];
  const handlers = createTerminalLinkHandlers({
    isMac: false,
    getClickMode: () => 'modifier',
    wasPaneFocused: () => true,
    wasDragged: () => false,
    openUrl: (url) => calls.push(url),
  });
  handlers.activate(makeEvent({ metaKey: true }), 'https://example.com');
  assert.deepEqual(calls, []);
  handlers.activate(makeEvent({ ctrlKey: true }), 'https://example.com');
  assert.deepEqual(calls, ['https://example.com']);
});

test('createTerminalLinkHandlers: modifier モードでも、フォーカスされていないペインへの最初のクリックは修飾キー付きでも openUrl を呼ばない（フォーカスガードは両モード共通）', () => {
  const calls = [];
  const handlers = createTerminalLinkHandlers({
    isMac: true,
    getClickMode: () => 'modifier',
    wasPaneFocused: () => false,
    wasDragged: () => false,
    openUrl: (url) => calls.push(url),
  });
  const event = makeEvent({ metaKey: true });
  handlers.activate(event, 'https://example.com');
  assert.deepEqual(calls, []);
  assert.equal(event.prevented, undefined);
});

test('createTerminalLinkHandlers: 未知の getClickMode() 戻り値は click として扱う（正規化のフォールバック）', () => {
  const calls = [];
  const handlers = createTerminalLinkHandlers({
    isMac: true,
    getClickMode: () => 'nonsense',
    wasPaneFocused: () => true,
    wasDragged: () => false,
    openUrl: (url) => calls.push(url),
  });
  handlers.activate(makeEvent(), 'https://example.com');
  assert.deepEqual(calls, ['https://example.com']);
});

test('createTerminalLinkHandlers: getClickMode 未指定時は click（既定）として扱う', () => {
  const calls = [];
  const handlers = createTerminalLinkHandlers({
    isMac: true,
    wasPaneFocused: () => true,
    wasDragged: () => false,
    openUrl: (url) => calls.push(url),
  });
  handlers.activate(makeEvent(), 'https://example.com');
  assert.deepEqual(calls, ['https://example.com']);
});

test('createTerminalLinkHandlers: hover/leave はツールチップの表示・非表示へ橋渡しするだけ', () => {
  const shown = [];
  const hidden = [];
  const handlers = withSilencedWarn(() => createTerminalLinkHandlers({
    isMac: true,
    openUrl: () => {},
    showTooltip: (event, url) => shown.push(url),
    hideTooltip: (event, url) => hidden.push(url),
  }));
  handlers.hover({}, 'https://example.com');
  handlers.leave({}, 'https://example.com');
  assert.deepEqual(shown, ['https://example.com']);
  assert.deepEqual(hidden, ['https://example.com']);
});

test('createTerminalLinkHandlers: deps 未指定でも例外を投げない（no-op フォールバック。fail-closed のため openUrl は呼ばれない）', () => {
  const handlers = withSilencedWarn(() => createTerminalLinkHandlers());
  assert.doesNotThrow(() => {
    handlers.activate(makeEvent({ metaKey: true, ctrlKey: true }), 'https://example.com');
    handlers.hover({}, 'https://example.com');
    handlers.leave({}, 'https://example.com');
  });
});

// ─── LOW-C: 必須級 deps の渡し忘れを console.warn で知らせる ───────────────────────────
test('createTerminalLinkHandlers: wasPaneFocused / wasDragged が無いと console.warn を出す（レビュー指摘・LOW-C）', () => {
  const warnings = [];
  const original = console.warn;
  console.warn = (msg) => warnings.push(msg);
  try {
    createTerminalLinkHandlers({ isMac: true, openUrl: () => {} });
  } finally {
    console.warn = original;
  }
  assert.equal(warnings.length, 2);
  assert.ok(warnings.some((m) => /wasPaneFocused/.test(m)));
  assert.ok(warnings.some((m) => /wasDragged/.test(m)));
});

test('createTerminalLinkHandlers: wasPaneFocused / wasDragged を両方渡していれば console.warn を出さない', () => {
  const warnings = [];
  const original = console.warn;
  console.warn = (msg) => warnings.push(msg);
  try {
    createTerminalLinkHandlers({
      isMac: true,
      openUrl: () => {},
      wasPaneFocused: () => true,
      wasDragged: () => false,
    });
  } finally {
    console.warn = original;
  }
  assert.deepEqual(warnings, []);
});

// ─── isDragDistance: ドラッグ距離判定の純粋関数（レビュー指摘・MEDIUM-B） ───────────────
test('isDragDistance: しきい値を超える移動はドラッグと判定する', () => {
  assert.equal(isDragDistance({ x: 0, y: 0 }, { x: 10, y: 0 }, 4), true);
  assert.equal(isDragDistance({ x: 0, y: 0 }, { x: 0, y: 10 }, 4), true);
  // 3-4-5 の直角三角形（斜辺 5）でしきい値 4 を超える。
  assert.equal(isDragDistance({ x: 0, y: 0 }, { x: 3, y: 4 }, 4), true);
});

test('isDragDistance: しきい値以下の移動はドラッグと判定しない', () => {
  assert.equal(isDragDistance({ x: 0, y: 0 }, { x: 0, y: 0 }, 4), false);
  assert.equal(isDragDistance({ x: 0, y: 0 }, { x: 2, y: 0 }, 4), false);
  // ちょうどしきい値と同じ距離は「超える」の対象外（境界は超えない側）。
  assert.equal(isDragDistance({ x: 0, y: 0 }, { x: 4, y: 0 }, 4), false);
});

test('isDragDistance: from / to のどちらかが欠けている場合はドラッグ扱いしない（false 相当）', () => {
  assert.equal(isDragDistance(null, { x: 100, y: 100 }, 4), false);
  assert.equal(isDragDistance({ x: 0, y: 0 }, null, 4), false);
  assert.equal(isDragDistance(undefined, undefined, 4), false);
});
