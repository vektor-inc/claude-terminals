const { test, expect } = require('@playwright/test');
const fs = require('fs');
const os = require('os');
const path = require('path');
// 起動〜初期描画待ちは共通ヘルパーへ集約している（issue #263 / #269）。
const { closeApp, getFreePort, launchAppAndWait } = require('./helpers/electron-app');

// issue #470: タスク編集パネルの項目名ラベル（.widget-control-label）が、旧 68px
// 決め打ちの grid-template-columns に収まらず「/code-review」だけ2行に折り返して
// いた表示崩れの回帰テスト。
//
// 修正は renderer/style.css・renderer/mobile.css の .widget-control-label に
// `width: 13ch` を指定し、13ch がラベル自身のフォント（デスクトップ 11px/600、
// スマートフォン 12px/700）で解決されるようにしたこと（安藤レビュー「修正案A」＝
// 幅指定を親 .widget-control 側からラベル自身へ移す案。親側へ font-size /
// font-weight を複製する旧実装は、ラベルの文字サイズだけを変更する将来の変更で
// ch の基準がずれる二重定義の危険があったため廃止した）。
//
// このスペックはデスクトップ（サイドバーのタスク編集パネル）を対象に、次の3点を
// 検証する（tests/e2e/pane-title-pr-gap.smoke.spec.js の書き方・起動の作法を踏襲）。
//   1. .widget-control-label の全件が1行に収まること（issue #470 そのものの回帰確認）。
//   2. ラベルの文字が欄からあふれていないこと（overflow-wrap の安全網が効いている
//      ことの確認。getBoundingClientRect はボーダーボックスしか測らずあふれた文字
//      を捉えないため、scrollWidth と clientWidth の比較で見る）。
//   3. 全行の select 左端の x 座標が一致すること（ラベル列が固定幅で揃う設計意図の担保。
//      これがあると、1 で直した二重定義が将来また壊れたときにも検出できる）。

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), 'utf8');
}

function freshDate(offsetMs = 0) {
  return new Date(Date.now() + offsetMs).toISOString();
}

// 実際にパネルへ並ぶ6項目（vk-orchestrator 側のタスク編集パネルと同じラベル）。
// 「/code-review」（12文字）が旧 68px 決め打ちで折り返していた当事者。
function buildControl(field, label) {
  return {
    type: 'select',
    field,
    label,
    ariaLabel: label,
    current: 'default',
    options: [{ value: 'default', label: '全体設定に従う' }],
  };
}

function buildWidget() {
  return {
    schemaVersion: 1,
    kind: 'task-list',
    lang: 'ja',
    updatedAt: freshDate(),
    viewer: null,
    staleThresholdMs: 120000,
    emptyText: 'タスクはありません',
    groups: [
      {
        id: 'in-progress',
        label: '実行中',
        tone: 'progress',
        order: 0,
        items: [
          {
            id: '470',
            title: 'ラベル折り返し確認用タスク',
            updatedAt: freshDate(),
            editable: true,
            badges: [],
            links: [],
            controls: [
              buildControl('status', 'ステータス'),
              buildControl('priority', '優先度'),
              buildControl('sequential', '実行方式'),
              buildControl('automerge', '自動マージ'),
              buildControl('reviewCoderabbit', 'CodeRabbit'),
              buildControl('reviewCodeReview', '/code-review'),
            ],
          },
        ],
      },
    ],
  };
}

test('サイドバー: タスク編集パネルの項目名ラベルが1行に収まり select 列の左端が揃う（issue #470）', async () => {
  const port = await getFreePort();
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'vk-terminals-e2e-label-nowrap-'));
  const widgetFile = path.join(dataRoot, 'tasks-widget.json');
  writeJson(widgetFile, buildWidget());

  const { app, win, tmpRoot } = await launchAppAndWait({
    port,
    prefix: 'vk-terminals-e2e-label-nowrap-',
    config: { widgetFile },
  });
  try {
    const item = win.locator('.task-item[data-id="470"]');
    await expect(item).toBeVisible({ timeout: 10_000 });

    const editButton = item.locator('button.task-item-edit');
    await editButton.click();
    const panel = item.locator('.task-edit-panel');
    await expect(panel).toBeVisible();

    const rows = panel.locator('.widget-control');
    await expect(rows).toHaveCount(6);

    // ─── (1) 全ラベルが1行に収まる（issue #470 の回帰確認） ───
    const measurements = await panel.evaluate((panelEl) => {
      const rowEls = Array.from(panelEl.querySelectorAll('.widget-control'));
      return rowEls.map((row) => {
        const label = row.querySelector('.widget-control-label');
        const select = row.querySelector('.widget-control-select');
        const lineHeight = parseFloat(getComputedStyle(label).lineHeight);
        const labelRect = label.getBoundingClientRect();
        const selectRect = select.getBoundingClientRect();
        return {
          text: label.textContent,
          offsetHeight: label.offsetHeight,
          lineHeight,
          labelRight: labelRect.right,
          selectLeft: selectRect.left,
          scrollWidth: label.scrollWidth,
          clientWidth: label.clientWidth,
        };
      });
    });

    expect(measurements).toHaveLength(6);
    const codeReviewRow = measurements.find((m) => m.text === '/code-review');
    expect(codeReviewRow, '/code-review ラベルの行が見つかること').toBeTruthy();

    for (const m of measurements) {
      // 1行に収まっていれば offsetHeight は line-height の1倍程度。折り返すと
      // 2倍近くになるため、1.5倍を境目にする。
      expect(m.offsetHeight, `${m.text} のラベル高さが1行分に収まる`).toBeLessThan(m.lineHeight * 1.5);

      // レイアウト上、ラベル列と select 列が入れ替わっていないことの確認。
      // width: 13ch は確定値でラベルのボックスは必ずトラック内に収まるため、
      // このアサーション単体では「文字のあふれ」までは検出できない
      // （あふれの検出は下記 (2) の scrollWidth 比較で行う）。
      expect(m.labelRight, `${m.text} のラベル右端が select 左端を越えない`).toBeLessThanOrEqual(m.selectLeft);

      // ─── (2) ラベルの文字が欄からあふれていないこと（overflow-wrap の安全網が
      // 効いていることの確認）。getBoundingClientRect はボーダーボックスしか
      // 測らないため、はみ出しは scrollWidth で見る。+1 はサブピクセル丸めの吸収。
      expect(m.scrollWidth, `${m.text} のラベルが欄からあふれない`).toBeLessThanOrEqual(m.clientWidth + 1);
    }

    // ─── (3) 全行の select 左端の x 座標が一致する（固定幅ラベル列の設計意図） ───
    const selectLefts = measurements.map((m) => m.selectLeft);
    const firstLeft = selectLefts[0];
    for (const left of selectLefts) {
      expect(Math.abs(left - firstLeft), 'select 列の左端が全行で揃う').toBeLessThanOrEqual(0.5);
    }
  } finally {
    await closeApp({ app, tmpRoot });
    fs.rmSync(dataRoot, { recursive: true, force: true });
  }
});
