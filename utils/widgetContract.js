// 宣言的ウィジェット（tasks-widget.json）契約の共有ヘルパー。
//
// VK Orchestrator（vk-orchestrator#182）が確定させたスキーマ契約
// （docs/tasks-widget-schema.md）に対応するビューア側の純粋ロジック。
// tone/action/field/rel の allowlist・文字長上限・ネスト検証・staleness 再計算・
// 担当者フィルタ導出・コマンド行の組み立てなど、DOM に依存しない処理をまとめる。
//
// このモジュールは Node（main.js が require）とブラウザ（mobile.html が <script> で読み込み）の
// 両方から使えるよう UMD 形式で定義する。DOM 描画は renderer/widgetView.js が担う。
//
// セキュリティ契約: 宣言に載る全文字列は描画側が textContent で描画する（innerHTML 禁止）。
// URL は生成側で ^https?:// 済みだが、ここでも二重防御として http(s) 以外を落とす。
// 未知の tone/field/action/rel は描画を壊さず既定フォールバックで処理する（前方互換）。
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.VKWidgetContract = api;
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ── 契約の語彙（allowlist）────────────────────────────────────────────────
  // tone は 7 種。ビューアが tone→色へマッピングする。未知 tone は neutral へフォールバック。
  const WIDGET_TONES = Object.freeze([
    'warning', 'info', 'progress', 'success', 'danger', 'neutral', 'attention',
  ]);
  const WIDGET_TONE_SET = new Set(WIDGET_TONES);
  const DEFAULT_TONE = 'neutral';

  // コマンドの action は 6 種のみ（新規作成しない）。
  const COMMAND_ACTIONS = Object.freeze(['set-status', 'set-priority', 'set-sequential', 'set-automerge', 'set-review-coderabbit', 'set-review-code-review']);
  const COMMAND_ACTION_SET = new Set(COMMAND_ACTIONS);

  // コントロールの field は 6 種、type は select のみ。
  const CONTROL_FIELDS = Object.freeze(['status', 'priority', 'sequential', 'automerge', 'reviewCoderabbit', 'reviewCodeReview']);
  const CONTROL_FIELD_SET = new Set(CONTROL_FIELDS);
  const CONTROL_TYPES = Object.freeze(['select']);
  const CONTROL_TYPE_SET = new Set(CONTROL_TYPES);

  // リンクの rel。
  const LINK_RELS = Object.freeze(['queue', 'pr']);
  const LINK_REL_SET = new Set(LINK_RELS);

  const WIDGET_KIND = 'task-list';
  const DEFAULT_STALE_THRESHOLD_MS = 120000;
  const EMPHASIS_ATTENTION = 'attention';

  // ── 文字長・件数の上限（防御的サニタイズ）────────────────────────────────
  const LIMITS = Object.freeze({
    text: 500,        // title / label / ariaLabel / assignee / emptyText / group label 等
    confirmTitle: 500,
    confirmBody: 2000,
    disabledReason: 500,
    id: 200,
    url: 2048,
    groups: 100,
    items: 1000,      // per group
    badges: 20,
    links: 10,
    controls: 10,
    options: 60,
    lang: 16,
  });

  // ── プリミティブ・URL ヘルパー ────────────────────────────────────────────
  const HTTP_URL_RE = /^https?:\/\//i;

  function isHttpUrl(url) {
    return typeof url === 'string' && url.length <= LIMITS.url && HTTP_URL_RE.test(url.trim());
  }

  function isPrimitive(value) {
    return value === null
      || typeof value === 'string'
      || typeof value === 'number'
      || typeof value === 'boolean';
  }

  function clampStr(value, max) {
    if (typeof value !== 'string') return '';
    return value.length > max ? value.slice(0, max) : value;
  }

  // 未知 tone を neutral へフォールバックする（描画時の色マッピング用）。
  function toneOrDefault(tone) {
    return WIDGET_TONE_SET.has(tone) ? tone : DEFAULT_TONE;
  }

  // コマンド断片のプリミティブ値を文字列へ寄せる（number/boolean も許容して文字列化）。
  function coerceCommandValue(value) {
    if (typeof value === 'string') return value;
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
    if (typeof value === 'boolean') return String(value);
    return null;
  }

  function hasOwn(obj, key) {
    return Object.prototype.hasOwnProperty.call(obj, key);
  }

  // ── サニタイズ（生成側 JSON → 描画に安全な正規化オブジェクト）──────────────
  function sanitizeCommand(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    if (!COMMAND_ACTION_SET.has(raw.action)) return null; // 未知 action は無視
    const taskId = coerceCommandValue(raw.taskId);
    const to = coerceCommandValue(raw.to);
    const expected = coerceCommandValue(raw.expected);
    if (taskId === null || !taskId || to === null || expected === null) return null;
    // 宣言側の id / requestedAt は使わない（ビューアが発行時に付与する）。
    return {
      action: raw.action,
      taskId: clampStr(taskId, LIMITS.id),
      to: clampStr(to, LIMITS.text),
      expected: clampStr(expected, LIMITS.text),
    };
  }

  function sanitizeBatchCommand(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    if (!hasOwn(raw, 'action') || raw.action !== 'apply-batch') return null;
    const taskId = coerceCommandValue(raw.taskId);
    if (taskId === null || !taskId) return null;
    if (!hasOwn(raw, 'ops') || !Array.isArray(raw.ops) || raw.ops.length === 0) return null;

    const seenActions = new Set();
    const ops = [];
    for (const rawOp of raw.ops) {
      if (!rawOp || typeof rawOp !== 'object' || Array.isArray(rawOp)) return null;
      if (!hasOwn(rawOp, 'action') || !COMMAND_ACTION_SET.has(rawOp.action)) return null;
      if (seenActions.has(rawOp.action)) return null;
      const to = hasOwn(rawOp, 'to') ? coerceCommandValue(rawOp.to) : null;
      const expected = hasOwn(rawOp, 'expected') ? coerceCommandValue(rawOp.expected) : null;
      if (to === null || expected === null) return null;
      seenActions.add(rawOp.action);
      ops.push({
        action: rawOp.action,
        to: clampStr(to, LIMITS.text),
        expected: clampStr(expected, LIMITS.text),
      });
    }

    return {
      action: 'apply-batch',
      taskId: clampStr(taskId, LIMITS.id),
      ops,
    };
  }

  function sanitizeConfirm(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    if (typeof raw.title !== 'string' && typeof raw.body !== 'string') return null;
    return {
      title: clampStr(typeof raw.title === 'string' ? raw.title : '', LIMITS.confirmTitle),
      body: clampStr(typeof raw.body === 'string' ? raw.body : '', LIMITS.confirmBody),
    };
  }

  function sanitizeOption(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const value = coerceCommandValue(raw.value);
    if (value === null) return null;
    const option = {
      value: clampStr(value, LIMITS.text),
      label: clampStr(typeof raw.label === 'string' ? raw.label : String(value), LIMITS.text),
      disabled: raw.disabled === true,
    };
    if (typeof raw.disabledReason === 'string' && raw.disabledReason) {
      option.disabledReason = clampStr(raw.disabledReason, LIMITS.disabledReason);
    }
    // 現在値・disabled 選択肢に command は付かない契約。付いていても disabled なら無視する。
    if (!option.disabled) {
      const command = sanitizeCommand(raw.command);
      if (command) option.command = command;
      const confirm = sanitizeConfirm(raw.confirm);
      if (confirm) option.confirm = confirm;
    }
    return option;
  }

  // control.section は「連続する同じ id を 1 グループにまとめて見出しを出す」ための任意付加情報
  // （issue #389）。id が無い／文字列でないと束ねようがないため、その場合は section 自体を無視する。
  function sanitizeSection(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    if (typeof raw.id !== 'string' || !raw.id) return null;
    return {
      id: clampStr(raw.id, LIMITS.id),
      label: clampStr(typeof raw.label === 'string' ? raw.label : '', LIMITS.text),
    };
  }

  function sanitizeControl(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    if (!CONTROL_TYPE_SET.has(raw.type)) return null; // 未知 type は無視
    if (!CONTROL_FIELD_SET.has(raw.field)) return null; // 未知 field は無視
    const optionsRaw = Array.isArray(raw.options) ? raw.options.slice(0, LIMITS.options) : [];
    const options = [];
    for (const o of optionsRaw) {
      const option = sanitizeOption(o);
      if (option) options.push(option);
    }
    if (options.length === 0) return null;
    const control = {
      type: raw.type,
      field: raw.field,
      label: clampStr(typeof raw.label === 'string' ? raw.label : '', LIMITS.text),
      ariaLabel: clampStr(typeof raw.ariaLabel === 'string' ? raw.ariaLabel : '', LIMITS.text),
      current: clampStr(coerceCommandValue(raw.current) || '', LIMITS.text),
      options,
    };
    const section = sanitizeSection(raw.section);
    if (section) control.section = section;
    return control;
  }

  function sanitizeLink(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    if (!LINK_REL_SET.has(raw.rel)) return null; // 未知 rel は無視
    if (!isHttpUrl(raw.url)) return null; // http(s) 以外は落とす（二重防御）
    return {
      rel: raw.rel,
      url: raw.url.trim(),
      label: clampStr(typeof raw.label === 'string' ? raw.label : raw.rel, LIMITS.text),
    };
  }

  function sanitizeBadge(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    if (typeof raw.label !== 'string' || !raw.label) return null;
    return {
      label: clampStr(raw.label, LIMITS.text),
      tone: typeof raw.tone === 'string' ? raw.tone : DEFAULT_TONE,
    };
  }

  function sanitizeItem(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const id = coerceCommandValue(raw.id);
    if (id === null || !id) return null;
    const item = {
      id: clampStr(id, LIMITS.id),
      title: clampStr(typeof raw.title === 'string' ? raw.title : '', LIMITS.text),
      links: [],
      badges: [],
      updatedAt: typeof raw.updatedAt === 'string' ? clampStr(raw.updatedAt, LIMITS.text) : null,
      editable: raw.editable === true,
      controls: [],
    };
    const linksRaw = Array.isArray(raw.links) ? raw.links.slice(0, LIMITS.links) : [];
    for (const l of linksRaw) {
      const link = sanitizeLink(l);
      if (link) item.links.push(link);
    }
    const badgesRaw = Array.isArray(raw.badges) ? raw.badges.slice(0, LIMITS.badges) : [];
    for (const b of badgesRaw) {
      const badge = sanitizeBadge(b);
      if (badge) item.badges.push(badge);
    }
    if (item.editable) {
      const controlsRaw = Array.isArray(raw.controls) ? raw.controls.slice(0, LIMITS.controls) : [];
      for (const c of controlsRaw) {
        const control = sanitizeControl(c);
        if (control) item.controls.push(control);
      }
    }
    // emphasis は意味属性（色ではない）。契約上は attention のみ。未知値は無視。
    if (raw.emphasis === EMPHASIS_ATTENTION) item.emphasis = EMPHASIS_ATTENTION;
    if (typeof raw.assignee === 'string' && raw.assignee.trim()) {
      item.assignee = clampStr(raw.assignee.trim(), LIMITS.text);
    }
    return item;
  }

  function sanitizeGroup(raw, order) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const id = coerceCommandValue(raw.id);
    const group = {
      id: clampStr(id || 'unknown', LIMITS.id),
      label: clampStr(typeof raw.label === 'string' ? raw.label : String(id || ''), LIMITS.text),
      tone: typeof raw.tone === 'string' ? raw.tone : DEFAULT_TONE,
      order: Number.isInteger(raw.order) ? raw.order : order,
      items: [],
    };
    const itemsRaw = Array.isArray(raw.items) ? raw.items.slice(0, LIMITS.items) : [];
    for (const i of itemsRaw) {
      const item = sanitizeItem(i);
      if (item) group.items.push(item);
    }
    return group;
  }

  /**
   * 生の tasks-widget JSON を、描画に安全な正規化ウィジェットへサニタイズする。
   * kind が契約外（task-list 以外）なら null を返す（描画しない）。
   * 文字列は長さ制限・URL は http(s) 検証・payload はプリミティブのみに落とす。
   * @param {any} raw
   * @returns {object|null}
   */
  function sanitizeWidget(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    if (raw.kind !== WIDGET_KIND) return null;
    const staleThresholdMs = (typeof raw.staleThresholdMs === 'number' && Number.isFinite(raw.staleThresholdMs) && raw.staleThresholdMs > 0)
      ? raw.staleThresholdMs
      : DEFAULT_STALE_THRESHOLD_MS;
    const groupsRaw = Array.isArray(raw.groups) ? raw.groups.slice(0, LIMITS.groups) : [];
    const groups = [];
    groupsRaw.forEach((g, index) => {
      const group = sanitizeGroup(g, index);
      if (group) groups.push(group);
    });
    return {
      schemaVersion: Number.isInteger(raw.schemaVersion) ? raw.schemaVersion : 1,
      kind: WIDGET_KIND,
      lang: clampStr(typeof raw.lang === 'string' ? raw.lang : 'ja', LIMITS.lang) || 'ja',
      updatedAt: typeof raw.updatedAt === 'string' ? clampStr(raw.updatedAt, LIMITS.text) : null,
      viewer: (typeof raw.viewer === 'string' && raw.viewer.trim()) ? clampStr(raw.viewer.trim(), LIMITS.text) : null,
      staleThresholdMs,
      emptyText: clampStr(typeof raw.emptyText === 'string' ? raw.emptyText : '', LIMITS.text),
      groups,
    };
  }

  // ── staleness（毎描画で再計算）────────────────────────────────────────────
  function parseWidgetTime(value) {
    if (typeof value !== 'string' || !value) return null;
    const ms = Date.parse(value);
    return Number.isFinite(ms) ? ms : null;
  }

  /**
   * now - updatedAt > staleThresholdMs を毎回計算する。boolean を焼き込まない。
   * @param {object|null} widget
   * @param {{ now?: number }} [options]
   * @returns {boolean}
   */
  function isWidgetStale(widget, options = {}) {
    if (!widget) return true;
    const updatedAtMs = parseWidgetTime(widget.updatedAt);
    if (!updatedAtMs) return true;
    const staleMs = (typeof widget.staleThresholdMs === 'number' && Number.isFinite(widget.staleThresholdMs))
      ? widget.staleThresholdMs
      : DEFAULT_STALE_THRESHOLD_MS;
    const now = (typeof options.now === 'number' && Number.isFinite(options.now)) ? options.now : Date.now();
    return now - updatedAtMs > staleMs;
  }

  // ── 担当者フィルタ（宣言されない。item.assignee と viewer から導出）──────────
  function flatItems(widget) {
    if (!widget || !Array.isArray(widget.groups)) return [];
    const items = [];
    for (const group of widget.groups) {
      if (group && Array.isArray(group.items)) items.push(...group.items);
    }
    return items;
  }

  // GitHub モード判定: いずれかの item が rel:"queue" の外部リンクを持つか。
  function isGithubMode(widget) {
    return flatItems(widget).some((item) => Array.isArray(item.links)
      && item.links.some((link) => link.rel === 'queue'));
  }

  // フィルタ選択肢を導出する。固定: 自分のみ(self)/全員(all)。動的: 担当者ログイン。
  // 担当者が空の item があれば「担当なし」(none) を足す。
  function deriveAssigneeFilterOptions(widget, strings = {}) {
    const options = [
      { value: 'self', label: strings.self || '自分のみ' },
      { value: 'all', label: strings.all || '全員' },
    ];
    const logins = new Set();
    let hasUnassigned = false;
    for (const item of flatItems(widget)) {
      const login = typeof item.assignee === 'string' && item.assignee.trim() ? item.assignee.trim() : '';
      if (!login) { hasUnassigned = true; continue; }
      logins.add(login);
    }
    Array.from(logins).sort((a, b) => a.localeCompare(b)).forEach((login) => {
      options.push({ value: login, label: login });
    });
    if (hasUnassigned) options.push({ value: 'none', label: strings.none || '担当なし' });
    return options;
  }

  function resolveAssigneeFilterMode(storedMode, options, fallback = 'self') {
    const valid = new Set(options.map((opt) => opt.value));
    return valid.has(storedMode) ? storedMode : fallback;
  }

  // モードに従って item を絞り込む。self は viewer と assignee 一致、none は担当なし、
  // 個別 login はその login 一致、all は全件。
  function applyAssigneeFilter(items, mode, viewer) {
    const list = Array.isArray(items) ? items : [];
    if (mode === 'all') return list;
    if (mode === 'none') return list.filter((item) => !(typeof item.assignee === 'string' && item.assignee.trim()));
    if (mode === 'self') {
      if (!viewer) return list;
      return list.filter((item) => item.assignee === viewer);
    }
    return list.filter((item) => item.assignee === mode);
  }

  // ── コマンド行の組み立て（ビューアが id / requestedAt を付与）────────────────
  /**
   * 宣言のコマンド断片 { action, taskId, to, expected } に一意 id と requestedAt を付与し、
   * commands.jsonl の 1 行 { id, taskId, action, to, expected, requestedAt } を組み立てる。
   * @param {object} fragment
   * @param {{ id: string, requestedAt: string }} meta
   * @returns {object|null}
   */
  function buildCommandLine(fragment, meta) {
    const command = sanitizeCommand(fragment);
    if (!command) return null;
    return {
      id: meta.id,
      taskId: command.taskId,
      action: command.action,
      to: command.to,
      expected: command.expected,
      requestedAt: meta.requestedAt,
    };
  }

  /**
   * apply-batch 断片 { action:'apply-batch', taskId, ops } に一意 id と requestedAt を付与し、
   * commands.jsonl の 1 行 { id, taskId, action, ops, requestedAt } を組み立てる。
   * @param {object} fragment
   * @param {{ id: string, requestedAt: string }} meta
   * @returns {object|null}
   */
  function buildBatchCommandLine(fragment, meta) {
    const command = sanitizeBatchCommand(fragment);
    if (!command) return null;
    return {
      id: meta.id,
      taskId: command.taskId,
      action: 'apply-batch',
      ops: command.ops,
      requestedAt: meta.requestedAt,
    };
  }

  return {
    WIDGET_TONES,
    WIDGET_TONE_SET,
    DEFAULT_TONE,
    COMMAND_ACTIONS,
    COMMAND_ACTION_SET,
    CONTROL_FIELDS,
    CONTROL_TYPES,
    LINK_RELS,
    WIDGET_KIND,
    DEFAULT_STALE_THRESHOLD_MS,
    EMPHASIS_ATTENTION,
    LIMITS,
    isHttpUrl,
    isPrimitive,
    toneOrDefault,
    sanitizeCommand,
    sanitizeBatchCommand,
    sanitizeWidget,
    isWidgetStale,
    flatItems,
    isGithubMode,
    deriveAssigneeFilterOptions,
    resolveAssigneeFilterMode,
    applyAssigneeFilter,
    buildCommandLine,
    buildBatchCommandLine,
  };
});
