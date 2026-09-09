// 宣言的ウィジェット（tasks-widget.json）の DOM 描画コントローラ（共有実装）。
//
// VK Orchestrator が書き出す宣言（docs/tasks-widget-schema.md）だけを読み、タスクの
// 語彙・色・遷移・操作を自前に持たずに描画する。デスクトップ（renderer/app.js）と
// モバイル（renderer/mobile.html）で描画ロジックを共有し、二重実装を減らす。
//
// このモジュールは Node（app.js が require）とブラウザ（mobile.html が <script> で読み込み）の
// 両方から使えるよう UMD 形式で定義する。契約ロジックは utils/widgetContract.js に依存する。
//
// セキュリティ契約: 宣言に載る全文字列は textContent で描画する（innerHTML 禁止）。
// URL は呼び出し側の isSafeExternalUrl で二重防御し、http(s) 以外は開かない。
// 未知の tone/field/action/rel は描画を壊さず既定フォールバックで処理する（前方互換）。
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.VKWidgetView = api;
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function resolveContract(injected) {
    if (injected) return injected;
    if (typeof require === 'function') {
      try { return require('../utils/widgetContract'); } catch (_e) { /* fallthrough */ }
    }
    if (typeof self !== 'undefined' && self.VKWidgetContract) return self.VKWidgetContract;
    throw new Error('VKWidgetContract not available');
  }

  const DEFAULT_STRINGS = Object.freeze({
    pending: '反映待ち',
    sendError: '送信に失敗しました（再試行してください）',
    timeoutError: '反映を確認できませんでした（内容は保持しています。再試行できます）',
    savingPending: '保存中…（反映待ち）',
    empty: 'タスクはありません',
    emptySelf: '自分に割り当てられたタスクはありません',
    emptyFiltered: '該当するタスクはありません',
    assigneePrefix: '担当: ',
    openExternal: '（外部ブラウザで開く）',
    self: '自分のみ',
    all: '全員',
    none: '担当なし',
  });

  // window.confirm は 1 文字列なので title + body を結合する（body 空なら本文なし）。
  function joinConfirm(confirm) {
    if (!confirm) return '';
    const title = typeof confirm.title === 'string' ? confirm.title : '';
    const body = typeof confirm.body === 'string' ? confirm.body : '';
    if (title && body) return `${title}\n\n${body}`;
    return title || body;
  }

  /**
   * ウィジェット描画コントローラを生成する。
   * @param {object} deps
   * @param {Document} deps.doc
   * @param {HTMLElement} deps.groupsEl  グループを描画するコンテナ（.task-list-groups 相当）
   * @param {(url:string)=>boolean} deps.isSafeExternalUrl
   * @param {(url:string)=>void} deps.openUrl  外部リンクを開く
   * @param {(command:object)=>Promise<{ok:boolean,error?:string}>} deps.sendCommand
   * @param {(text:string)=>boolean} [deps.confirm]  確認ダイアログ（既定 window.confirm）
   * @param {()=>string} [deps.getFilterMode]  担当者フィルタの現在モード
   * @param {()=>void} [deps.requestRerender]  pending タイムアウト時などの再描画要求
   * @param {object} [deps.strings]
   * @param {object} [deps.contract]
   * @param {number} [deps.pendingTimeoutMs]
   */
  function createTaskWidgetView(deps) {
    const contract = resolveContract(deps.contract);
    const doc = deps.doc;
    const groupsEl = deps.groupsEl;
    const strings = Object.assign({}, DEFAULT_STRINGS, deps.strings || {});
    const isSafeExternalUrl = deps.isSafeExternalUrl || (() => false);
    const openUrl = deps.openUrl || (() => {});
    const sendCommand = deps.sendCommand || (async () => ({ ok: false, error: 'no-transport' }));
    const confirmFn = deps.confirm || ((text) => (typeof window !== 'undefined' ? window.confirm(text) : true));
    const getFilterMode = deps.getFilterMode || (() => 'all');
    const requestRerender = deps.requestRerender || (() => {});
    const pendingTimeoutMs = Number.isFinite(deps.pendingTimeoutMs) ? deps.pendingTimeoutMs : 30000;

    // pending: taskId -> { fields: [{ field, expected }], timeoutId }
    const pending = new Map();
    const errors = new Map();
    const drafts = new Map();
    const savingTasks = new Set();
    const renderedEditButtons = new Map();
    const renderedPanels = new Map();
    let lastWidget = null;
    let editingTaskId = null;
    let pendingFocus = null;

    function getPending(taskId) { return pending.get(taskId) || null; }

    function clearPending(taskId) {
      const p = pending.get(taskId);
      if (p && p.timeoutId) clearTimeout(p.timeoutId);
      pending.delete(taskId);
    }

    function setPendingField(taskId, field, expected) {
      const existing = pending.get(taskId);
      const fields = existing ? existing.fields.filter((f) => f.field !== field) : [];
      fields.push({ field, expected });
      if (existing && existing.timeoutId) clearTimeout(existing.timeoutId);
      const timeoutId = setTimeout(() => {
        clearPending(taskId);
        savingTasks.delete(taskId);
        errors.set(taskId, strings.timeoutError);
        requestRerender();
      }, pendingTimeoutMs);
      pending.set(taskId, { fields, timeoutId });
      errors.delete(taskId);
    }

    function getControls(item) {
      return Array.isArray(item.controls) ? item.controls : [];
    }

    function buildDraftFromItem(item) {
      const draft = {};
      for (const control of getControls(item)) draft[control.field] = control.current;
      return draft;
    }

    function getDraftValue(item, control) {
      const draft = drafts.get(item.id);
      return draft && Object.prototype.hasOwnProperty.call(draft, control.field)
        ? draft[control.field]
        : control.current;
    }

    function setDraftValue(item, control, value) {
      const draft = drafts.get(item.id) || buildDraftFromItem(item);
      draft[control.field] = value;
      drafts.set(item.id, draft);
    }

    function findControlOption(control, value) {
      return (control.options || []).find((option) => option.value === value) || null;
    }

    function buildBatchOps(item) {
      const ops = [];
      const fields = [];
      const confirms = [];
      const seenActions = new Set();
      for (const control of getControls(item)) {
        const value = getDraftValue(item, control);
        if (value === control.current) continue;
        const option = findControlOption(control, value);
        if (!option || !option.command || seenActions.has(option.command.action)) continue;
        seenActions.add(option.command.action);
        fields.push(control.field);
        ops.push({
          action: option.command.action,
          to: option.command.to,
          expected: option.command.expected,
        });
        if (option.confirm) confirms.push(option.confirm);
      }
      return { ops, fields, confirms };
    }

    function isItemDirty(item) {
      return getControls(item).some((control) => getDraftValue(item, control) !== control.current);
    }

    function canSaveItem(item) {
      return buildBatchOps(item).ops.length > 0;
    }

    function updateEditPanelState(item) {
      const panel = renderedPanels.get(item.id);
      if (!panel) return;
      const dirty = isItemDirty(item);
      const canSave = canSaveItem(item);
      if (panel.dirtyDot) panel.dirtyDot.hidden = !dirty;
      if (panel.saveButton) panel.saveButton.disabled = !canSave || savingTasks.has(item.id);
    }

    function closeEditor(taskId, options = {}) {
      if (editingTaskId !== taskId) return;
      editingTaskId = null;
      drafts.delete(taskId);
      savingTasks.delete(taskId);
      pendingFocus = options.restoreFocus ? { type: 'edit-button', taskId } : null;
    }

    function confirmDiscardIfNeeded(taskId) {
      if (!taskId) return true;
      const item = contract.flatItems(lastWidget).find((candidate) => candidate.id === taskId);
      if (!item || !isItemDirty(item)) return true;
      return confirmFn('編集中の変更を破棄しますか？');
    }

    function openEditor(item) {
      if (editingTaskId === item.id) return;
      if (editingTaskId && savingTasks.has(editingTaskId)) return;
      if (editingTaskId && !confirmDiscardIfNeeded(editingTaskId)) return;
      if (editingTaskId) {
        drafts.delete(editingTaskId);
        savingTasks.delete(editingTaskId);
      }
      editingTaskId = item.id;
      drafts.set(item.id, buildDraftFromItem(item));
      errors.delete(item.id);
      pendingFocus = { type: 'first-control', taskId: item.id };
      requestRerender();
    }

    function cancelEditor(item) {
      if (savingTasks.has(item.id)) return;
      if (!confirmDiscardIfNeeded(item.id)) return;
      closeEditor(item.id, { restoreFocus: true });
      requestRerender();
    }

    async function saveEditor(item) {
      if (savingTasks.has(item.id)) return;
      const batch = buildBatchOps(item);
      if (!batch.ops.length) return;
      const confirmText = batch.confirms.map(joinConfirm).filter(Boolean).join('\n\n---\n\n');
      if (confirmText && !confirmFn(confirmText)) return;

      for (const field of batch.fields) {
        const control = getControls(item).find((candidate) => candidate.field === field);
        if (control) setPendingField(item.id, field, control.current);
      }
      savingTasks.add(item.id);
      requestRerender();

      let res;
      try {
        res = await sendCommand({
          action: 'apply-batch',
          taskId: item.id,
          ops: batch.ops,
        });
      } catch (_e) {
        res = { ok: false };
      }
      if (!res || !res.ok) {
        clearPending(item.id);
        savingTasks.delete(item.id);
        errors.set(item.id, strings.sendError);
        requestRerender();
      }
    }

    function safeFocus(node) {
      if (!node || typeof node.focus !== 'function') return;
      try {
        node.focus({ preventScroll: true });
      } catch (_e) {
        node.focus();
      }
    }

    function applyPendingFocus() {
      if (!pendingFocus) return;
      const focus = pendingFocus;
      pendingFocus = null;
      if (focus.type === 'edit-button') {
        safeFocus(renderedEditButtons.get(focus.taskId));
        return;
      }
      const panel = renderedPanels.get(focus.taskId);
      if (panel && panel.firstControl) safeFocus(panel.firstControl);
      else if (panel && panel.node) safeFocus(panel.node);
    }

    function cleanupEditorForWidget(widget) {
      if (!editingTaskId) return;
      const exists = contract.flatItems(widget).some((item) => item.id === editingTaskId);
      if (exists) return;
      drafts.delete(editingTaskId);
      savingTasks.delete(editingTaskId);
      clearPending(editingTaskId);
      errors.delete(editingTaskId);
      editingTaskId = null;
      pendingFocus = null;
    }

    // 現在のウィジェットに照らして pending を掃除する。
    // 反映された（該当 control の current が expected と変わった）field は落とす。
    function syncPending(widget) {
      const items = contract.flatItems(widget);
      const byId = new Map();
      for (const item of items) byId.set(item.id, item);
      for (const taskId of Array.from(pending.keys())) {
        const item = byId.get(taskId);
        if (!item) { clearPending(taskId); continue; }
        const currentByField = {};
        for (const control of (item.controls || [])) currentByField[control.field] = control.current;
        const p = pending.get(taskId);
        const remaining = p.fields.filter((f) => currentByField[f.field] === f.expected);
        if (remaining.length === 0) {
          clearPending(taskId);
          if (savingTasks.has(taskId)) {
            savingTasks.delete(taskId);
            if (editingTaskId === taskId) {
              editingTaskId = null;
              drafts.delete(taskId);
              pendingFocus = { type: 'edit-button', taskId };
            }
          }
        } else if (remaining.length !== p.fields.length) {
          if (p.timeoutId) clearTimeout(p.timeoutId);
          const timeoutId = setTimeout(() => {
            clearPending(taskId);
            savingTasks.delete(taskId);
            errors.set(taskId, strings.timeoutError);
            requestRerender();
          }, pendingTimeoutMs);
          pending.set(taskId, { fields: remaining, timeoutId });
        }
      }
      for (const taskId of Array.from(errors.keys())) {
        if (!byId.has(taskId)) errors.delete(taskId);
      }
    }

    // ── DOM ヘルパー（すべて textContent。innerHTML 禁止）────────────────────
    function el(tag, className) {
      const node = doc.createElement(tag);
      if (className) node.className = className;
      return node;
    }

    function appendExternalIcon(text) {
      const icon = el('span', 'widget-link-icon');
      icon.setAttribute('aria-hidden', 'true');
      icon.textContent = '⁠↗';
      text.appendChild(icon);
    }

    function wireExternalLink(anchor, label, url) {
      anchor.href = '#';
      anchor.setAttribute('role', 'link');
      anchor.draggable = false;
      anchor.title = `${label}\n${url}`;
      anchor.setAttribute('aria-label', `${label}${strings.openExternal}`);
      anchor.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (isSafeExternalUrl(url)) openUrl(url);
      });
    }

    function buildLink(link) {
      const a = el('a', 'widget-link');
      a.dataset.rel = link.rel;
      wireExternalLink(a, link.label, link.url);
      const text = el('span', 'widget-link-text');
      text.textContent = link.label;
      appendExternalIcon(text);
      a.appendChild(text);
      return a;
    }

    function findQueueLink(item) {
      return (item.links || []).find((link) => link.rel === 'queue' && isSafeExternalUrl(link.url)) || null;
    }

    function buildTitle(item) {
      const queueLink = findQueueLink(item);
      if (!queueLink) {
        const title = el('div', 'task-item-title');
        title.textContent = item.title;
        title.title = item.title;
        return title;
      }

      const a = el('a', 'task-item-title task-item-title-link');
      wireExternalLink(a, item.title, queueLink.url);
      const text = el('span', 'task-item-title-text');
      text.textContent = item.title;
      a.appendChild(text);
      appendExternalIcon(a);
      return a;
    }

    function buildBadge(badge) {
      const span = el('span', 'widget-badge');
      span.dataset.tone = contract.toneOrDefault(badge.tone);
      span.textContent = badge.label;
      return span;
    }

    function buildStatusBadge(group) {
      return buildBadge({ label: group.label, tone: group.tone });
    }

    function buildControl(item, control, disabled) {
      const field = el('label', 'widget-control');
      const labelEl = el('span', 'widget-control-label');
      labelEl.textContent = control.label;
      const select = el('select', 'widget-control-select');
      select.dataset.taskId = item.id;
      select.dataset.field = control.field;
      if (control.ariaLabel) select.setAttribute('aria-label', control.ariaLabel);
      select.disabled = disabled;
      if (disabled) select.setAttribute('aria-disabled', 'true');
      // tone は現在値の option の tone を select に反映する（badge と同系統の色）。
      const optionByValue = new Map();
      for (const option of control.options) {
        optionByValue.set(option.value, option);
        const optionEl = el('option');
        optionEl.value = option.value;
        // 無効な選択肢の理由（disabledReason）をユーザーへ伝える。ネイティブ <option> は
        // ツールチップ（title）が確実に見えるとは限らないため、可視の末尾ラベルにも併記する。
        if (option.disabled === true && option.disabledReason) {
          optionEl.textContent = `${option.label}（${option.disabledReason}）`;
          optionEl.title = option.disabledReason;
        } else {
          optionEl.textContent = option.label;
        }
        optionEl.disabled = option.disabled === true;
        if (option.value === getDraftValue(item, control)) optionEl.selected = true;
        select.appendChild(optionEl);
      }
      select.value = getDraftValue(item, control);
      select.addEventListener('change', () => {
        const option = optionByValue.get(select.value);
        if (!option || option.disabled === true) {
          select.value = control.current;
          return;
        }
        // 現在値は command 無しでも正当。現在値以外で command が無い選択肢は送信不能なので戻す。
        if (option.value !== control.current && !option.command) {
          select.value = getDraftValue(item, control);
          return;
        }
        setDraftValue(item, control, option.value);
        updateEditPanelState(item);
      });
      field.appendChild(labelEl);
      field.appendChild(select);
      return field;
    }

    function panelIdForItem(item) {
      const safe = String(item.id).replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'task';
      return `task-edit-panel-${safe}`;
    }

    function buildEditPanel(item, isPending) {
      const saving = savingTasks.has(item.id);
      const panel = el('div', 'task-edit-panel');
      const panelId = panelIdForItem(item);
      panel.id = panelId;
      panel.setAttribute('tabindex', '-1');

      panel.addEventListener('keydown', (e) => {
        if (e && e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          cancelEditor(item);
        }
      });

      const header = el('div', 'task-edit-panel-head');
      const heading = el('span', 'task-edit-panel-title');
      heading.textContent = 'タスク編集';
      const dirtyDot = el('span', 'task-edit-dirty');
      dirtyDot.setAttribute('aria-label', '未保存の変更あり');
      dirtyDot.hidden = !isItemDirty(item);
      header.appendChild(heading);
      header.appendChild(dirtyDot);
      panel.appendChild(header);

      const controls = el('div', 'task-edit-controls');
      let firstControl = null;
      // section でグループ化する。判定は「直前の項目との比較」のみで行い、id をキーにした
      // Map で束ねない（間に別項目を挟んで同じ id が再登場した場合、離れた項目まで誤って
      // 1 グループへ統合されるのを防ぐため。issue #389）。
      let currentFieldset = null;
      let currentSectionId = null;
      for (const control of getControls(item)) {
        const controlEl = buildControl(item, control, saving || isPending);
        if (!firstControl) {
          firstControl = controlEl.childNodes[1] || controlEl;
        }
        const sectionId = (control.section && typeof control.section.id === 'string' && control.section.id)
          ? control.section.id
          : null;
        if (sectionId && sectionId === currentSectionId) {
          currentFieldset.appendChild(controlEl);
        } else if (sectionId) {
          const fieldset = el('fieldset', 'task-edit-section');
          if (control.section.label) {
            const legend = el('legend');
            legend.textContent = control.section.label;
            fieldset.appendChild(legend);
          }
          fieldset.appendChild(controlEl);
          controls.appendChild(fieldset);
          currentFieldset = fieldset;
          currentSectionId = sectionId;
        } else {
          controls.appendChild(controlEl);
          currentFieldset = null;
          currentSectionId = null;
        }
      }
      panel.appendChild(controls);

      const actions = el('div', 'task-edit-actions');
      const cancel = el('button', 'task-edit-cancel');
      cancel.type = 'button';
      cancel.textContent = 'キャンセル';
      cancel.disabled = saving;
      cancel.addEventListener('click', () => cancelEditor(item));

      const save = el('button', 'task-edit-save');
      save.type = 'button';
      save.textContent = '保存';
      save.disabled = !canSaveItem(item) || saving;
      save.addEventListener('click', () => { saveEditor(item); });

      actions.appendChild(cancel);
      actions.appendChild(save);
      panel.appendChild(actions);

      renderedPanels.set(item.id, {
        node: panel,
        firstControl,
        saveButton: save,
        dirtyDot,
      });
      return panel;
    }

    function buildItem(item, group) {
      const li = el('li', 'task-item');
      li.dataset.id = item.id;
      if (item.emphasis) li.dataset.emphasis = item.emphasis;

      li.appendChild(buildTitle(item));

      const head = el('div', 'task-item-head');
      head.appendChild(buildStatusBadge(group));
      for (const badge of (item.badges || [])) head.appendChild(buildBadge(badge));
      if (item.assignee) {
        const assignee = el('span', 'task-item-assignee');
        assignee.textContent = `${strings.assigneePrefix}${item.assignee}`;
        head.appendChild(assignee);
      }
      const editable = item.editable && Array.isArray(item.controls) && item.controls.length;
      const isEditing = editable && editingTaskId === item.id;
      const panelId = panelIdForItem(item);
      if (editable) {
        const editButton = el('button', 'task-item-edit');
        editButton.type = 'button';
        editButton.setAttribute('aria-expanded', isEditing ? 'true' : 'false');
        editButton.setAttribute('aria-controls', panelId);
        editButton.setAttribute('aria-label', `「${item.title}」を編集`);
        editButton.textContent = '編集';
        editButton.disabled = savingTasks.has(item.id) || (editingTaskId && savingTasks.has(editingTaskId) && editingTaskId !== item.id);
        editButton.addEventListener('click', () => {
          if (isEditing) {
            cancelEditor(item);
          } else {
            openEditor(item);
          }
        });
        head.appendChild(editButton);
        renderedEditButtons.set(item.id, editButton);
      }
      if (head.childNodes.length) li.appendChild(head);

      const visibleLinks = (item.links || []).filter((link) => link.rel !== 'queue' && isSafeExternalUrl(link.url));
      if (visibleLinks.length) {
        const links = el('div', 'task-item-links');
        for (const link of visibleLinks) links.appendChild(buildLink(link));
        li.appendChild(links);
      }

      const isPending = !!getPending(item.id);
      if (isEditing) {
        li.appendChild(buildEditPanel(item, isPending));
      }

      const errorMessage = errors.get(item.id);
      if (isPending || errorMessage) {
        const feedback = el('div', 'task-item-feedback');
        if (isPending) {
          const p = el('span', 'task-item-pending');
          p.setAttribute('role', 'status');
          p.textContent = savingTasks.has(item.id) ? strings.savingPending : strings.pending;
          feedback.appendChild(p);
        }
        if (errorMessage) {
          const err = el('span', 'task-item-action-error');
          err.setAttribute('role', 'alert');
          err.textContent = errorMessage;
          feedback.appendChild(err);
        }
        li.appendChild(feedback);
      }
      return li;
    }

    function buildGroup(group, items) {
      const section = el('section', 'task-list-group');
      section.dataset.groupId = group.id;
      section.dataset.tone = contract.toneOrDefault(group.tone);

      const list = el('ul', 'task-list-items');
      for (const item of items) list.appendChild(buildItem(item, group));
      section.appendChild(list);
      return section;
    }

    /**
     * ウィジェットを groupsEl へ描画する。
     * @param {object|null} widget  サニタイズ済みウィジェット（null 可）
     * @param {{ now?: number }} [options]
     * @returns {object} 描画に付随する情報（chrome 更新用）
     */
    function render(widget, options = {}) {
      lastWidget = widget || null;
      // syncPending の前後で、消滅した編集対象アイテム由来の draft/pending を掃除する。
      cleanupEditorForWidget(lastWidget);
      syncPending(lastWidget);
      cleanupEditorForWidget(lastWidget);
      renderedEditButtons.clear();
      renderedPanels.clear();

      const now = (typeof options.now === 'number') ? options.now : Date.now();
      const stale = contract.isWidgetStale(lastWidget, { now });
      const viewer = lastWidget && lastWidget.viewer ? lastWidget.viewer : null;
      const githubMode = contract.isGithubMode(lastWidget);
      const filterEnabled = githubMode && !!viewer;

      const filterOptions = contract.deriveAssigneeFilterOptions(lastWidget, strings);
      const mode = filterEnabled
        ? contract.resolveAssigneeFilterMode(getFilterMode(), filterOptions)
        : 'all';

      groupsEl.replaceChildren();

      const groups = (lastWidget && Array.isArray(lastWidget.groups)) ? lastWidget.groups : [];
      const totalItems = contract.flatItems(lastWidget).length;
      let visibleItems = 0;
      let emptyReason = '';

      if (!lastWidget) {
        applyPendingFocus();
        return { stale, viewer, githubMode, filterEnabled, filterOptions, filterMode: mode, totalItems, visibleItems, emptyReason, emptyText: '' };
      }

      for (const group of groups) {
        const filtered = filterEnabled
          ? contract.applyAssigneeFilter(group.items, mode, viewer)
          : (group.items || []);
        if (!filtered.length) continue;
        visibleItems += filtered.length;
        groupsEl.appendChild(buildGroup(group, filtered));
      }

      if (visibleItems === 0 && !stale) {
        const empty = el('div', 'task-list-empty');
        if (totalItems === 0) emptyReason = lastWidget.emptyText || strings.empty;
        else if (mode === 'self') emptyReason = strings.emptySelf;
        else emptyReason = strings.emptyFiltered;
        empty.textContent = emptyReason;
        groupsEl.appendChild(empty);
      }

      applyPendingFocus();
      return {
        stale, viewer, githubMode, filterEnabled, filterOptions, filterMode: mode,
        totalItems, visibleItems, emptyReason, emptyText: lastWidget.emptyText || '',
      };
    }

    return {
      render,
      getLastWidget: () => lastWidget,
      hasPending: () => pending.size > 0,
      hasOpenEditor: () => editingTaskId !== null,
    };
  }

  return { createTaskWidgetView, joinConfirm, DEFAULT_STRINGS };
});
