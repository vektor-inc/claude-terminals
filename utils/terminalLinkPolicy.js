'use strict';

// ─── ペイン内 URL を開く際の判定ポリシー（issue #349 → #385）─────────────────
// 元々は単クリックでは開かず、Cmd（macOS）/ Ctrl（Windows・Linux）+クリックのときだけ
// 開く仕様だった（issue #349・植草の確定仕様）。renderer/app.js の非エクスポート関数の
// ままだとユニットテストできず、将来のリファクタで壊れても気づけない状態だったため
// utils/closeConfirm.js と同じ理由で utils/ の UMD へ切り出した（安藤レビュー指摘・MEDIUM）。
//
// issue #385（オーナー本人の要望）で「修飾キー無しの単クリックで開く」へ仕様変更した。
// ただし従来挙動へ戻す設定（config.json の terminalLinkClickMode）も用意するため、
// 判定ロジックはモード分岐を持つ。config.json 側の正規化は normalizeTerminalLinkClickMode。
//
// #385 のレビュー（安藤・植草）で、単クリック化が開けた穴が複数見つかっている
// （右クリック・中クリックでも開いてしまう／URL をドラッグ選択しようとすると開いてしまう）。
// activate() のガードの並びと各コメントは、その指摘を踏まえたもの。安易に順序を
// 入れ替えたり削ったりしないこと。
//
// Node（require）とブラウザ（<script>）の両方から使える UMD 形式（issue #268）。
// renderer は nodeIntegration 無効のため require が無く、index.html が <script> で読む。
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.VKTerminalLinkPolicy = api;
  }
})(typeof self !== 'undefined' ? self : this, function () {

// macOS かどうかの判定。navigator.platform は非推奨だが、Electron が同梱する Chromium
// では引き続き利用でき、contextIsolation の影響を受けない標準 Web API のため preload
// 経由の橋渡しは不要。node --test など navigator が無い環境やテストでは
// platformOverride を明示的に渡す。
function isMacPlatform(platformOverride) {
  const platform = typeof platformOverride === 'string'
    ? platformOverride
    : ((typeof navigator !== 'undefined' && navigator.platform) || '');
  return /Mac|iPhone|iPod|iPad/i.test(platform);
}

// リンクを開く修飾キーが押されているか。macOS は Cmd（metaKey）、Windows・Linux は
// Ctrl（ctrlKey）（植草の確定仕様）。isMac 省略時は実行環境（isMacPlatform()）で判定する。
function isLinkOpenModifierPressed(event, isMac) {
  if (!event) return false;
  const mac = typeof isMac === 'boolean' ? isMac : isMacPlatform();
  return mac ? !!event.metaKey : !!event.ctrlKey;
}

// ─── terminalLinkClickMode（issue #385）────────────────────────────────────────
// config.json の terminalLinkClickMode で「単クリックで開く（既定）」/「従来どおり
// 修飾キー必須」を切り替える。未知の値・未設定は必ず 'click'（既定）に正規化する
// （utils/closeConfirm.js の normalizeConfirmClose と同じ形）。
const TERMINAL_LINK_CLICK_MODES = ['click', 'modifier'];
const DEFAULT_TERMINAL_LINK_CLICK_MODE = 'click';

function normalizeTerminalLinkClickMode(value) {
  return TERMINAL_LINK_CLICK_MODES.includes(value) ? value : DEFAULT_TERMINAL_LINK_CLICK_MODE;
}

// ─── ドラッグ距離の判定（issue #385 レビュー指摘・HIGH-2 / MEDIUM-B）─────────────────
// mousedown から mouseup までの移動距離がしきい値を超えたかどうかを判定する純粋関数。
// renderer/app.js は document への capture リスナーで from/to の座標を集めるだけにし、
// 距離計算そのものはここへ切り出してユニットテストで固定する（安藤の案）。
// from / to はどちらも { x, y }（ピクセル座標）。どちらか欠けている場合は「ドラッグでは
// ない」側（false）へ倒す。理由は下記 isDragDistance の呼び出し側コメント、および
// renderer/app.js の TERM_LINK_DRAG_THRESHOLD_PX の説明を参照。
function isDragDistance(from, to, threshold) {
  if (!from || !to) return false;
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  return Math.hypot(dx, dy) > threshold;
}

// term.registerLinkProvider() に渡すハンドラ一式を作る。
// 見た目（ホバー時の下線・pointer カーソル）は xterm.js 本体が自動で付けるため、ここでは
// 「クリックで開くべきかどうかの判定」と「ツールチップ表示への橋渡し」だけを扱う。
// 実際に URL を開く処理・ツールチップの DOM 操作そのものは呼び出し側（renderer/app.js）の
// 責務のまま、依存として注入してもらう（新しい経路を増やさない・DOM に依存しない形で
// このファイル単体をテストできるようにするため）。
//
// deps:
//   - openUrl(url): クリックが確定したときに呼ぶ（renderer/app.js の openExternalUrlSafe
//     を渡す想定。新しい「開く経路」は増やさない・issue #385）。
//   - showTooltip(event, url) / hideTooltip(event, url): ホバー時・ホバー解除時のツールチップ制御。
//   - isMac: テストで明示指定するための上書き（省略時は isMacPlatform()）。
//   - getClickMode(): 呼び出しの都度モード（'click' | 'modifier'。正規化前の値でよい。
//     ここで normalizeTerminalLinkClickMode() する）を取得する関数。省略時は 'click'（既定）。
//     生成時に固定値を1回だけ渡す形（旧 clickMode 引数）にはしていない。renderer/app.js
//     側にはツールチップ文言（termLinkTooltipMessage）が実行時に読む生きたグローバル変数
//     terminalLinkClickModePref があり、固定値を別途渡すとモード参照経路が2本に分かれ、
//     将来設定のライブリロードを入れた瞬間に「表示は単クリック、実際の判定は修飾キー必須」
//     のような食い違いが起きうる（レビュー指摘・LOW-2）。関数で毎回取りに行くことで
//     参照経路を1本化する。
//   - wasPaneFocused(): このクリックがフォーカスされていないペインへの最初のクリック
//     だったかどうかを呼び出し側が判定して返す関数（issue #385）。
//
//     【重要・呼び出し側が守るべき契約】xterm.js の Linkifier は mousedown 時点の
//     リンクと mouseup 時点のリンクが一致したときだけこの activate を呼ぶ（つまり
//     activate は実質「mouseup 時点」で発火する）。一方 renderer/app.js の focusPane()
//     は mousedown 契機でフォーカス状態を書き換える。そのため activate 発火時点の
//     「現在のフォーカス状態」を素直に読むと、同じクリックの mousedown で既にフォーカスが
//     切り替わった後の値になってしまい、「フォーカス未取得ペインへの最初のクリックか」を
//     判定できない。呼び出し側は、focusPane() を呼ぶ“前”の mousedown ハンドラで
//     「切り替わる直前の状態」を記録しておき、wasPaneFocused() はその記録値を返すこと
//     （renderer/app.js の paneFocusBeforeMousedown / recordPaneFocusBeforeMousedown 参照）。
//     グリッド（.pane）だけでなく格納ペイン（.stash-item）の mousedown からも同じ記録
//     ヘルパーを呼ぶこと（レビュー指摘・MEDIUM-1。ヘルパーを分けて片方でしか呼ばないと、
//     もう片方の経路でガードが機能しない・もしくは逆に常に開かなくなる）。
//
//     wasPaneFocused() が false を返した場合、activate() は preventDefault() を呼ばずに
//     openUrl の呼び出しだけをスキップする（xterm 本来のフォーカス移譲・カーソル配置を
//     妨げないため）。deps 省略時は false 相当（fail-closed）として扱う（レビュー指摘・
//     MEDIUM-2）。wasPaneFocused はこの issue #385 で新設した依存であり、世の中に既に
//     出回っている「渡し忘れたら true 扱いになる旧挙動」は存在しないため、渡し忘れを
//     安全側（開く）へ倒す理由が無い。渡し忘れ・接続ミスは黙って「開かない」側に倒し、
//     気づきやすくする。
//   - wasDragged(): このクリックがドラッグ選択だったかどうかを呼び出し側が判定して
//     返す関数（issue #385 レビュー指摘・HIGH-2）。
//
//     xterm.js の Linkifier の activate 発火条件は「mousedown 時点のリンクと mouseup
//     時点のリンクが一致し、かつ mouseup 位置がその範囲内」であることだけで、選択の
//     有無やポインタの移動量は一切見ない。これは「別々のリンクをまたぐドラッグ」だけで
//     なく「同一リンクの中をなぞって選択する（＝ URL をコピーしようとする）」操作も
//     満たしてしまう。つまり URL をコピーしようとドラッグしただけでブラウザが開く
//     （#349 で植草が避けたかった誤爆そのもの。以前このファイル・renderer/app.js に
//     あった「単クリックにしてもドラッグ選択とは元々衝突しない」という趣旨のコメントは、
//     この「同一リンク内のドラッグ」を見落とした誤った安全性の主張だったため削除した）。
//     xterm.js 本体はこの区別をしないため、呼び出し側（renderer/app.js）で mousedown から
//     mouseup までの移動量を isDragDistance() で計測し、判定結果をここへ渡してもらう。
//     deps 省略時は false 相当（＝ドラッグ扱いしない）として扱う。
//
//     【訂正・レビュー指摘 LOW-A】以前このコメントには「term.hasSelection() を使わず
//     移動距離方式にしたのは、xterm.js 内部で SelectionService の mouseup ハンドラが
//     Linkifier の mouseup ハンドラより先に走るとは限らない（実行順に依存する）ため」
//     という理由づけを書いていたが、これは事実として誤り。xterm.js の選択は
//     SelectionService._handleMouseMove（mousedown 時に document へ足される一時
//     リスナー）でドラッグ中に組み立てられ、mouseup の時点ではすでに確定している。
//     つまり hasSelection() は mouseup 同士の発火順序に依存せず、方式として使えなくは
//     ない。移動距離方式を選んだ正しい理由は、hasSelection() が xterm.js 内部の
//     選択実装（将来のバージョンで変わりうる非公開の詳細）に依存するのに対し、移動距離は
//     renderer/app.js 側の自前の document capture リスナーだけで完結し、xterm.js の
//     内部実装に一切依存しないため、かつ isDragDistance() のような座標だけを扱う純粋
//     関数としてユニットテストしやすいため。しきい値（4px）未満の極小な移動で
//     1〜2 文字だけ選択が成立する隙間は残るが、URL をコピーしようとする操作が
//     そこに収まることは実用上考えにくいため許容している（司・安藤合意）。将来この
//     隙間まで塞ぎたくなった場合は、移動距離の判定を `isDragDistance(...) ||
//     term.hasSelection()` のように OR で足す形が、既存の判定を壊さず安全。
function createTerminalLinkHandlers(deps) {
  const { openUrl, showTooltip, hideTooltip, isMac, getClickMode, wasPaneFocused, wasDragged } = deps || {};
  // 必須級の依存（フォーカスガード・ドラッグガードの実体）が渡されていない場合に警告する
  // （レビュー指摘・LOW-C）。wasDragged 側を「渡し忘れ＝常にドラッグ扱い（fail-closed）」
  // にはしない。それだと一切リンクを開けなくなり実用的でないため、渡し忘れに気づける
  // よう console.warn に留め、実際の判定は「ドラッグしていない」（false 相当）のまま進める。
  if (typeof wasPaneFocused !== 'function') {
    console.warn('[VKTerminalLinkPolicy] createTerminalLinkHandlers: wasPaneFocused が渡されていません。フォーカスガード（issue #385）が働かず、常に開かない（fail-closed）動作になります。');
  }
  if (typeof wasDragged !== 'function') {
    console.warn('[VKTerminalLinkPolicy] createTerminalLinkHandlers: wasDragged が渡されていません。ドラッグ選択のガード（issue #385 HIGH-2）が働きません。');
  }
  return {
    activate(event, url) {
      // 主ボタン（左クリック）以外では開かない（issue #385 レビュー指摘・HIGH-1）。
      // xterm.js の Linkifier は event.button を見ずに mouseup で activate を呼ぶため、
      // 右クリック・中クリック（Linux のプライマリ選択貼り付け操作を含む）でも無条件に
      // 呼ばれてしまう。'modifier' モードでは metaKey/ctrlKey 判定が偶然フィルタとして
      // 働いていたが、既定の 'click' モードにはそのフィルタが無いため、ここで明示的に弾く。
      if (event && typeof event.button === 'number' && event.button !== 0) return;

      // 2 回目以降のクリック（ダブルクリック＝単語選択・トリプルクリック＝行選択）では
      // 開かない（issue #385 レビュー指摘・MEDIUM-A）。xterm.js の Linkifier は
      // event.detail（クリック回数）も見ずに mouseup のたびに activate を呼ぶ。
      // ダブルクリックの2打目はマウスが動いていないため wasDragged() は false・
      // ボタンは 0 のままで、上のボタン種別ガード（および下のドラッグ判定ガード）を
      // どちらも素通りしてしまう。ダブルクリックでの
      // 単語選択・トリプルクリックでの行選択は URL をコピーする最も自然な操作の一つで、
      // HIGH-2（なぞって選択）と動機はまったく同じ。かつフォーカス済みペインでは
      // 1打目・2打目の両方で activate が呼ばれるため、対策しないと同じ URL のタブが
      // クリック回数ぶん重複して開く。
      if (event && typeof event.detail === 'number' && event.detail > 1) return;

      // ドラッグ選択では開かない（issue #385 レビュー指摘・HIGH-2。詳細は上の
      // wasDragged() の説明を参照）。
      if (typeof wasDragged === 'function' && wasDragged()) return;

      // フォーカス移動だけに使う最初のクリックでは開かない（issue #385）。
      const focused = typeof wasPaneFocused === 'function' ? wasPaneFocused() : false;
      if (!focused) return;

      // 'modifier' モードでは従来どおり修飾キー必須（このガードだけは仕様を変えない）。
      const mode = normalizeTerminalLinkClickMode(typeof getClickMode === 'function' ? getClickMode() : undefined);
      if (mode === 'modifier' && !isLinkOpenModifierPressed(event, isMac)) return;

      if (event && typeof event.preventDefault === 'function') event.preventDefault();
      if (typeof openUrl === 'function') openUrl(url);
    },
    hover(event, url) {
      if (typeof showTooltip === 'function') showTooltip(event, url);
    },
    leave(event, url) {
      if (typeof hideTooltip === 'function') hideTooltip(event, url);
    },
  };
}

return {
  isMacPlatform,
  isLinkOpenModifierPressed,
  TERMINAL_LINK_CLICK_MODES,
  DEFAULT_TERMINAL_LINK_CLICK_MODE,
  normalizeTerminalLinkClickMode,
  isDragDistance,
  createTerminalLinkHandlers,
};
});
