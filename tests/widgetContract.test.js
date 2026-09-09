'use strict';

// 宣言的ウィジェット（tasks-widget.json）契約の共有ロジック（utils/widgetContract.js）の単体テスト。
// docs/tasks-widget-schema.md（vk-orchestrator）に対する描画側の純粋ロジックを検証する。

const test = require('node:test');
const assert = require('node:assert/strict');

const contract = require('../utils/widgetContract');

// 最小限の正常系ウィジェット（raw 相当）を組み立てるヘルパー。
function baseRawWidget(overrides) {
  return Object.assign({
    schemaVersion: 1,
    kind: 'task-list',
    lang: 'ja',
    updatedAt: '2026-07-21T00:00:00.000Z',
    viewer: 'octocat',
    staleThresholdMs: 120000,
    emptyText: 'タスクはありません',
    groups: [],
  }, overrides || {});
}

test('sanitizeWidget: kind が task-list 以外なら null（描画しない）', () => {
  assert.equal(contract.sanitizeWidget(baseRawWidget({ kind: 'other' })), null);
  assert.equal(contract.sanitizeWidget(null), null);
  assert.equal(contract.sanitizeWidget([]), null);
});

test('sanitizeWidget: トップレベルを正規化し既定を補う', () => {
  const w = contract.sanitizeWidget(baseRawWidget({ staleThresholdMs: 0, viewer: '  ' }));
  assert.equal(w.kind, 'task-list');
  assert.equal(w.lang, 'ja');
  // 0 は不正としてフォールバック既定へ寄せる。
  assert.equal(w.staleThresholdMs, contract.DEFAULT_STALE_THRESHOLD_MS);
  // 空白のみ viewer は null。
  assert.equal(w.viewer, null);
});

test('sanitizeWidget: 未知 tone はそのまま保持し、描画側で toneOrDefault が neutral へ寄せる', () => {
  const w = contract.sanitizeWidget(baseRawWidget({
    groups: [{ id: 'x', label: 'X', tone: 'bogus', items: [] }],
  }));
  assert.equal(w.groups[0].tone, 'bogus');
  assert.equal(contract.toneOrDefault(w.groups[0].tone), 'neutral');
  assert.equal(contract.toneOrDefault('warning'), 'warning');
});

test('sanitizeWidget: 未知フィールド（action/field/rel）は落とす（前方互換）', () => {
  const w = contract.sanitizeWidget(baseRawWidget({
    groups: [{
      id: 'in-progress', label: '実行中', tone: 'progress', items: [{
        id: '10', title: 'T', editable: true,
        links: [
          { rel: 'queue', url: 'https://example.com/issues/10', label: 'queue' },
          { rel: 'unknown', url: 'https://example.com/x', label: 'x' },
        ],
        controls: [
          { type: 'select', field: 'status', label: 'ステータス', current: 'in-progress', options: [
            { value: 'in-progress', label: '実行中' },
            { value: 'done', label: '完了', command: { action: 'set-status', taskId: '10', to: 'done', expected: 'in-progress' } },
          ] },
          { type: 'select', field: 'bogus', label: 'x', current: 'a', options: [{ value: 'a', label: 'a' }] },
          { type: 'menu', field: 'status', label: 'x', current: 'a', options: [{ value: 'a', label: 'a' }] },
        ],
      }],
    }],
  }));
  const item = w.groups[0].items[0];
  // 未知 rel のリンクは落ちる。
  assert.equal(item.links.length, 1);
  assert.equal(item.links[0].rel, 'queue');
  // 未知 field / 未知 type のコントロールは落ちる。
  assert.equal(item.controls.length, 1);
  assert.equal(item.controls[0].field, 'status');
});

test('sanitizeWidget: http(s) 以外の URL は落とす（二重防御）', () => {
  const w = contract.sanitizeWidget(baseRawWidget({
    groups: [{ id: 'g', label: 'G', tone: 'info', items: [{
      id: '1', title: 'T', editable: false, links: [
        { rel: 'queue', url: 'javascript:alert(1)', label: 'x' },
        { rel: 'pr', url: 'https://example.com/pr/1', label: 'pr' },
      ],
    }] }],
  }));
  const item = w.groups[0].items[0];
  assert.equal(item.links.length, 1);
  assert.equal(item.links[0].url, 'https://example.com/pr/1');
});

test('sanitizeWidget: editable=false のアイテムは controls を持たない', () => {
  const w = contract.sanitizeWidget(baseRawWidget({
    groups: [{ id: 'done', label: '完了', tone: 'neutral', items: [{
      id: '2', title: 'done task', editable: false,
      controls: [{ type: 'select', field: 'status', label: 's', current: 'done', options: [{ value: 'done', label: '完了' }] }],
    }] }],
  }));
  assert.equal(w.groups[0].items[0].controls.length, 0);
});

test('sanitizeWidget: automerge の select コントロールを保持する', () => {
  const w = contract.sanitizeWidget(baseRawWidget({
    groups: [{ id: 'ready', label: '準備完了', tone: 'info', items: [{
      id: '254', title: 'automerge task', editable: true,
      controls: [{
        type: 'select',
        field: 'automerge',
        label: '自動マージ',
        ariaLabel: '自動マージを選択',
        current: 'disabled',
        options: [
          { value: 'disabled', label: 'しない' },
          { value: 'enabled', label: 'する', command: { action: 'set-automerge', taskId: '254', to: 'enabled', expected: 'disabled' } },
        ],
      }],
    }] }],
  }));
  const control = w.groups[0].items[0].controls[0];
  assert.equal(control.field, 'automerge');
  assert.equal(control.type, 'select');
  assert.equal(control.options[1].command.action, 'set-automerge');
});

test('sanitizeWidget: reviewCoderabbit / reviewCodeReview の select コントロールを保持する', () => {
  const w = contract.sanitizeWidget(baseRawWidget({
    groups: [{ id: 'ready', label: '準備完了', tone: 'info', items: [{
      id: '254', title: 'review task', editable: true,
      controls: [
        {
          type: 'select',
          field: 'reviewCoderabbit',
          label: 'CodeRabbit レビュー',
          ariaLabel: 'CodeRabbit レビューを選択',
          current: 'disabled',
          options: [
            { value: 'disabled', label: 'しない' },
            { value: 'enabled', label: 'する', command: { action: 'set-review-coderabbit', taskId: '254', to: 'enabled', expected: 'disabled' } },
          ],
        },
        {
          type: 'select',
          field: 'reviewCodeReview',
          label: 'コードレビュー',
          ariaLabel: 'コードレビューを選択',
          current: 'disabled',
          options: [
            { value: 'disabled', label: 'しない' },
            { value: 'enabled', label: 'する', command: { action: 'set-review-code-review', taskId: '254', to: 'enabled', expected: 'disabled' } },
          ],
        },
      ],
    }] }],
  }));
  const controls = w.groups[0].items[0].controls;
  assert.equal(controls[0].field, 'reviewCoderabbit');
  assert.equal(controls[0].type, 'select');
  assert.equal(controls[0].options[1].command.action, 'set-review-coderabbit');
  assert.equal(controls[1].field, 'reviewCodeReview');
  assert.equal(controls[1].type, 'select');
  assert.equal(controls[1].options[1].command.action, 'set-review-code-review');
});

test('sanitizeWidget: emphasis は attention のみ、それ以外は無視', () => {
  const w = contract.sanitizeWidget(baseRawWidget({
    groups: [{ id: 'g', label: 'G', tone: 'warning', items: [
      { id: '1', title: 'a', editable: false, emphasis: 'attention' },
      { id: '2', title: 'b', editable: false, emphasis: 'loud' },
    ] }],
  }));
  assert.equal(w.groups[0].items[0].emphasis, 'attention');
  assert.equal(Object.prototype.hasOwnProperty.call(w.groups[0].items[1], 'emphasis'), false);
});

test('sanitizeWidget: 文字長を上限でクランプする', () => {
  const long = 'あ'.repeat(contract.LIMITS.text + 50);
  const w = contract.sanitizeWidget(baseRawWidget({
    groups: [{ id: 'g', label: long, tone: 'info', items: [] }],
  }));
  assert.equal(w.groups[0].label.length, contract.LIMITS.text);
});

test('isWidgetStale: null / updatedAt 無し / 閾値超過は true', () => {
  assert.equal(contract.isWidgetStale(null), true);
  assert.equal(contract.isWidgetStale({ updatedAt: null, staleThresholdMs: 1000 }), true);
  const now = Date.parse('2026-07-21T00:05:00.000Z');
  assert.equal(contract.isWidgetStale({ updatedAt: '2026-07-21T00:00:00.000Z', staleThresholdMs: 120000 }, { now }), true);
  assert.equal(contract.isWidgetStale({ updatedAt: '2026-07-21T00:04:59.000Z', staleThresholdMs: 120000 }, { now }), false);
});

test('buildCommandLine: 断片に id / requestedAt を付与する。不正断片は null', () => {
  const line = contract.buildCommandLine(
    { action: 'set-status', taskId: '139', to: 'awaiting-approval', expected: 'ready', id: 'IGNORED', requestedAt: 'IGNORED' },
    { id: 'uuid-1', requestedAt: '2026-07-21T00:00:00.000Z' },
  );
  assert.deepEqual(line, {
    id: 'uuid-1',
    taskId: '139',
    action: 'set-status',
    to: 'awaiting-approval',
    expected: 'ready',
    requestedAt: '2026-07-21T00:00:00.000Z',
  });
  // 未知 action は null。
  assert.equal(contract.buildCommandLine({ action: 'delete', taskId: '1', to: 'x', expected: 'y' }, { id: 'i', requestedAt: 'r' }), null);
  // taskId 欠落は null。
  assert.equal(contract.buildCommandLine({ action: 'set-status', to: 'x', expected: 'y' }, { id: 'i', requestedAt: 'r' }), null);
});

test('sanitizeCommand: set-automerge の単一コマンドを保持する', () => {
  assert.deepEqual(contract.sanitizeCommand({
    action: 'set-automerge',
    taskId: '254',
    to: 'enabled',
    expected: 'disabled',
  }), {
    action: 'set-automerge',
    taskId: '254',
    to: 'enabled',
    expected: 'disabled',
  });
});

test('sanitizeCommand: set-review-coderabbit / set-review-code-review の単一コマンドを保持する', () => {
  assert.deepEqual(contract.sanitizeCommand({
    action: 'set-review-coderabbit',
    taskId: '254',
    to: 'enabled',
    expected: 'disabled',
  }), {
    action: 'set-review-coderabbit',
    taskId: '254',
    to: 'enabled',
    expected: 'disabled',
  });
  assert.deepEqual(contract.sanitizeCommand({
    action: 'set-review-code-review',
    taskId: '254',
    to: 'enabled',
    expected: 'disabled',
  }), {
    action: 'set-review-code-review',
    taskId: '254',
    to: 'enabled',
    expected: 'disabled',
  });
});

test('buildBatchCommandLine: apply-batch 断片に id / requestedAt を付与し ops を保持する', () => {
  const line = contract.buildBatchCommandLine(
    {
      action: 'apply-batch',
      taskId: '139',
      ops: [
        { action: 'set-priority', taskId: 'IGNORED', to: 'high', expected: 'medium' },
        { action: 'set-status', to: 'awaiting-approval', expected: 'ready' },
      ],
      id: 'IGNORED',
      requestedAt: 'IGNORED',
    },
    { id: 'uuid-batch', requestedAt: '2026-07-21T00:00:00.000Z' },
  );
  assert.deepEqual(line, {
    id: 'uuid-batch',
    taskId: '139',
    action: 'apply-batch',
    ops: [
      { action: 'set-priority', to: 'high', expected: 'medium' },
      { action: 'set-status', to: 'awaiting-approval', expected: 'ready' },
    ],
    requestedAt: '2026-07-21T00:00:00.000Z',
  });
});

test('sanitizeBatchCommand: apply-batch の ops に set-automerge を保持する', () => {
  assert.deepEqual(contract.sanitizeBatchCommand({
    action: 'apply-batch',
    taskId: '254',
    ops: [
      { action: 'set-status', to: 'awaiting-approval', expected: 'ready' },
      { action: 'set-automerge', to: 'enabled', expected: 'disabled' },
    ],
  }), {
    action: 'apply-batch',
    taskId: '254',
    ops: [
      { action: 'set-status', to: 'awaiting-approval', expected: 'ready' },
      { action: 'set-automerge', to: 'enabled', expected: 'disabled' },
    ],
  });
});

test('sanitizeBatchCommand: apply-batch の ops に set-review-coderabbit / set-review-code-review を保持する', () => {
  assert.deepEqual(contract.sanitizeBatchCommand({
    action: 'apply-batch',
    taskId: '254',
    ops: [
      { action: 'set-review-coderabbit', to: 'enabled', expected: 'disabled' },
      { action: 'set-review-code-review', to: 'enabled', expected: 'disabled' },
    ],
  }), {
    action: 'apply-batch',
    taskId: '254',
    ops: [
      { action: 'set-review-coderabbit', to: 'enabled', expected: 'disabled' },
      { action: 'set-review-code-review', to: 'enabled', expected: 'disabled' },
    ],
  });
});

test('sanitizeBatchCommand: ops 空・重複 action・未対応 action は null', () => {
  assert.equal(contract.sanitizeBatchCommand({ action: 'apply-batch', taskId: '1', ops: [] }), null);
  assert.equal(contract.sanitizeBatchCommand({ action: 'apply-batch', taskId: '1', ops: [
    { action: 'set-status', to: 'a', expected: 'b' },
    { action: 'set-status', to: 'c', expected: 'd' },
  ] }), null);
  assert.equal(contract.sanitizeBatchCommand({ action: 'apply-batch', taskId: '1', ops: [
    { action: 'delete', to: 'a', expected: 'b' },
  ] }), null);
});

test('sanitizeBatchCommand: op 内 taskId は無視し、prototype 経由の action は拒否する', () => {
  const sanitizedBatch = contract.sanitizeBatchCommand({
    action: 'apply-batch',
    taskId: '1',
    ops: [{ action: 'set-sequential', taskId: 'IGNORED', to: 'sequential', expected: 'parallel' }],
  });
  assert.deepEqual(sanitizedBatch, {
    action: 'apply-batch',
    taskId: '1',
    ops: [{ action: 'set-sequential', to: 'sequential', expected: 'parallel' }],
  });

  const inheritedOp = Object.create({ action: 'set-status' });
  inheritedOp.to = 'done';
  inheritedOp.expected = 'ready';
  assert.equal(contract.sanitizeBatchCommand({ action: 'apply-batch', taskId: '1', ops: [inheritedOp] }), null);
});

test('deriveAssigneeFilterOptions: 固定 self/all + 担当者ソート + 担当なし', () => {
  const w = contract.sanitizeWidget(baseRawWidget({
    groups: [{ id: 'g', label: 'G', tone: 'info', items: [
      { id: '1', title: 'a', editable: false, assignee: 'zoe' },
      { id: '2', title: 'b', editable: false, assignee: 'alice' },
      { id: '3', title: 'c', editable: false },
    ] }],
  }));
  const opts = contract.deriveAssigneeFilterOptions(w);
  assert.deepEqual(opts.map((o) => o.value), ['self', 'all', 'alice', 'zoe', 'none']);
});

test('resolveAssigneeFilterMode: 選択肢に無い値は fallback へ', () => {
  const opts = [{ value: 'self' }, { value: 'all' }];
  assert.equal(contract.resolveAssigneeFilterMode('all', opts), 'all');
  assert.equal(contract.resolveAssigneeFilterMode('ghost', opts, 'self'), 'self');
});

test('applyAssigneeFilter: モード別の絞り込み', () => {
  const items = [
    { id: '1', assignee: 'me' },
    { id: '2', assignee: 'you' },
    { id: '3' },
  ];
  assert.equal(contract.applyAssigneeFilter(items, 'all', 'me').length, 3);
  assert.deepEqual(contract.applyAssigneeFilter(items, 'self', 'me').map((i) => i.id), ['1']);
  assert.deepEqual(contract.applyAssigneeFilter(items, 'none', 'me').map((i) => i.id), ['3']);
  assert.deepEqual(contract.applyAssigneeFilter(items, 'you', 'me').map((i) => i.id), ['2']);
});

test('isGithubMode: rel:"queue" の外部リンクがあれば true', () => {
  const gh = contract.sanitizeWidget(baseRawWidget({
    groups: [{ id: 'g', label: 'G', tone: 'info', items: [{
      id: '1', title: 't', editable: false, links: [{ rel: 'queue', url: 'https://example.com/issues/1', label: 'q' }],
    }] }],
  }));
  const local = contract.sanitizeWidget(baseRawWidget({
    groups: [{ id: 'g', label: 'G', tone: 'info', items: [{ id: '1', title: 't', editable: false }] }],
  }));
  assert.equal(contract.isGithubMode(gh), true);
  assert.equal(contract.isGithubMode(local), false);
});

test('isHttpUrl: http(s) のみ true', () => {
  assert.equal(contract.isHttpUrl('https://example.com'), true);
  assert.equal(contract.isHttpUrl('http://example.com'), true);
  assert.equal(contract.isHttpUrl('javascript:alert(1)'), false);
  assert.equal(contract.isHttpUrl('data:text/html,x'), false);
  assert.equal(contract.isHttpUrl(''), false);
});
