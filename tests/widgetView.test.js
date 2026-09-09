'use strict';

// 宣言的ウィジェットの共有 DOM レンダラ（renderer/widgetView.js）の単体テスト。
// jsdom を持たないため、renderer が使う DOM API の部分集合だけを実装した最小スタブで検証する。
// 重点: textContent のみで描画（innerHTML 禁止）・tone フォールバック・URL 二段防御・
//       担当者フィルタ適用・staleness による空文言抑止・コマンド発行と確認ダイアログ。

const test = require('node:test');
const assert = require('node:assert/strict');

const contract = require('../utils/widgetContract');
const { createTaskWidgetView, DEFAULT_STRINGS } = require('../renderer/widgetView');

// ── 最小 DOM スタブ ──────────────────────────────────────────────────────────
class FakeClassList {
  constructor() { this._set = new Set(); }
  add(c) { this._set.add(c); }
  remove(c) { this._set.delete(c); }
  toggle(c, on) { const v = on === undefined ? !this._set.has(c) : on; if (v) this._set.add(c); else this._set.delete(c); return v; }
  contains(c) { return this._set.has(c); }
}

class FakeElement {
  constructor(tag, ownerDocument) {
    this.tagName = String(tag).toUpperCase();
    this.ownerDocument = ownerDocument || null;
    this.children = [];
    this.dataset = {};
    this.attributes = {};
    this.listeners = {};
    this.classList = new FakeClassList();
    this.parentNode = null;
    this._text = '';
    this._className = '';
    this._id = '';
    this.value = undefined;
    this.disabled = false;
    this.selected = false;
    this.href = undefined;
    this.title = undefined;
    this.draggable = undefined;
  }

  // innerHTML は使ってはいけない契約。使われたら即失敗させる。
  set innerHTML(_v) { throw new Error('innerHTML must not be used (security contract violation)'); }
  get innerHTML() { return undefined; }

  // 実 DOM 同様、className と classList を同期させる（レンダラは className 代入で class を付ける）。
  set className(v) {
    this._className = String(v == null ? '' : v);
    this.classList._set = new Set(this._className.split(/\s+/).filter(Boolean));
  }
  get className() { return this._className; }

  set id(v) {
    this._id = String(v == null ? '' : v);
    if (this._id) this.attributes.id = this._id;
    else delete this.attributes.id;
  }
  get id() { return this._id; }

  get childNodes() { return this.children; }
  get firstChild() { return this.children[0] || null; }

  appendChild(node) { node.parentNode = this; this.children.push(node); return node; }
  removeChild(node) { const i = this.children.indexOf(node); if (i >= 0) this.children.splice(i, 1); return node; }
  replaceChildren() {
    const nodes = Array.prototype.slice.call(arguments);
    this.children = [];
    nodes.forEach((n) => this.appendChild(n));
  }

  setAttribute(k, v) { this.attributes[k] = String(v); if (k === 'id') this._id = String(v); }
  getAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attributes, k) ? this.attributes[k] : null; }
  removeAttribute(k) { delete this.attributes[k]; }

  addEventListener(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); }
  focus() { if (this.ownerDocument) this.ownerDocument.activeElement = this; }
  // テスト用: イベントを発火する。
  dispatch(type) {
    const ev = { preventDefault() {}, stopPropagation() {} };
    (this.listeners[type] || []).forEach((fn) => fn(ev));
  }

  set textContent(v) {
    // 実 DOM 同様、既存子を消してテキストノード 1 個にする。
    this.children = [];
    if (v !== '' && v !== null && v !== undefined) {
      const tn = new FakeTextNode(String(v));
      tn.parentNode = this;
      this.children.push(tn);
    }
    this._text = String(v == null ? '' : v);
  }
  get textContent() {
    if (this.children.length) return this.children.map((c) => c.textContent).join('');
    return this._text;
  }

  get options() { return this.children.filter((c) => c.tagName === 'OPTION'); }

  // 深さ優先で条件に合う最初の要素を返す簡易 querySelector（tag/class/dataset のみ対応）。
  querySelectorAll(predicate) {
    const out = [];
    const walk = (node) => {
      node.children.forEach((c) => { if (c instanceof FakeElement) { if (predicate(c)) out.push(c); walk(c); } });
    };
    walk(this);
    return out;
  }
}

class FakeTextNode {
  constructor(text) { this.tagName = '#text'; this._text = text; this.children = []; }
  get textContent() { return this._text; }
}

function makeDoc() {
  const doc = { activeElement: null };
  doc.createElement = (tag) => new FakeElement(tag, doc);
  return doc;
}

// テスト用のサニタイズ済みウィジェットを組む（contract.sanitizeWidget を通す）。
function sanitized(rawGroups, extra) {
  return contract.sanitizeWidget(Object.assign({
    schemaVersion: 1,
    kind: 'task-list',
    lang: 'ja',
    updatedAt: '2026-07-21T00:00:00.000Z',
    viewer: 'me',
    staleThresholdMs: 120000,
    emptyText: 'タスクはありません',
    groups: rawGroups,
  }, extra || {}));
}

function makeView(deps) {
  const doc = makeDoc();
  const groupsEl = doc.createElement('div');
  const view = createTaskWidgetView(Object.assign({
    doc,
    groupsEl,
    contract,
    isSafeExternalUrl: () => true,
    openUrl: () => {},
    sendCommand: async () => ({ ok: true }),
    confirm: () => true,
    getFilterMode: () => 'all',
    requestRerender: () => {},
    pendingTimeoutMs: 30000,
  }, deps || {}));
  return { doc, groupsEl, view };
}

// ── テスト ───────────────────────────────────────────────────────────────────

test('render: ステータスバッジを各カードの先頭へ prepend し、グループ見出しは描画しない', () => {
  const widget = sanitized([
    { id: 'in-progress', label: '実行中', tone: 'progress', items: [
      { id: '1', title: 'タスクA', editable: false, badges: [{ label: '高', tone: 'danger' }, { label: '直列', tone: 'zzz' }] },
    ] },
  ]);
  const { groupsEl, view } = makeView();
  view.render(widget, { now: Date.parse('2026-07-21T00:00:10.000Z') });

  assert.equal(groupsEl.querySelectorAll((el) => el.classList.contains('task-list-group')).length, 1);
  assert.equal(groupsEl.querySelectorAll((el) => el.classList.contains('task-list-group-head')).length, 0);
  assert.equal(groupsEl.querySelectorAll((el) => el.classList.contains('widget-group-label')).length, 0);

  const badges = groupsEl.querySelectorAll((el) => el.classList.contains('widget-badge'));
  assert.deepEqual(badges.map((badge) => badge.textContent), ['実行中', '高', '直列']);
  assert.deepEqual(badges.map((badge) => badge.dataset.tone), ['progress', 'danger', 'neutral']);
  // 未知 tone は neutral へフォールバック。
  assert.equal(badges[2].dataset.tone, 'neutral');
});

test('render: 文字列は textContent で描画され、HTML として解釈されない（XSS 防御）', () => {
  const evil = '<img src=x onerror=alert(1)>';
  const widget = sanitized([
    { id: 'g', label: 'G', tone: 'info', items: [{ id: '1', title: evil, editable: false }] },
  ]);
  const { groupsEl, view } = makeView();
  // innerHTML を使うと FakeElement が throw する。throw せず描画できることが契約遵守の証左。
  view.render(widget, { now: Date.parse('2026-07-21T00:00:10.000Z') });
  const titleEl = groupsEl.querySelectorAll((el) => el.classList.contains('task-item-title'))[0];
  // 生文字列がそのままテキストとして入る（要素化されない）。
  assert.equal(titleEl.textContent, evil);
  assert.equal(titleEl.children.length, 1);
  assert.equal(titleEl.children[0].tagName, '#text');
});

test('render: isSafeExternalUrl が false のリンクは描画しない（二段防御）', () => {
  const widget = sanitized([
    { id: 'g', label: 'G', tone: 'info', items: [{ id: '1', title: 't', editable: false, links: [
      { rel: 'queue', url: 'https://blocked.example/issues/1', label: 'queue' },
      { rel: 'pr', url: 'https://ok.example/pr/1', label: 'pr' },
    ] }] },
  ]);
  const { groupsEl, view } = makeView({
    isSafeExternalUrl: (url) => url.indexOf('blocked') === -1,
  });
  view.render(widget, { now: Date.parse('2026-07-21T00:00:10.000Z') });
  const links = groupsEl.querySelectorAll((el) => el.classList.contains('widget-link'));
  assert.equal(links.length, 1);
  assert.equal(links[0].dataset.rel, 'pr');
});

test('render: rel="queue" のリンクチップは非表示にし、rel="pr" は描画する', () => {
  const widget = sanitized([
    { id: 'g', label: 'G', tone: 'info', items: [{ id: '1', title: 't', editable: false, links: [
      { rel: 'queue', url: 'https://example.com/issues/1', label: 'Issue' },
      { rel: 'pr', url: 'https://example.com/pull/1', label: 'PR' },
    ] }] },
  ]);
  const { groupsEl, view } = makeView();
  view.render(widget, { now: Date.parse('2026-07-21T00:00:10.000Z') });

  const links = groupsEl.querySelectorAll((el) => el.classList.contains('widget-link'));
  assert.equal(links.length, 1);
  assert.equal(links[0].dataset.rel, 'pr');
  assert.equal(links[0].textContent, 'PR⁠↗');
});

test('render: queue URL があるタイトルは外部リンク化し、クリックで queue URL を openUrl へ渡す', () => {
  const queueUrl = 'https://github.com/vektor-inc/vk-orchestrator/issues/301';
  const opened = [];
  const safeChecked = [];
  const widget = sanitized([
    { id: 'in-progress', label: '実行中', tone: 'progress', items: [{ id: '301', title: '宣言ウィジェットの実行中タスク', editable: false, links: [
      { rel: 'queue', url: queueUrl, label: 'issue #301' },
      { rel: 'pr', url: 'https://github.com/vektor-inc/vk-orchestrator/pull/301', label: 'PR #301' },
    ] }] },
  ]);
  const { groupsEl, view } = makeView({
    isSafeExternalUrl: (url) => { safeChecked.push(url); return true; },
    openUrl: (url) => { opened.push(url); },
  });
  view.render(widget, { now: Date.parse('2026-07-21T00:00:10.000Z') });

  const title = groupsEl.querySelectorAll((el) => el.classList.contains('task-item-title'))[0];
  assert.equal(title.tagName, 'A');
  assert.equal(title.getAttribute('role'), 'link');
  assert.equal(title.getAttribute('aria-label'), '宣言ウィジェットの実行中タスク（外部ブラウザで開く）');
  assert.equal(title.title, `宣言ウィジェットの実行中タスク\n${queueUrl}`);
  assert.equal(title.textContent, '宣言ウィジェットの実行中タスク⁠↗');

  title.dispatch('click');
  assert.equal(opened.length, 1);
  assert.equal(opened[0], queueUrl);
  assert.ok(safeChecked.includes(queueUrl));
});

test('render: queue URL が無いタイトルはプレーンテキストのまま描画する', () => {
  const widget = sanitized([
    { id: 'ready', label: '実行待ち', tone: 'info', items: [{ id: '401', title: 'ローカルモードのタスク', editable: false, links: [
      { rel: 'pr', url: 'https://example.com/pull/401', label: 'PR #401' },
    ] }] },
  ], { viewer: null });
  const { groupsEl, view } = makeView();
  view.render(widget, { now: Date.parse('2026-07-21T00:00:10.000Z') });

  const title = groupsEl.querySelectorAll((el) => el.classList.contains('task-item-title'))[0];
  assert.equal(title.tagName, 'DIV');
  assert.equal(title.getAttribute('role'), null);
  assert.equal(title.textContent, 'ローカルモードのタスク');
});

test('render: 担当者フィルタ（self）は viewer のアイテムだけを描画する', () => {
  const widget = sanitized([
    { id: 'g', label: 'G', tone: 'info', items: [
      { id: '1', title: 'mine', editable: false, assignee: 'me', links: [{ rel: 'queue', url: 'https://x/issues/1', label: 'q' }] },
      { id: '2', title: 'theirs', editable: false, assignee: 'you', links: [{ rel: 'queue', url: 'https://x/issues/2', label: 'q' }] },
    ] },
  ]);
  const { groupsEl, view } = makeView({ getFilterMode: () => 'self' });
  const info = view.render(widget, { now: Date.parse('2026-07-21T00:00:10.000Z') });
  assert.equal(info.githubMode, true);
  assert.equal(info.filterEnabled, true);
  assert.equal(info.filterMode, 'self');
  assert.equal(info.visibleItems, 1);
  const titles = groupsEl.querySelectorAll((el) => el.classList.contains('task-item-title-text')).map((el) => el.textContent);
  assert.deepEqual(titles, ['mine']);
});

test('render: 表示 0 件かつ非 stale は空文言、stale のときは空文言を出さない', () => {
  const widget = sanitized([]);
  // 非 stale。
  const a = makeView();
  const infoFresh = a.view.render(widget, { now: Date.parse('2026-07-21T00:00:10.000Z') });
  assert.equal(infoFresh.stale, false);
  const emptyFresh = a.groupsEl.querySelectorAll((el) => el.classList.contains('task-list-empty'));
  assert.equal(emptyFresh.length, 1);
  assert.equal(emptyFresh[0].textContent, 'タスクはありません');

  // stale（updatedAt から閾値超過）。
  const b = makeView();
  const infoStale = b.view.render(widget, { now: Date.parse('2026-07-21T01:00:00.000Z') });
  assert.equal(infoStale.stale, true);
  assert.equal(b.groupsEl.querySelectorAll((el) => el.classList.contains('task-list-empty')).length, 0);
});

function editableWidgetWithControls(overrides) {
  const item = Object.assign({
    id: '10',
    title: 'T',
    editable: true,
    badges: [{ label: '中', tone: 'neutral' }, { label: '並列', tone: 'info' }],
    controls: [
      { type: 'select', field: 'status', label: 'ステータス', ariaLabel: 'ステータス', current: 'ready', options: [
        { value: 'ready', label: '実行待ち' },
        { value: 'in-progress', label: '実行中', command: { action: 'set-status', taskId: '10', to: 'in-progress', expected: 'ready' } },
        { value: 'awaiting-approval', label: '承認待ち', command: { action: 'set-status', taskId: '10', to: 'awaiting-approval', expected: 'ready' },
          confirm: { title: '承認待ちにしますか？', body: '確認が必要です' } },
      ] },
      { type: 'select', field: 'priority', label: '優先度', current: 'medium', options: [
        { value: 'medium', label: '中' },
        { value: 'high', label: '高', command: { action: 'set-priority', taskId: '10', to: 'high', expected: 'medium' } },
      ] },
      { type: 'select', field: 'sequential', label: '実行方式', current: 'parallel', options: [
        { value: 'parallel', label: '並列' },
        { value: 'sequential', label: '直列', command: { action: 'set-sequential', taskId: '10', to: 'sequential', expected: 'parallel' } },
      ] },
    ],
  }, overrides || {});
  return sanitized([{ id: 'ready', label: '実行待ち', tone: 'info', items: [item] }]);
}

test('render: editable アイテムは既定で select を畳み、編集ボタンだけを描画する', () => {
  const widget = editableWidgetWithControls();
  const { groupsEl, view } = makeView();
  view.render(widget, { now: Date.parse('2026-07-21T00:00:10.000Z') });

  assert.equal(groupsEl.querySelectorAll((el) => el.tagName === 'SELECT').length, 0);
  assert.equal(groupsEl.querySelectorAll((el) => el.classList.contains('task-edit-panel')).length, 0);
  const editButton = groupsEl.querySelectorAll((el) => el.classList.contains('task-item-edit'))[0];
  assert.equal(editButton.tagName, 'BUTTON');
  assert.equal(editButton.textContent, '編集');
  assert.equal(editButton.getAttribute('aria-expanded'), 'false');
  assert.equal(editButton.getAttribute('aria-label'), '「T」を編集');
});

test('render: 編集ボタン click 後の再描画でパネル・キャンセル・保存が現れ、hasOpenEditor が true', () => {
  const widget = editableWidgetWithControls();
  const { groupsEl, view } = makeView();
  view.render(widget, { now: Date.parse('2026-07-21T00:00:10.000Z') });

  groupsEl.querySelectorAll((el) => el.classList.contains('task-item-edit'))[0].dispatch('click');
  assert.equal(view.hasOpenEditor(), true);
  view.render(widget, { now: Date.parse('2026-07-21T00:00:10.000Z') });

  assert.equal(groupsEl.querySelectorAll((el) => el.tagName === 'SELECT').length, 3);
  const panel = groupsEl.querySelectorAll((el) => el.classList.contains('task-edit-panel'))[0];
  const editButton = groupsEl.querySelectorAll((el) => el.classList.contains('task-item-edit'))[0];
  assert.equal(editButton.getAttribute('aria-expanded'), 'true');
  assert.equal(editButton.getAttribute('aria-controls'), panel.getAttribute('id'));
  assert.equal(groupsEl.querySelectorAll((el) => el.classList.contains('task-edit-cancel'))[0].textContent, 'キャンセル');
  assert.equal(groupsEl.querySelectorAll((el) => el.classList.contains('task-edit-save'))[0].textContent, '保存');
});

test('render: select 変更は下書きだけ更新し、保存時に apply-batch を 1 回だけ送る', async () => {
  const widget = sanitized([
    { id: 'ready', label: '実行待ち', tone: 'info', items: [{
      id: '10', title: 'T', editable: true,
      controls: [
        { type: 'select', field: 'status', label: 'ステータス', ariaLabel: 'ステータス', current: 'ready', options: [
          { value: 'ready', label: '実行待ち' },
          { value: 'in-progress', label: '実行中', command: { action: 'set-status', taskId: '10', to: 'in-progress', expected: 'ready' } },
        ] },
        { type: 'select', field: 'priority', label: '優先度', current: 'medium', options: [
          { value: 'medium', label: '中' },
          { value: 'high', label: '高', command: { action: 'set-priority', taskId: '10', to: 'high', expected: 'medium' } },
        ] },
      ],
    }] },
  ]);
  const sent = [];
  let rerenders = 0;
  const { groupsEl, view } = makeView({
    sendCommand: async (cmd) => { sent.push(cmd); return { ok: true }; },
    requestRerender: () => { rerenders += 1; },
    // 反映待ちタイマーがテストプロセスを長く生かさないよう短くする。
    pendingTimeoutMs: 40,
  });
  view.render(widget, { now: Date.parse('2026-07-21T00:00:10.000Z') });
  groupsEl.querySelectorAll((el) => el.classList.contains('task-item-edit'))[0].dispatch('click');
  view.render(widget, { now: Date.parse('2026-07-21T00:00:10.000Z') });

  const save = groupsEl.querySelectorAll((el) => el.classList.contains('task-edit-save'))[0];
  assert.equal(save.disabled, true);

  const selects = groupsEl.querySelectorAll((el) => el.tagName === 'SELECT');
  selects.find((el) => el.dataset.field === 'status').value = 'in-progress';
  selects.find((el) => el.dataset.field === 'status').dispatch('change');
  assert.equal(sent.length, 0);
  assert.equal(save.disabled, false);

  save.dispatch('click');
  await Promise.resolve();

  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0], {
    action: 'apply-batch',
    taskId: '10',
    ops: [{ action: 'set-status', to: 'in-progress', expected: 'ready' }],
  });
  assert.equal(view.hasPending(), true);
  assert.ok(rerenders >= 1);

  // 反映待ちのタイムアウトを発火させてタイマーを片付ける（プロセスを 30 秒生かさない）。
  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.equal(view.hasPending(), false);
});

test('render: 保存後の widget 更新で current が追いつくと pending を消してパネルを畳む', async () => {
  const widget = editableWidgetWithControls();
  const updatedWidget = editableWidgetWithControls({
    controls: [
      { type: 'select', field: 'status', label: 'ステータス', current: 'in-progress', options: [
        { value: 'ready', label: '実行待ち', command: { action: 'set-status', taskId: '10', to: 'ready', expected: 'in-progress' } },
        { value: 'in-progress', label: '実行中' },
      ] },
    ],
  });
  const { doc, groupsEl, view } = makeView({
    sendCommand: async () => ({ ok: true }),
    pendingTimeoutMs: 30000,
  });
  view.render(widget, { now: Date.parse('2026-07-21T00:00:10.000Z') });
  groupsEl.querySelectorAll((el) => el.classList.contains('task-item-edit'))[0].dispatch('click');
  view.render(widget, { now: Date.parse('2026-07-21T00:00:10.000Z') });

  const status = groupsEl.querySelectorAll((el) => el.tagName === 'SELECT').find((el) => el.dataset.field === 'status');
  status.value = 'in-progress';
  status.dispatch('change');
  groupsEl.querySelectorAll((el) => el.classList.contains('task-edit-save'))[0].dispatch('click');
  await Promise.resolve();
  assert.equal(view.hasPending(), true);

  view.render(updatedWidget, { now: Date.parse('2026-07-21T00:00:11.000Z') });
  assert.equal(view.hasPending(), false);
  assert.equal(view.hasOpenEditor(), false);
  assert.equal(groupsEl.querySelectorAll((el) => el.classList.contains('task-edit-panel')).length, 0);
  const editButton = groupsEl.querySelectorAll((el) => el.classList.contains('task-item-edit'))[0];
  assert.equal(doc.activeElement, editButton);
});

test('render: キャンセルで下書きを破棄し畳みに戻る', () => {
  const widget = editableWidgetWithControls();
  const { groupsEl, view } = makeView();
  view.render(widget, { now: Date.parse('2026-07-21T00:00:10.000Z') });
  groupsEl.querySelectorAll((el) => el.classList.contains('task-item-edit'))[0].dispatch('click');
  view.render(widget, { now: Date.parse('2026-07-21T00:00:10.000Z') });

  const status = groupsEl.querySelectorAll((el) => el.tagName === 'SELECT').find((el) => el.dataset.field === 'status');
  status.value = 'in-progress';
  status.dispatch('change');

  groupsEl.querySelectorAll((el) => el.classList.contains('task-edit-cancel'))[0].dispatch('click');
  assert.equal(view.hasOpenEditor(), false);
  view.render(widget, { now: Date.parse('2026-07-21T00:00:10.000Z') });
  assert.equal(groupsEl.querySelectorAll((el) => el.tagName === 'SELECT').length, 0);
});

test('render: confirm 付き option は保存前に確認し、拒否なら送信しない', async () => {
  const widget = editableWidgetWithControls();
  const sent = [];
  const confirms = [];
  const { groupsEl, view } = makeView({
    sendCommand: async (cmd) => { sent.push(cmd); return { ok: true }; },
    confirm: (text) => { confirms.push(text); return false; },
  });
  view.render(widget, { now: Date.parse('2026-07-21T00:00:10.000Z') });
  groupsEl.querySelectorAll((el) => el.classList.contains('task-item-edit'))[0].dispatch('click');
  view.render(widget, { now: Date.parse('2026-07-21T00:00:10.000Z') });

  const select = groupsEl.querySelectorAll((el) => el.tagName === 'SELECT').find((el) => el.dataset.field === 'status');
  select.value = 'awaiting-approval';
  select.dispatch('change');
  groupsEl.querySelectorAll((el) => el.classList.contains('task-edit-save'))[0].dispatch('click');
  await Promise.resolve();

  assert.equal(confirms.length, 1);
  assert.match(confirms[0], /承認待ちにしますか？/);
  assert.equal(sent.length, 0);
  assert.equal(view.hasPending(), false);
  assert.equal(view.hasOpenEditor(), true);
  assert.equal(select.value, 'awaiting-approval');
});

test('render: 送信失敗時は下書きを保持し、パネルを開いたまま error を表示する', async () => {
  const widget = editableWidgetWithControls();
  const { groupsEl, view } = makeView({
    sendCommand: async () => ({ ok: false, error: 'boom' }),
  });
  view.render(widget, { now: Date.parse('2026-07-21T00:00:10.000Z') });
  groupsEl.querySelectorAll((el) => el.classList.contains('task-item-edit'))[0].dispatch('click');
  view.render(widget, { now: Date.parse('2026-07-21T00:00:10.000Z') });

  const status = groupsEl.querySelectorAll((el) => el.tagName === 'SELECT').find((el) => el.dataset.field === 'status');
  status.value = 'in-progress';
  status.dispatch('change');
  groupsEl.querySelectorAll((el) => el.classList.contains('task-edit-save'))[0].dispatch('click');
  await Promise.resolve();
  view.render(widget, { now: Date.parse('2026-07-21T00:00:10.000Z') });

  assert.equal(view.hasOpenEditor(), true);
  const kept = groupsEl.querySelectorAll((el) => el.tagName === 'SELECT').find((el) => el.dataset.field === 'status');
  assert.equal(kept.value, 'in-progress');
  const error = groupsEl.querySelectorAll((el) => el.classList.contains('task-item-action-error'))[0];
  assert.equal(error.getAttribute('role'), 'alert');
  assert.equal(error.textContent, DEFAULT_STRINGS.sendError);
});

test('render: 無効な選択肢は disabledReason を末尾ラベルと title に反映する', () => {
  const widget = sanitized([
    { id: 'ready', label: '実行待ち', tone: 'info', items: [{
      id: '12', title: 'T', editable: true,
      controls: [{ type: 'select', field: 'status', label: 'ステータス', current: 'ready', options: [
        { value: 'ready', label: '実行待ち' },
        { value: 'done', label: '完了', disabled: true, disabledReason: '直接完了にはできません' },
      ] }],
    }] },
  ]);
  const { groupsEl, view } = makeView();
  view.render(widget, { now: Date.parse('2026-07-21T00:00:10.000Z') });
  groupsEl.querySelectorAll((el) => el.classList.contains('task-item-edit'))[0].dispatch('click');
  view.render(widget, { now: Date.parse('2026-07-21T00:00:10.000Z') });
  const options = groupsEl.querySelectorAll((el) => el.tagName === 'OPTION');
  const doneOption = options.find((o) => o.value === 'done');
  assert.equal(doneOption.disabled, true);
  assert.equal(doneOption.textContent, '完了（直接完了にはできません）');
  assert.equal(doneOption.title, '直接完了にはできません');
  // 無効理由の無い選択肢はラベルそのまま。
  const readyOption = options.find((o) => o.value === 'ready');
  assert.equal(readyOption.textContent, '実行待ち');
});

// ── section によるグループ化（issue #389）─────────────────────────────────

function openEditPanel(widget) {
  const { doc, groupsEl, view } = makeView();
  view.render(widget, { now: Date.parse('2026-07-21T00:00:10.000Z') });
  groupsEl.querySelectorAll((el) => el.classList.contains('task-item-edit'))[0].dispatch('click');
  view.render(widget, { now: Date.parse('2026-07-21T00:00:10.000Z') });
  return { doc, groupsEl, view };
}

test('render: 連続する同じ section.id は 1 つの <fieldset> にまとまり、見出しは 1 回だけ描かれる', () => {
  const widget = sanitized([
    { id: 'ready', label: '実行待ち', tone: 'info', items: [{
      id: '10', title: 'T', editable: true,
      controls: [
        { type: 'select', field: 'reviewCoderabbit', label: 'CodeRabbit', current: 'disabled',
          section: { id: 'review', label: 'レビュー' },
          options: [{ value: 'disabled', label: 'しない' }] },
        { type: 'select', field: 'reviewCodeReview', label: 'コードレビュー', current: 'disabled',
          section: { id: 'review', label: 'レビュー' },
          options: [{ value: 'disabled', label: 'しない' }] },
      ],
    }] },
  ]);
  const { groupsEl } = openEditPanel(widget);

  const fieldsets = groupsEl.querySelectorAll((el) => el.classList.contains('task-edit-section'));
  assert.equal(fieldsets.length, 1);
  assert.equal(fieldsets[0].tagName, 'FIELDSET');
  assert.equal(fieldsets[0].getAttribute('disabled'), null);
  const legends = groupsEl.querySelectorAll((el) => el.tagName === 'LEGEND');
  assert.equal(legends.length, 1);
  assert.equal(legends[0].textContent, 'レビュー');
  // 2 個の select が同じ fieldset の配下に入っている。
  const selectsInFieldset = fieldsets[0].querySelectorAll((el) => el.tagName === 'SELECT');
  assert.equal(selectsInFieldset.length, 2);
});

test('render: 同じ section.id でも間に別項目を挟んで再登場した場合は別グループになる', () => {
  const widget = sanitized([
    { id: 'ready', label: '実行待ち', tone: 'info', items: [{
      id: '10', title: 'T', editable: true,
      controls: [
        { type: 'select', field: 'reviewCoderabbit', label: 'CodeRabbit', current: 'disabled',
          section: { id: 'review', label: 'レビュー' },
          options: [{ value: 'disabled', label: 'しない' }] },
        { type: 'select', field: 'automerge', label: '自動マージ', current: 'disabled',
          section: { id: 'automerge', label: '自動マージ' },
          options: [{ value: 'disabled', label: 'しない' }] },
        { type: 'select', field: 'reviewCodeReview', label: 'コードレビュー', current: 'disabled',
          section: { id: 'review', label: 'レビュー' },
          options: [{ value: 'disabled', label: 'しない' }] },
      ],
    }] },
  ]);
  const { groupsEl } = openEditPanel(widget);

  const fieldsets = groupsEl.querySelectorAll((el) => el.classList.contains('task-edit-section'));
  // review → automerge → review は 3 グループ（id が同じでも連続していないため統合しない）。
  assert.equal(fieldsets.length, 3);
  const legends = groupsEl.querySelectorAll((el) => el.tagName === 'LEGEND');
  assert.deepEqual(legends.map((l) => l.textContent), ['レビュー', '自動マージ', 'レビュー']);
  assert.equal(fieldsets[0].querySelectorAll((el) => el.tagName === 'SELECT').length, 1);
  assert.equal(fieldsets[2].querySelectorAll((el) => el.tagName === 'SELECT').length, 1);
});

test('render: section を 1 つも持たない宣言では <fieldset> を作らず従来どおり平坦に並ぶ', () => {
  const widget = editableWidgetWithControls();
  const { groupsEl } = openEditPanel(widget);

  const fieldsets = groupsEl.querySelectorAll((el) => el.tagName === 'FIELDSET');
  assert.equal(fieldsets.length, 0);
  assert.equal(groupsEl.querySelectorAll((el) => el.tagName === 'SELECT').length, 3);
});

test('render: section.label が空文字のときは <fieldset> だけ作り <legend> は描かない', () => {
  const widget = sanitized([
    { id: 'ready', label: '実行待ち', tone: 'info', items: [{
      id: '10', title: 'T', editable: true,
      controls: [
        { type: 'select', field: 'status', label: 'ステータス', current: 'ready',
          section: { id: 'grp', label: '' },
          options: [{ value: 'ready', label: '実行待ち' }] },
      ],
    }] },
  ]);
  const { groupsEl } = openEditPanel(widget);

  const fieldsets = groupsEl.querySelectorAll((el) => el.classList.contains('task-edit-section'));
  assert.equal(fieldsets.length, 1);
  const legends = groupsEl.querySelectorAll((el) => el.tagName === 'LEGEND');
  assert.equal(legends.length, 0);
});

test('render: firstControl はグループ化しても、パネル全体で最初の 1 個のまま', () => {
  const widget = sanitized([
    { id: 'ready', label: '実行待ち', tone: 'info', items: [{
      id: '10', title: 'T', editable: true,
      controls: [
        { type: 'select', field: 'status', label: 'ステータス', current: 'ready',
          section: { id: 'a', label: 'A' },
          options: [{ value: 'ready', label: '実行待ち' }] },
        { type: 'select', field: 'priority', label: '優先度', current: 'medium',
          section: { id: 'b', label: 'B' },
          options: [{ value: 'medium', label: '中' }] },
      ],
    }] },
  ]);
  const { doc, groupsEl } = openEditPanel(widget);
  // 開いた直後のフォーカスは「パネル全体で最初の 1 個」（= status の select）でなければならない。
  // グループごとにループを組み直すと各グループ先頭で毎回上書きしてしまうため、
  // 2 つ目のグループ（priority）が最終的に残っていないことを確認する。
  const statusSelect = groupsEl.querySelectorAll((el) => el.tagName === 'SELECT').find((el) => el.dataset.field === 'status');
  assert.equal(doc.activeElement, statusSelect);
});
