# Changelog

- [ 仕様変更 ] ペイン内 URL リンクの既定の開き方を修飾キー無しの単クリックへ変更（`terminalLinkClickMode` 設定で従来の ⌘/Ctrl+クリック必須の挙動にも戻せる）（[#385](https://github.com/vektor-inc/vk-terminals/issues/385)）

## 1.60.2

- [ 仕様変更 ] 設定パネルの各入力欄にある説明文を初期状態では隠し、ラベル横の `?` ボタンで開閉できるよう変更（[#383](https://github.com/vektor-inc/vk-terminals/issues/383)）

## 1.60.1

- [ 開発環境 ] e2e の `external-url-toast.smoke.spec.js` が PR バッジを `title` の完全一致で探しており、#364 の書式変更に追随できず失敗していたのを修正（[#379](https://github.com/vektor-inc/vk-terminals/issues/379)）

## 1.60.0

- [ 機能追加 ] 設定画面の説明ブロックに、今の入力値・保存済みの値を示す読み取り専用の表（`table`）と、複数の設定欄をまとめて切り替える一括切り替えボタン（`applyButton`）を追加（[#380](https://github.com/vektor-inc/vk-terminals/issues/380)）

## 1.59.1

- [ 開発環境 ] e2e の `stash-header` / `pr-badge-waiting-merge` / `new-pane-startup` spec で、同じ起動設定のテストが個別に Electron を起動していたのを1回の起動へ共有するよう変更し、全件実行時の Electron 起動回数を削減（[#377](https://github.com/vektor-inc/vk-terminals/issues/377)）

## 1.59.0

- [ 機能追加 ] VK Orchestrator の設定画面で条件に応じた項目の無効化と自由入力可能な候補選択欄を描画し、Codex のモデルを指定して新規ペインを起動できる機能を追加（[#374](https://github.com/vektor-inc/vk-terminals/issues/374)）
- [ 仕様変更 ] 1.58.0 で `engine` が `"codex"` のとき無視していた `POST /api/new-pane` の `model` を `codex --model` として渡すよう変更（不正な値はどちらのエンジンでも 400）（[#374](https://github.com/vektor-inc/vk-terminals/issues/374)）
- [ セキュリティ修正 ] ペイン起動時の確認プロンプトへの自動応答を意図した画面に限定（[#373](https://github.com/vektor-inc/vk-terminals/issues/373)）

## 1.58.0

- [ 機能追加 ] `POST /api/new-pane` に `engine`（`"claude"` / `"codex"`）パラメータを追加し、新規ペインで Codex を起動できるよう変更。`engine` が `"codex"` のときは `model` 指定を無視（警告ログを出力）し、未指定時は従来どおり claude を起動（[#367](https://github.com/vektor-inc/vk-terminals/issues/367)）
- [ 不具合修正 ] 罫線テーブル以外の通常のペイン出力で、URL がペイン幅ちょうどの位置で実改行により2行に割れると、1行目の断片だけがリンク化されクリックすると 404 になる不具合を修正。1行目がペイン幅いっぱいに埋まっている場合は次行の折り返し判定に関わらず連結するが、境界より前でホスト名を書き終えていない場合はホストのすり替わりを防ぐため断片も含め一切リンク化しないよう変更。なお URL がペイン最終列ちょうどで終わり次行が URL 構成文字で始まる場合に、無関係な次行の内容まで連結されうるのは意図して受け入れた副作用（[#368](https://github.com/vektor-inc/vk-terminals/issues/368)）
- [ 不具合修正 ] ペイン起動時の確認プロンプトへの自動応答が、意図した場面以外でも動きうる不具合を修正（[#371](https://github.com/vektor-inc/vk-terminals/issues/371)）

## 1.57.2

- [ 不具合修正 ] 罫線テーブルのセル内で URL がセル幅を超えて折り返されると、途中で切り詰められた断片だけがリンク化され、クリックすると 404 になる不具合を修正。あわせて、セル右端の URL の直後が縦線、または句読点（`.` `,` 等）だけを挟んだ縦線である場合は、切り詰めの有無に関わらずリンク化の対象外に変更（`(URL)` のように閉じ括弧で終わる場合は従来どおりリンク化）（[#361](https://github.com/vektor-inc/vk-terminals/issues/361)）
- [ 開発環境 ] devicePixelRatio が 1 以外の開発機だと Chromium の描画丸めで outline・border・要素サイズを固定値の完全一致で比較する e2e が 5 spec 同時に失敗する不具合を修正し、丸めを許容しつつ比較する共通ヘルパー `tests/e2e/helpers/focus-ring.js` を新設して対象 6 spec の比較方法を統一（[#357](https://github.com/vektor-inc/vk-terminals/issues/357)）

## 1.57.1

- [ 仕様変更 ] ペイン右上の PR ボタンからマージ待ちかどうかを読み取れず、サイドバーの「マージ待ち」表示と食い違っていたため、「PR が出ただけ（灰）／マージ待ち（青）／マージ済み（紫）」の3状態表示へ変更。これまで緑だった「PR が出ただけ」は灰色へ変更（[#363](https://github.com/vektor-inc/vk-terminals/issues/363)）
- [ デザイン不具合修正 ] サイドバーの格納カード内でマージ済みの PR ボタンが背景に沈み、文字を読み取りにくかったため、文字色・枠線を明るい色へ変更
- [ デザイン不具合修正 ] モバイル表示の PR ボタンの枠線が薄く、状態によって輪郭を視認しづらかったため、文字色と同じ濃さの枠線へ変更

## 1.57.0

- [ 機能追加 ] 設定パネルのタブに、入力欄グループより後ろへ描く説明ブロック（`tabs[].contentAfter`）を追加。入力欄を読み終えたあとに読ませたい補足を、タブの末尾へ置けるように変更

## 1.56.4

- [ 仕様変更 ] 設定パネルのタブ「外出先から確認」が、スマートフォンから見るためのタブだと名前から結び付きにくいため、「モバイルから確認」へ変更（あわせて他の設定項目の説明文・README の案内も新しいタブ名に更新）
- [ 仕様変更 ] 設定パネル「モバイルから確認」タブの「アクセストークン」欄で、設定に使う箇所が無いトークン本体が先頭に並び、実際に必要な「初回登録用の URL」が 1 クリック奥に隠れていたため、トークン本体の表示・コピーを廃止し、初回登録用 URL を伏せ字＋「表示」「コピー」の主役の欄へ変更
- [ デザイン不具合修正 ] 設定パネルの入力欄の説明文が、同じパネル内の「外出先から確認」タブの本文より暗く読み取りにくいため、本文と同じ明るさ（`#c9d1d9`）へ変更

## 1.56.3

- [ 仕様変更 ] 設定パネル「外出先から確認」タブの Tailscale IP の調べ方で、実際にはメニューバー / 通知領域のアイコンから確認できず場所が分からないため、案内を管理コンソール（Machines の一覧）と `tailscale ip -4` に整理
- [ 仕様変更 ] 設定パネル「外出先から確認」タブで、外出先から使うまでに必要な操作が Tailscale の概念説明や別の公開方法に挟まれて追いにくかったため、前半に手順 1〜4 だけを並べ、開けないときの確認点・Tailscale の説明・`tailscale serve` を使う方法・注意事項を後半へ移す構成へ変更

## 1.56.2

- [ 不具合修正 ] 数秒おきに1行だけ出力し続けるペインで「入力待ち」ラベルが誤って点くと、そのペインへ何か入力するまで消えず、本当に応答を待っているペインと見分けが付かない不具合を修正（[#352](https://github.com/vektor-inc/vk-terminals/issues/352)）

## 1.56.1

- [ 開発環境 ] e2e の spec を統合し、同じ起動条件のテストで Electron の起動を共有することで全件実行時の起動回数と壁時計時間を削減（[#348](https://github.com/vektor-inc/vk-terminals/issues/348)）

## 1.56.0

- [ 機能追加 ] ペイン内に表示された URL（http/https）を Cmd（macOS）・Ctrl（Windows / Linux）+クリックで既定のブラウザで開けるように追加（[#349](https://github.com/vektor-inc/vk-terminals/issues/349)）
- [ 開発環境 ] #343 の見出しアクセント撤廃・枠線色変更に e2e が追随できておらず 2 件失敗していたのを修正（[#344](https://github.com/vektor-inc/vk-terminals/issues/344)）
- [ 開発環境 ] e2e が高負荷時にアプリの起動待ちで詰まったとき、どの段で詰まったか分からない不具合を修正（[#347](https://github.com/vektor-inc/vk-terminals/issues/347)）

## 1.55.1

- [ 仕様変更 ] サイドバーの各セクション見出しから青い縦線のアクセントを外し、見出しの下とカード下端の余分な余白を詰めて表示するように変更
- [ 仕様変更 ] ボタン・セレクトボックス・入力欄の枠線色を、背景と見分けられる明るさを保ったまま一段落ち着いた色に変更

## 1.55.0

- [ 機能追加 ] `GET /api/states` の各ペイン情報に、そのペインでバックグラウンドに動いている Claude Code サブエージェント数を示す `backgroundAgents` を追加。画面から判定できない場合は `0` と区別して `null`（不明）を返す（[#340](https://github.com/vektor-inc/vk-terminals/issues/340)）
- [ 仕様変更 ] サイドバーの使用量・設定・見出し付きメニュー・タスク・格納したペインを見出しが判別しやすい共通カード表示に統一し、内容を持つカードを折り畳めるように変更（[#337](https://github.com/vektor-inc/vk-terminals/issues/337)）
- [ 不具合修正 ] 設定ファイルに文字列で書かれた項目（`workspace.search_paths` など）が設定画面のリスト欄で空欄に表示され、そのまま保存すると値が消えてしまう不具合を修正（[#339](https://github.com/vektor-inc/vk-terminals/issues/339)）

## 1.54.0

- [ 仕様変更 ] タスク一覧がサイドバーの地やペインと同じ色で領域の切れ目を読み取れなかったため、タスク一覧のセクションだけ背景を一段明るくして区別できるように変更（サイドバー・スマホ用ページの両方）

## 1.53.2

- [ 仕様変更 ] タスク一覧の「orchestrator 停止中」表示が製品名の表記と揃っていなかったため、頭文字を大文字にして「Orchestrator 停止中」に統一
- [ セキュリティ修正 ] HTTP API（スマホ用ページ・外部連携の窓口）が、認証不要時に接続先を示す Host ヘッダを待ち受け先と照合し、想定外の名前を経由したアクセスを拒否するように修正（[#322](https://github.com/vektor-inc/vk-terminals/issues/322)）

## 1.53.1

- [ 開発環境 ] 設定パネルの説明部品に未対応の種別名が指定されたとき、該当するタブ・位置・種別名をテストで検出する仕組みを追加（[#333](https://github.com/vektor-inc/vk-terminals/issues/333)）

## 1.53.0

- [ 仕様変更 ] 外部ブラウザを開けなかったときに、画面右下のトーストで知らせて URL のコピー操作を提供するように変更（[#326](https://github.com/vektor-inc/vk-terminals/issues/326)）
- [ 仕様変更 ] 起動に必要なファイルの読み込みに失敗したとき、原因（場所を特定できない／読み込み失敗／表示スタイルを読み込めない）ごとに案内文を出し分けるように変更（[#326](https://github.com/vektor-inc/vk-terminals/issues/326)）
- [ 不具合修正 ] 設定パネルのチェックボックスをキーボードで選んだときにフォーカス位置を示す枠が表示されない不具合を修正（[#291](https://github.com/vektor-inc/vk-terminals/issues/291)）
- [ 不具合修正 ] タイトルバー右端の ⚙（設定を開く）ボタンやペインヘッダーの操作ボタンなど、キーボードで選んだときにフォーカス位置を示す枠が表示されない対話部品があった不具合を修正。今後追加する部品にも自動で枠が付くよう仕組みを変更（[#302](https://github.com/vektor-inc/vk-terminals/issues/302)）
- [ セキュリティ修正 ] HTTP API（スマホ用ページ・外部連携の窓口）にアクセストークンによる認証を追加。既定の `127.0.0.1` で待ち受けている場合の動作は従来どおりで、外出先から使う設定にしたときのみ認証が必須（[#313](https://github.com/vektor-inc/vk-terminals/issues/313)）
- [ セキュリティ修正 ] 起動時に必要なファイル（xterm 本体・xterm.css・エージェントルームのスプライト）の読み取りをアプリ本体（main プロセス）側へ集約し、画面表示側の OS レベルのサンドボックスを有効化（[#323](https://github.com/vektor-inc/vk-terminals/issues/323)）
- [ セキュリティ修正 ] 画面表示側に CSP（コンテンツセキュリティポリシー）を設定し、注入されたスクリプトが実行されないこと・外部サイトを iframe で枠内に埋め込めないことを追加で保護。スマホ用ページ（外出先から確認）には、他サイトからの iframe 埋め込みを拒否する設定も追加（[#324](https://github.com/vektor-inc/vk-terminals/issues/324)）
- [ 開発環境 ] 設定パネル系 e2e のスタブが、保存・設定定義の読み込み以外のやり取りをアプリの実装へ委譲するか選べていた設定（`passthroughOtherChannels`）を廃止。設定定義を差し替えたかどうかで自動的に決まる規則へ統一し、あわせて委譲が必要な spec に「委譲が壊れると検知できる」検証を追加（[#304](https://github.com/vektor-inc/vk-terminals/issues/304)）
- [ その他 ] クリップボードへコピーしてよい文字数の上限が preload.js と main.js に別々に定義されていたのを、`utils/clipboardLimits.js` の 1 箇所へ集約（表示・動作上の変化なし）（[#325](https://github.com/vektor-inc/vk-terminals/issues/325)）

## 1.52.0

- [ 機能追加 ] `POST /api/new-pane` で新規ペインを開くとき、そのペインで起動する Claude Code のモデルを呼び出し側から指定できる `model` を追加（[#310](https://github.com/vektor-inc/vk-terminals/issues/310)）

## 1.51.0

- [ 不具合修正 ] 設定パネルやペインを閉じる確認の表示中に Tab キーで背後のペインの ✕ やメニューボタンを操作できてしまう不具合を修正。あわせて設定パネルを開いたときにパネル内へフォーカスが入るように変更（[#282](https://github.com/vektor-inc/vk-terminals/issues/282)）
- [ 開発環境 ] e2e の背景クリック抑止テストが、マシン負荷によってラベル上のドラッグが範囲選択にならず失敗することがあったのを、モーダル内の mousedown が抑止されていないことを直接確かめる形へ変更（[#294](https://github.com/vektor-inc/vk-terminals/issues/294)）
- [ 開発環境 ] 設定パネル系 e2e の設定データ差し込み処理を共通ヘルパーへ集約（[#293](https://github.com/vektor-inc/vk-terminals/issues/293)）
- [ 開発環境 ] 「入力待ち」バッジが出力の停止から一定時間後に点灯することを確かめる e2e が、マシン負荷が高いときに画面表示の遅れで時間差を実際より短く測って失敗することがあったのを、画面に表示された時刻ではなく点灯時に記録した時刻どうしを比べる形へ変更（[#270](https://github.com/vektor-inc/vk-terminals/issues/270)）
- [ その他 ] キーボードで選んだときに表示される青い枠について、内部の指定方法を CSS 変数へ集約（表示上の変化なし）（[#292](https://github.com/vektor-inc/vk-terminals/issues/292)）

## 1.50.0

- [ 仕様変更 ] 設定パネルの「キャンセル」「閉じる」「保存」・ヘッダーの ✕・パスワードの表示切替ボタン・タブの内容領域で、キーボードで選んだときの枠が OS 標準の枠になっていたのを、アプリ内の他の部分と同じ青い枠に統一（[#280](https://github.com/vektor-inc/vk-terminals/issues/280)）
- [ 仕様変更 ] 設定パネルの説明タブで、押した先に表示できる内容が無い移動ボタンを表示しないように変更（[#275](https://github.com/vektor-inc/vk-terminals/issues/275)）
- [ 不具合修正 ] 設定パネルで注記だけを表示するタブに「このタブに表示できる設定項目はありません。」の案内が併記され、注記に書いた代わりの設定方法が無効な情報のように見える不具合を修正（[#275](https://github.com/vektor-inc/vk-terminals/issues/275)）
- [ 不具合修正 ] 設定パネルで設定項目が無いグループだけを持つタブを開くと、グループ名も案内も表示されず枠線だけが表示される不具合を修正（[#275](https://github.com/vektor-inc/vk-terminals/issues/275)）
- [ 開発環境 ] e2e の全 spec を共通の Electron 起動ヘルパーへ移行し、マシン負荷が高いときの起動待ちタイムアウトによる失敗と、起動に失敗した際の一時ディレクトリ・Electron プロセスの取り残しを解消（[#269](https://github.com/vektor-inc/vk-terminals/issues/269)）

## 1.49.0

- [ セキュリティ修正 ] 画面表示側から Node.js・Electron の機能へ直接アクセスできない構成に変更し、ターミナル出力や外部から受け取った文字列の表示処理に不備があってもパソコン上で任意のコマンドが実行されない状態に修正（[#268](https://github.com/vektor-inc/vk-terminals/issues/268)）
- [ セキュリティ修正 ] 設定項目のキーに `__proto__` などの特別な名前を含む設定を読み込むと、設定の保存処理でアプリ内部のあらゆるデータが書き換わりうる問題を修正（[#273](https://github.com/vektor-inc/vk-terminals/issues/273)）

## 1.48.0

- [ 機能追加 ] 設定パネルの「外出先から確認」に、API サーバーが実際に待ち受けているアドレスと起動エラーを表示する機能を追加（[#261](https://github.com/vektor-inc/vk-terminals/issues/261)）
- [ 仕様変更 ] 設定パネルで説明コンテンツも設定グループも無いタブに、表示できる設定項目が無いことを示すメッセージを追加（[#258](https://github.com/vektor-inc/vk-terminals/issues/258)）
- [ 不具合修正 ] 設定項目のキーが重複したとき、移動ボタンで案内された欄への入力ではなく別の欄の値が保存される不具合を修正（[#258](https://github.com/vektor-inc/vk-terminals/issues/258)）
- [ 不具合修正 ] 設定パネルの描画中にエラーが起きると、アプリを再起動するまで設定を開けなくなる不具合を修正（[#259](https://github.com/vektor-inc/vk-terminals/issues/259)）
- [ 不具合修正 ] 設定パネルやペインを閉じる確認を Escape キーで閉じると、背後のサイドバーまで閉じてメニューボタンへフォーカスが移る不具合を修正。あわせて、これらを閉じたときは開くのに使ったボタンへフォーカスが戻るように変更（[#257](https://github.com/vektor-inc/vk-terminals/issues/257)）
- [ デザイン不具合修正 ] 設定パネルのコードブロックで長いコマンドが横スクロールになり、ポインタを使えない場合にはみ出した部分を読めない問題を、枠内で折り返して全文を読めるように修正（[#267](https://github.com/vektor-inc/vk-terminals/issues/267)）
- [ デザイン不具合修正 ] 設定パネルの「キャンセル」「閉じる」とパスワード表示切替ボタンの枠線が背景と近く、ボタンの範囲が分かりにくい問題を修正（[#267](https://github.com/vektor-inc/vk-terminals/issues/267)）
- [ デザイン不具合修正 ] 設定パネルの「保存」ボタンに緑の枠線が表示されず、ボタンの輪郭がぼやけて見える問題を修正（[#267](https://github.com/vektor-inc/vk-terminals/issues/267)）
- [ 開発環境 ] e2e を全件連続実行するとマシン負荷が高いときに一部のテストがタイムアウトで落ちる問題を修正（[#263](https://github.com/vektor-inc/vk-terminals/issues/263)）

## 1.47.0

- [ 機能追加 ] 設定パネルの説明コンテンツのコードブロックに、コマンドを手打ちせずに貼り付けられるコピーボタンを追加（[#262](https://github.com/vektor-inc/vk-terminals/issues/262)）
- [ 機能追加 ] 設定パネルの説明コンテンツ（`tabs[].content`）の見出しに `level`（3 または 4）を指定できるようにし、親セクションと子セクションの階層を表現できるように追加（[#260](https://github.com/vektor-inc/vk-terminals/issues/260)）
- [ 仕様変更 ] 設定パネル「外出先から確認」タブの「方法 1」「方法 2」を「外出先から開く 2 つの方法」の子見出しにし、見出しの大きさと余白で親子関係が分かるように変更（[#260](https://github.com/vektor-inc/vk-terminals/issues/260)）
- [ デザイン不具合修正 ] 設定パネルの説明タブで、別タブへの移動ボタンの直後に来る見出しだけ上の余白が広くなり、余白で示している見出しの階層が崩れる問題を修正（[#260](https://github.com/vektor-inc/vk-terminals/issues/260)）

## 1.46.0

- [ 仕様変更 ] ペインの「入力待ち」判定を、出力のたびではなく出力が止まった時点で行うように変更（点灯まで最大数秒遅れる代わりに、作業中の誤検知が減り作業再開で自動解除）（[vektor-inc/vk-orchestrator#212](https://github.com/vektor-inc/vk-orchestrator/issues/212)）
- [ 不具合修正 ] AI が作業中でも進捗報告の「〜を待っています」という文言に反応してペインが「入力待ち」になり、作業が再開しても表示が張り付いたままになる不具合を修正（[vektor-inc/vk-orchestrator#212](https://github.com/vektor-inc/vk-orchestrator/issues/212)）

## 1.45.0

- [ 機能追加 ] 設定パネルに、Tailscale 経由で外出先のスマートフォンからモバイルページを開く手順を案内する読み取り専用タブ「外出先から確認」を追加（[#245](https://github.com/vektor-inc/vk-terminals/issues/245)）
- [ 機能追加 ] 設定ディスクリプタのタブに、入力欄を持たない説明コンテンツ（`tabs[].content`）を定義できるように追加（[#245](https://github.com/vektor-inc/vk-terminals/issues/245)）
- [ 仕様変更 ] 設定パネルの保存が入力内容の問題で止まったとき、対象の入力欄を画面の端ではなく中央に寄せて表示するように変更（[#245](https://github.com/vektor-inc/vk-terminals/issues/245)）
- [ 仕様変更 ] 設定パネルの保存後にタブ移動や入力を続けている間は自動で閉じず、操作中にパネルが消えないように変更（[#245](https://github.com/vektor-inc/vk-terminals/issues/245)）
- [ 不具合修正 ] 設定パネルの保存後に残った自動クローズ処理が、開き直した後のパネルに作用して二重オープンの抑止を解除し、設定パネルが 2 枚重なって開いてしまう不具合を修正（[#245](https://github.com/vektor-inc/vk-terminals/issues/245)）
- [ デザイン不具合修正 ] 設定パネルのグループ見出しがリンクと同じ青で表示され、押せる要素に見えてしまう問題を修正（[#245](https://github.com/vektor-inc/vk-terminals/issues/245)）

## 1.44.0

- [ 機能追加 ] タスク編集フォームの自動マージ選択を宣言的ウィジェットで受け付けるように追加（[#254](https://github.com/vektor-inc/vk-terminals/issues/254)）

## 1.43.0

- [ 機能追加 ] モバイル版タスク一覧に GitHub モード時の担当者フィルタ（デフォルト「自分のみ」）と表示/全体の件数表示を追加（[#232](https://github.com/vektor-inc/vk-terminals/issues/232)）

## 1.42.0

- [ 仕様変更 ] サイドバー・モバイルのタスクカードでステータスをカード先頭バッジに戻し、Issue チップを廃止してタイトルリンクへ変更（[#251](https://github.com/vektor-inc/vk-terminals/issues/251)）

## 1.41.0

- [ 仕様変更 ] サイドバーのタスク編集を、プルダウンを選ぶと即反映する方式から、編集ボタンで展開し保存/キャンセルでまとめて確定する方式に変更（[#248](https://github.com/vektor-inc/vk-terminals/issues/248)）

## 1.40.0

- [ 仕様変更 ] モバイル版の実行中ステータス色をサイドバーと同じ緑系に統一（[#238](https://github.com/vektor-inc/vk-terminals/issues/238)）
- [ その他 ] サイドバー・モバイルのステータス属性と宣言的ウィジェットの tone CSS トークンを共通化（[#238](https://github.com/vektor-inc/vk-terminals/issues/238)）
- [ その他 ] PR バッジの表示ロジック（アイコン・aria・merged 判定）をサイドバーとモバイルで共有モジュール化（[#239](https://github.com/vektor-inc/vk-terminals/issues/239)）

## 1.39.0

- [ 機能追加 ] 設定パネルのタブごとに保存後の反映タイミングの案内文（note）を出し分けるように追加（[#240](https://github.com/vektor-inc/vk-terminals/issues/240)）
- [ 仕様変更 ] サイドバー／モバイルのタスク一覧を、vk-orchestrator が書き出す宣言（tasks-widget.json）を描画する汎用ウィジェット方式に刷新（[#229](https://github.com/vektor-inc/vk-terminals/issues/229)）
- [ 仕様変更 ] サイドバー・モバイルのターミナル表示制御、URL 安全判定、ステータス表示を共有モジュールへ集約（[#237](https://github.com/vektor-inc/vk-terminals/issues/237)）
- [ その他 ] モバイルページのインライン JS を外部ファイル（renderer/mobile.js・mobilePreviewText.js）に分離し、プレビュー整形関数のテストを正規表現抽出から require に変更（[#230](https://github.com/vektor-inc/vk-terminals/issues/230)）

## 1.38.0

- [ 機能追加 ] サイドバーのタスク一覧に GitHub モード時の担当者フィルタ（デフォルト「自分のみ」）を追加（[#226](https://github.com/vektor-inc/vk-terminals/issues/226)）
- [ 機能追加 ] サイドバーのタスク一覧の見出しを、GitHub モード時に task-queue の issue 一覧ページへのリンクにするように追加（[#233](https://github.com/vektor-inc/vk-terminals/issues/233)）
- [ 仕様変更 ] サイドバーのタスク一覧の開閉を、見出し右端の独立トグルボタンに変更（[#226](https://github.com/vektor-inc/vk-terminals/issues/226)）

## 1.37.0

- [ 機能追加 ] モバイル版に Codex CLI の使用量（使用率%・トークン数）を表示する機能を追加（[#218](https://github.com/vektor-inc/vk-terminals/issues/218)）
- [ 機能追加 ] モバイル版のタスク一覧に優先度・実行方式（直列/並列）の編集機能を追加（[#219](https://github.com/vektor-inc/vk-terminals/issues/219)）
- [ 機能追加 ] モバイル版のペイン一覧下部に、新規ペインを開く「ペインを追加」ボタンを追加（[#217](https://github.com/vektor-inc/vk-terminals/issues/217)）
- [ 機能追加 ] サイドバーのタスク一覧で GitHub モード時に issue 名から task-queue の issue へのリンクを表示するように追加（[vk-orchestrator#177](https://github.com/vektor-inc/vk-orchestrator/issues/177)）
- [ 仕様変更 ] モバイル版のタスク一覧のステータス編集を、PC 版と同じ編集パネル方式（保存で変更をまとめて反映）に統一（[#219](https://github.com/vektor-inc/vk-terminals/issues/219)）
- [ 仕様変更 ] 設定保存時のメッセージと注記を、設定が次回の起動から反映される旨が伝わる文言に変更（[#222](https://github.com/vektor-inc/vk-terminals/issues/222)）
- [ 開発環境 ] e2e テストを非表示ウィンドウ・並列実行で高速化し、実行中の PC 操作を妨げないように改善（[#227](https://github.com/vektor-inc/vk-terminals/issues/227)）

## 1.36.0

- [ 機能追加 ] サイドバーに Codex CLI の使用量（使用率%・トークン数）を表示する機能を追加（[#215](https://github.com/vektor-inc/vk-terminals/issues/215)）

## 1.35.0

- [ 機能追加 ] 設定フォームに他の設定値へ応じて項目の表示を切り替える汎用機能（visibleWhen）を追加（[#213](https://github.com/vektor-inc/vk-terminals/issues/213)）

## 1.34.0

- [ 仕様変更 ] サイドバーのタスク一覧でステータスをラベル表示にし、編集パネルの保存で変更をまとめて反映するように変更（[#211](https://github.com/vektor-inc/vk-terminals/issues/211)）

## 1.33.0

- [ 仕様変更 ] VK Terminals 単独起動時はサイドバー・モバイルのタスク一覧を表示しないように変更（[#208](https://github.com/vektor-inc/vk-terminals/issues/208)）

## 1.32.0

- [ 仕様変更 ] タスク一覧のステータス操作を操作ボタンからステータス名のプルダウン選択へ変更（[#207](https://github.com/vektor-inc/vk-terminals/issues/207)）

## 1.31.0

- [ 機能追加 ] タスク一覧で優先度・直列/並列の表示とデスクトップ版の編集 UI、差し戻し操作を追加（[#205](https://github.com/vektor-inc/vk-terminals/issues/205)）
- [ 仕様変更 ] 未着手タスクのステータス操作ボタンを編集パネル内へ集約するように変更（[#205](https://github.com/vektor-inc/vk-terminals/issues/205)）
- [ 仕様変更 ] タスク操作の反映待ち表示を、反映確認まで維持し反映されない場合は再試行案内を表示するように変更（[#205](https://github.com/vektor-inc/vk-terminals/issues/205)）

## 1.30.0

- [ 機能追加 ] サイドバー・モバイルのタスク一覧を見出しクリックで折り畳めるようにし、折り畳み状態を保持する機能を追加
- [ 仕様変更 ] サイドバー・モバイルのタスク一覧からグループ見出し（ステータス名）と経過時間の表示を削除
- [ 開発環境 ] タスク一覧の折り畳み動作を検証する e2e テストを追加

## 1.29.0

- [ 機能追加 ] サイドバーに `tasks-view.json` を読み取り専用で表示するタスク一覧セクションを追加
- [ 機能追加 ] サイドバーのタスク一覧に承認・保留・完了・リトライ・取り下げの操作ボタンを追加し、ステータス変更依頼を vk-orchestrator の commands.jsonl へ追記できる機能を追加
- [ 機能追加 ] モバイルページに `GET /api/tasks` を追加し、タスク一覧（ステータス・担当・経過時間）を表示するセクションを追加
- [ 機能追加 ] モバイルページからステータス変更依頼（承認・保留・完了・リトライ・取り下げ）を commands.jsonl へ追記できる `POST /api/tasks/set-status` と操作 UI を追加
- [ 開発環境 ] `GET /api/tasks`・`POST /api/tasks/set-status` のモバイル向け e2e スモークテストを追加

## 1.28.0

- [ 不具合修正 ] 起動時の初回ペインが「新規ペインを開く時の初期ディレクトリ」（newPaneStartupDir）設定を参照せず常にホームディレクトリで開く問題を修正（[#196](https://github.com/vektor-inc/vk-terminals/issues/196)）

## 1.27.0

- [ 仕様変更 ] 設定画面のサイドバーメニュー項目の説明文に用途の説明を追加し、例と改行して表示するように変更
- [ 仕様変更 ] 設定画面の追加ペイン項目の説明文に用途・cwd・noClaude の説明を追加
- [ 仕様変更 ] 入力待ち判定から除外する cwd パターン設定（waitingExcludeCwdPatterns）を設定 GUI から外し、config.json 直編集専用に変更（[#192](https://github.com/vektor-inc/vk-terminals/issues/192)）
- [ 開発環境 ] waitingExcludeCwdPatterns の GUI 表示を検証する e2e テストを「GUI に表示されないこと」の確認へ変更（[#192](https://github.com/vektor-inc/vk-terminals/issues/192)）

## 1.26.0

- [ 仕様変更 ] 設定パネルの組み込み項目定義を `settings-schema.json` に切り出し、外部起動側から再利用できるように変更（[#189](https://github.com/vektor-inc/vk-terminals/issues/189)）
- [ デザイン不具合修正 ] 設定モーダルのタブ付き表示で保存ヒント文言が語の途中で不自然に改行される問題を修正（[#187](https://github.com/vektor-inc/vk-terminals/issues/187)）

## 1.25.0

- [ 機能追加 ] ペインの cwd パターン指定でローカル入力待ち判定から除外できる設定を追加（[#183](https://github.com/vektor-inc/vk-terminals/issues/183)）
- [ 機能追加 ] 実行中・入力待ちのペインを誤って閉じないよう、ペインを閉じる時に確認ダイアログを表示する機能を追加（設定 `confirmClose`: 実行中・入力待ちのみ確認（既定）／常に確認／確認なし。HTTP API 経由の自動クローズは対象外）（[#184](https://github.com/vektor-inc/vk-terminals/issues/184)）
- [ 開発環境 ] cwd パターン指定によるローカル入力待ち判定除外のユニットテストを追加（[#183](https://github.com/vektor-inc/vk-terminals/issues/183)）
- [ 開発環境 ] cwd パターン除外の動作と設定画面の入力欄表示を検証する e2e スモークテストを追加（[#183](https://github.com/vektor-inc/vk-terminals/issues/183)）
- [ 開発環境 ] ペインを閉じる確認ダイアログ（confirmClose）の never / busy / always を検証する e2e テストを追加（[#184](https://github.com/vektor-inc/vk-terminals/issues/184)）

## 1.24.0

- [ 仕様変更 ] モバイル版ターミナル下部のクイック入力コントロール（1/2/3/Enter/Yes/No/Esc/Ctrl-C）を使わないため削除（[#181](https://github.com/vektor-inc/vk-terminals/issues/181)）
- [ 開発環境 ] モバイル版ターミナル下部のクイック入力コントロール削除（#181）を検証する e2e 回帰テストを追加（[#181](https://github.com/vektor-inc/vk-terminals/issues/181)）

## 1.23.0

- [ 機能追加 ] 設定パネル descriptor に改行区切りテキストエリアから文字列配列を保存できる `lines` 入力型を追加（[#179](https://github.com/vektor-inc/vk-terminals/issues/179)）

## 1.22.0

- [ 機能追加 ] 呼び出し元が環境変数 `VK_TERMINALS_INSTANCE_ID` を渡すと、`GET /api/health` のレスポンスに起動インスタンス識別子（`instanceId`）を含める機能を追加（未指定時は従来どおり `instanceId` を含めない）（[#177](https://github.com/vektor-inc/vk-terminals/issues/177)）

## 1.21.0

- [ 機能追加 ] HTTP API から指定ペインを閉じられないよう保護するペインのロック機能を追加（[#173](https://github.com/vektor-inc/vk-terminals/issues/173)）
- [ 不具合修正 ] モバイル版でペインのタイトルをタップしても元のリンクに遷移せずターミナルが開閉する不具合を修正（[#174](https://github.com/vektor-inc/vk-terminals/issues/174)）
- [ 開発環境 ] ペインのロック機能（閉じる保護）を検証する e2e テストを追加（[#173](https://github.com/vektor-inc/vk-terminals/issues/173)）

## 1.20.0

- [ 仕様変更 ] 新規起動時にサイドバー（メニュー）を開いた状態で起動するように変更（[#169](https://github.com/vektor-inc/vk-terminals/issues/169)）
- [ 開発環境 ] サイドバーの起動時表示状態と閉状態の漏れ防止を検証する e2e テストを追加・更新（[#169](https://github.com/vektor-inc/vk-terminals/issues/169)）
- [ 開発環境 ] リリース（タグ push）時に vk-orchestrator へ依存追従を通知する repository_dispatch ステップを追加（PAT シークレット未設定時は no-op）

## 1.19.0

- [ 機能追加 ] 本体 config の `port` を API サーバーの待受ポートとして利用できる設定を追加（環境変数 `VK_TERMINALS_API_PORT` 指定時は従来どおり優先）
- [ 機能追加 ] 設定ディスクリプタの `tabs` 定義に対応し、設定パネルをタブ UI で表示できる機能を追加（[#167](https://github.com/vektor-inc/vk-terminals/issues/167)）

## 1.18.1

- [ デザイン不具合修正 ] ペインタイトルと PR ボタンが余白なく密着してしまう表示崩れを、両者の間に 10px の余白を確保して修正（[#161](https://github.com/vektor-inc/vk-terminals/issues/161)）
- [ 開発環境 ] ペインタイトルと PR ボタンの余白（#161）が密着に戻るのを検知する e2e 回帰テストを追加（[#161](https://github.com/vektor-inc/vk-terminals/issues/161)）
- [ 開発環境 ] タグ push をトリガーに GitHub Release（リリースノート＝CHANGELOG 抽出、リリースファイル＝ソース zip 自動添付）を自動生成する Workflow を追加（[#162](https://github.com/vektor-inc/vk-terminals/issues/162)）

## 1.18.0

- [ 機能追加 ] 呼び出し元が環境変数 `VK_TERMINALS_APP_TITLE` を渡すと、デスクトップとモバイル双方のヘッダー／タイトルのアプリ名を任意の名称に上書きできる機能を追加（未指定時は従来どおり `VK Terminals`）
- [ 機能追加 ] 設定パネルをセクション（group）ごとに別ファイルへ読み書きできるようマルチターゲット対応（[#158](https://github.com/vektor-inc/vk-terminals/issues/158)）

- [ デザイン不具合修正 ] モバイル版のターミナルカード開閉インジケータを、展開／折りたたみ状態に応じた表示と枠付きデザインに調整（[#154](https://github.com/vektor-inc/vk-terminals/issues/154)）

- [ 開発環境 ] 設定ラベル簡略化（#156）に伴い更新漏れしていた新規ペイン起動設定の e2e テスト期待値を現行ラベルに合わせて修正

## 1.17.1

- [ 開発環境 ] モバイルプレビュー高さ縮小（#141）に伴い更新漏れしていた e2e テストの期待値を現行仕様（min-height 140px）に合わせて修正（[#145](https://github.com/vektor-inc/vk-terminals/issues/145)）
- [ 開発環境 ] モバイル版の外部 CSS 化のデグレ（`/mobile.css` の 404 による無スタイル化）を検知する e2e 回帰テストを追加（[#152](https://github.com/vektor-inc/vk-terminals/issues/152)）
- [ その他 ] モバイル版のインライン CSS を外部ファイル（mobile.css）へ分離しメンテナンス性を向上（[#152](https://github.com/vektor-inc/vk-terminals/issues/152)）

## 1.17.0

- [ 機能追加 ] UI から開く新規ペインの初期ディレクトリと Claude Code 自動起動有無を設定できる項目を追加（[#143](https://github.com/vektor-inc/vk-terminals/issues/143)）
- [ 仕様変更 ] モバイル版のペイン上下入れ替えアイコンを ▲▼ から ↑↓ に変更（[#148](https://github.com/vektor-inc/vk-terminals/issues/148)）
- [ デザイン不具合修正 ] モバイル版のターミナルカード開閉インジケータが小さく気づきにくい問題を、サイズと色の調整で視認しやすく修正（[#146](https://github.com/vektor-inc/vk-terminals/issues/146)）

## 1.16.0

- [ 機能追加 ] モバイル版の最下部に VK Terminals のバージョンを表示（[#135](https://github.com/vektor-inc/vk-terminals/issues/135)）
- [ 機能追加 ] 設定ダイアログのテキスト入力に形式チェックを追加し、`<owner>/<repo>` 等の不正な形式のまま保存されるのを防止（[#140](https://github.com/vektor-inc/vk-terminals/issues/140)）
- [ 仕様変更 ] モバイル版のペインプレビュー表示領域の高さを約70%に縮小（[#139](https://github.com/vektor-inc/vk-terminals/issues/139)）
- [ デザイン不具合修正 ] サイドバー格納時とモバイル版でマージ済み PR ラベルが紫にならず緑のままになる不具合を修正（[#137](https://github.com/vektor-inc/vk-terminals/issues/137)）

## 1.15.5

- [ 不具合修正 ] モバイル版のペインプレビューで Claude Code の位置指定再描画により直近の本文行が表示されない不具合を修正（[#132](https://github.com/vektor-inc/vk-terminals/issues/132)）
- [ 不具合修正 ] モバイル版のペインプレビューで出力が少ないと表示領域が1行分に潰れて内容が読めない不具合を、最低表示高さ（約10行分）を確保して修正（[#134](https://github.com/vektor-inc/vk-terminals/issues/134)）

## 1.15.4

- [ 仕様変更 ] モバイル版のペインプレビュー表示領域を拡大し、展開時・新着時に最新位置を見やすいように変更（[#130](https://github.com/vektor-inc/vk-terminals/issues/130)）
- [ 不具合修正 ] モバイル版のペインプレビューで末尾の罫線再描画により直近の出力がほとんど表示されない不具合を修正（[#130](https://github.com/vektor-inc/vk-terminals/issues/130)）
- [ その他 ] モバイルページの閲覧・操作のセットアップ手順（apiHost 設定・スマートフォンからのアクセス方法・セキュリティ注意）を README に追記（[#128](https://github.com/vektor-inc/vk-terminals/issues/128)）

## 1.15.3

- [ デザイン不具合修正 ] 設定ダイアログ入力欄のプレースホルダー文字色をダーク背景で読める配色に調整（[#116](https://github.com/vektor-inc/vk-terminals/issues/116)）
- [ デザイン不具合修正 ] 設定ダイアログの文字サイズ・コントラストをダーク背景で読みやすいように調整（[#125](https://github.com/vektor-inc/vk-terminals/issues/125)）

## 1.15.2

- [ 不具合修正 ] モバイル版のペインプレビューでターミナルの再描画が改行として残り、日本語出力が数文字ごとに分断されて表示される不具合を修正（[#121](https://github.com/vektor-inc/vk-terminals/issues/121)）
- [ デザイン不具合修正 ] ペインタイトルの暗背景化で見えづらくなった PR / マージ済みラベルの文字・境界色を暗背景で視認できる配色に調整

## 1.15.1

- [ デザイン不具合修正 ] ペインのタスクタイトルリンクのホバー時の文字色がダーク背景で黒く沈んで読みづらい問題を、白に変更して修正
- [ その他 ] README を現行実装に同期。Node.js 要件を 20 以上に修正し、HTTP API の `POST /api/menu`・`POST /api/close-pane`・`/api/set-title` の `prMerged`・`/api/states` の `usage` を追記、サイドバー格納／サイドバーメニュー・Claude 使用量表示・モバイルページの節を追加、エージェントルームが β 無効化中である旨を明記

## 1.15.0

- [ 機能追加 ] サイドバーに格納したペインのツールバー（ヘッダー）にも、メインエリアのペイン同様 PR リンク（およびタイトルリンク）を表示するように追加（[#112](https://github.com/vektor-inc/vk-terminals/issues/112)）
- [ 機能追加 ] モバイル版でペインの並び順を ▲▼ ボタンで手動変更できるように変更。ステータス変化による自動並び替えを廃止し、指定順を localStorage に保存して維持（[#106](https://github.com/vektor-inc/vk-terminals/issues/106)）
- [ 機能追加 ] HTTP API `POST /api/set-title` に `prMerged` を追加し、マージ済み PR のラベルを紫で表示できるように（[#113](https://github.com/vektor-inc/vk-terminals/issues/113)）
- [ 仕様変更 ] サイドバーに格納したペインのヘッダーを、メインエリアのペイン同様タイトル行と操作アイコン行の2段表示に変更（[#112](https://github.com/vektor-inc/vk-terminals/issues/112)）
- [ 仕様変更 ] Claude 使用量表示をサイドバー最上部の常時表示に統合し、クリックで開く使用量モーダルを廃止（[#109](https://github.com/vektor-inc/vk-terminals/issues/109)）
- [ デザイン不具合修正 ] 設定ダイアログの入力欄の境界線色をダーク背景で WCAG 2.1 AA（3:1）を満たす明度（#6e7681）に変更（[#86](https://github.com/vektor-inc/vk-terminals/issues/86)）
- [ デザイン不具合修正 ] ペイン上部のタスク表示行が明るいグレー背景で周囲のダーク UI から浮く問題を、背景・文字色をダークテーマに整合させて修正

## 1.14.0

- [ 機能追加 ] モバイル版でペインのタイトルをタップすると、リンク指定（PR URL）がある場合に別タブで開くように変更（[#103](https://github.com/vektor-inc/vk-terminals/issues/103)）
- [ 機能追加 ] モバイル版で各ターミナル（ペイン）を終了するボタンを追加（[#100](https://github.com/vektor-inc/vk-terminals/issues/100)）
- [ 仕様変更 ] モバイル版でペインヘッダーをタイトル行と操作行の2段表示に変更（[#105](https://github.com/vektor-inc/vk-terminals/issues/105)）
- [ 不具合修正 ] モバイル版のペインプレビューにスピナー記号や数字断片だけの意味がない行が表示される不具合を修正（[#102](https://github.com/vektor-inc/vk-terminals/issues/102)）
- [ 開発環境 ] Playwright + Electron による e2e スモークテスト基盤を追加し、`POST /api/set-status` から renderer のステータス反映までを実行時に検証

## 1.13.0

- [ 機能追加 ] HTTP API `POST /api/set-status` を追加し、オーケストレーター等が入力待ち状態を外部から権威的に設定/解除できるように。外部権威フラグは自動入力・リサイズ・再描画では解除されず、明示 push でのみ解除（[#95](https://github.com/vektor-inc/vk-terminals/issues/95)）

## 1.12.0

- [ 機能追加 ] HTTP API `POST /api/new-pane` に `stashed` オプションを追加し、`stashed: true` で生成ペインをサイドバー格納＋折りたたみ状態で開けるように（[#93](https://github.com/vektor-inc/vk-terminals/issues/93)）

## 1.11.1

- [ 不具合修正 ] ペインをリサイズすると「🟡 入力待ち」インジケータが消える不具合を修正。入力待ち状態を入力まで保持し、リサイズ起因の再描画（確認文の折り返し変化）による誤解除を防止（[#91](https://github.com/vektor-inc/vk-terminals/issues/91)）

## 1.11.0

- [ 機能追加 ] グリッドのペインをサイドバーに格納して表示エリアを空け、必要なときにグリッドへ戻せる機能を追加。格納中もターミナルは稼働を継続し、サイドバー幅のドラッグ変更にも対応（[#89](https://github.com/vektor-inc/vk-terminals/issues/89)）
- [ 仕様変更 ] ペインヘッダの上下移動ボタン（▲▼）を削除。Flex Grid レイアウトで上下移動が機能しないため（[#87](https://github.com/vektor-inc/vk-terminals/issues/87)）

## 1.10.1

- [ デザイン不具合修正 ] 設定ダイアログの select がダークテーマで白地に浮く問題・boolean 行のフォーム様式の不揃い・ラベルの語中改行・余白のグルーピングを修正（[vektor-inc/vk-orchestrator#48](https://github.com/vektor-inc/vk-orchestrator/issues/48)）

## 1.10.0

- [ 仕様変更 ] Claude の使用量表示を設定モーダルのタブから切り離し、サイドバーに独立項目「Claude使用量」と専用モーダルを追加。使用率の警告ドットは歯車ボタンから ☰ メニューボタンとサイドバー項目へ移動（[#84](https://github.com/vektor-inc/vk-terminals/pull/84)）

## 1.9.1

- [ 不具合修正 ] vk-terminals を依存として組み込んだ際、npm ホイスティングでネストした node_modules に electron-rebuild が無く postinstall が ENOENT で失敗する不具合を修正（bin 解決を上方探索で堅牢化）（[#82](https://github.com/vektor-inc/vk-terminals/issues/82)）

## 1.9.0

- [ 機能追加 ] Claude Desktop 風のサイドバーメニューを追加。設定項目・config.json の `menuItems`・HTTP API `POST /api/menu` から外部リンクや設定モーダル起動項目を表示可能に（[#80](https://github.com/vektor-inc/vk-terminals/issues/80)）
- [ 不具合修正 ] Claude使用状況の公式表示が一時的な取得失敗のたびにトークン集計表示へ切り替わり不安定になる問題を修正（直近の公式値を一定時間保持してフォールバックへの頻繁な切替を防止）（[vektor-inc/vk-orchestrator#31](https://github.com/vektor-inc/vk-orchestrator/issues/31)）
- [ 不具合修正 ] postinstall が bash 前提のシェル構文だったため Windows で `node-pty` の自動ビルドが失敗する不具合を修正（Node スクリプトに切り出し OS ごとに分岐）（[#76](https://github.com/vektor-inc/vk-terminals/issues/76)）
- [ その他 ] Windows で `NoDefaultCurrentDirectoryInExePath` 有効時に `node-pty`（winpty）のビルドが失敗する件と回避策を README に追記（[#76](https://github.com/vektor-inc/vk-terminals/issues/76)）
- [ その他 ] Windows の `claude` 導入手順をネイティブインストーラ推奨に更新（Volta シムのスペースバグ回避）（[#76](https://github.com/vektor-inc/vk-terminals/issues/76)）

## 1.8.1

- [ その他 ] WSLg で `off` でも出る Dawn(WebGPU) 由来の `vkCreateInstance: Found no drivers` / `Failed to load libEGL.so` 警告が無害である旨の説明を README に追記

## 1.8.0

- [ 機能追加 ] GUI の GPU 起動モード（`off` / `default`）を環境変数 `VK_TERMINALS_GPU`・`config.json` の `gpu`・設定パネルのいずれからも選択可能に（既定は非 macOS で `off`＝エラー抑制）
- [ 機能追加 ] 設定パネルのフィールドに選択式（`select`）型を追加し、許可された値のみ選べる制約付きピッカーに対応
- [ 機能追加 ] Windows でのデフォルトシェル（`/bin/zsh` 固定）フォールバックに対応し、Windows / WSLg 環境向けのセットアップ手順を README に追記
- [ 不具合修正 ] macOS 以外（WSLg 等）で Chromium の GPU 初期化失敗により起動時に `Exiting GPU process` / `kTransientFailure` 等のエラーログが大量に出る不具合を修正（既定で GPU を無効化して抑制）

## 1.7.0

- [ 機能追加 ] Claude の利用状況（セッション%・週間制限%・リセット時刻）を公式 usage API から取得し、設定モーダルの「Claude使用状況」タブに表示。取得不可時は従来のトランスクリプト集計表示へ自動フォールバック（[#73](https://github.com/vektor-inc/vk-terminals/issues/73)）
- [ 機能追加 ] 使用率が 80% を超えたとき、歯車ボタンに警告ドットバッジを表示（[#73](https://github.com/vektor-inc/vk-terminals/issues/73)）
- [ 仕様変更 ] タイトルバー左の使用量表示を廃止し、設定モーダルを「Claude使用状況｜設定」のタブ構成に変更（歯車ボタンは常時表示・モバイルページも公式データの2バー表示に対応）（[#73](https://github.com/vektor-inc/vk-terminals/issues/73)）

## 1.6.0

- [ 機能追加 ] Claude のトークン使用量（5 時間ブロックの消費状況・リセット時刻・過去最大比の目安）をタイトルバーとモバイルステータスページに表示（[#69](https://github.com/vektor-inc/vk-terminals/issues/69)）
- [ 仕様変更 ] エージェントルーム（β）を一旦無効化。設定項目とペイン表示の両方を非表示に（[#70](https://github.com/vektor-inc/vk-terminals/issues/70)）

## 1.5.2

- [ 不具合修正 ] npm 依存としてインストールして起動した場合（vk-orchestrator 経由など）に xterm.css が読み込まれず、日本語入力（IME）の変換候補ウィンドウがペイン左上に表示され合成中の文字列がペイン上部に見えてしまう不具合を修正

## 1.5.1

- [ 不具合修正 ] 日本語入力（IME）の変換候補ウィンドウがペイン左上に表示される不具合を修正。orchestrator 起動時などペイン生成直後にビューポートがカーソル行からずれると発生

## 1.5.0

- [ 機能追加 ] 動作中の vk-terminals のバージョン番号を設定パネルのヘッダに表示するように変更

## 1.4.2

- [ 不具合修正 ] 起動時の自動アップデートが最新版を検出できず更新されない不具合を修正。バージョンタグ検出が `v` 付き（例: `v1.1.0`）のみを対象にしており、`v` なしのリリースタグ（例: `1.4.1`）を無視していたため

## 1.4.1

- [ 不具合修正 ] エージェントルームの開閉でターミナルが再フィットされず、Claude の入力欄が可視領域外へ押し出されたり IME 合成中の入力欄が左上に表示される不具合を修正

## 1.4.0

- [ 仕様変更 ] ペインのレイアウトを入れ子分割の二分木方式から、全ペインが常に最上位に並ぶ自動折返しグリッド方式に変更。ペインが他ペインの内側に入れ子にならなくなり、折り畳み機能は撤去
- [ 機能追加 ] タイトルバー右端の ⚙ ボタンから設定を GUI 上で編集・保存できる設定パネルを追加。単体起動時は vk-terminals 自身の `config.json`（`apiHost`／`initialCommand`／`agentroom`／`additionalPanes`）を編集し、環境変数 `VK_TERMINALS_SETTINGS` に「設定ディスクリプタ JSON」を渡すとその対象ファイル（呼び出し側の任意の config）を編集する。text／password／number／boolean／json に対応し、未知のキーは保持したまま書き戻す
- [ 機能追加 ] サブエージェント（司／和田／安藤／麗美／植草）の稼働状況をドット絵キャラで可視化する「エージェントルーム」を追加。`config.json` の `agentroom: true` で各ペイン下部に開閉表示し、状態は `POST /api/agentroom` か PTY 出力から取得（[#58](https://github.com/vektor-inc/vk-terminals/issues/58)）
- [ 不具合修正 ] `POST /api/send` で「本文 + 末尾 Enter（`\r`）」を 1 リクエストで受け取ると、Claude Code の TUI がペースト扱いして末尾 `\r` を入力欄の改行として吸収し Enter 確定にならず入力待ちのまま止まる不具合を修正（URL など長い入力で特に再現）。サーバ側で本文と Enter を分割し、本文を送って `150ms` 待ってから Enter を送るよう変更。スマホUI・terminal-monitor 等の全送信経路に適用
- [ 不具合修正 ] モバイルページでテキスト入力中にポーリングが走るたびに DOM が移動されソフトキーボードが消える不具合を修正。`render()` 内の `list.appendChild()` による DOM 移動をやめ、CSS `order` プロパティで視覚的な並び替えのみを行うよう変更（[#55](https://github.com/vektor-inc/vk-terminals/issues/55)）

- [ 機能追加 ] モバイルページ（`renderer/mobile.html`）の各ターミナルカードのヘッダに PR リンク（PR ↗）を表示できるように変更。`apiPrUrl` が設定され安全な http(s) URL のときだけ表示し、タップで GitHub の PR を新規タブで開く（[#53](https://github.com/vektor-inc/vk-terminals/issues/53)）
- [ 機能追加 ] モバイルページ（`renderer/mobile.html`）の各ターミナルカードを、ヘッダをタップして折り畳めるように変更。折り畳むと出力・操作ボタンが隠れ、状態は再読込をまたいで保持（[#49](https://github.com/vektor-inc/vk-terminals/issues/49)）
- [ セキュリティ修正 ] HTTP API の更新系エンドポイント（`POST /api/send`・`POST /api/set-title`・`POST /api/new-pane`）に Origin 検証を追加。ブラウザが cross-origin POST 時に必ず送る `Origin` ヘッダと `Host` を突き合わせ、不一致なら `403` を返す。悪意あるサイトから `http://<apiHost>:13847/api/send` へ CSRF でターミナルへ任意入力を流す攻撃を防ぐ。`Origin` ヘッダを持たない非ブラウザクライアント（curl 等）や同一オリジンのモバイルページは従来どおり素通り（後方互換）
- [ 機能追加 ] スマホ等のリモート端末から状態確認・応答するためのモバイルページを追加。HTTP API に `GET /`（`/index.html` も同義）を追加し、`renderer/mobile.html` を配信する。ページは既存の `GET /api/states` を 2 秒ごとにポーリングして各ターミナルをカード表示（`status` を `idle`／`running`／`waiting` で色分け・ドット表示、`waiting` を点滅、`waiting` > `running` > `idle` の順でソート）、`lastLines` は ANSI 制御コードを除去して末尾を表示する。各カードに quick ボタン（`1`／`2`／`3`／`↵`／`Yes(y↵)`／`No(n↵)`／`Esc`／`Ctrl-C`）と自由入力欄（末尾改行トグル付き）を備え、`POST /api/send` で応答できる
- [ 機能追加 ] HTTP API のバインド先ホストを `config.json` の `apiHost` で変更できるように追加（既定 `127.0.0.1`）。Tailscale IP（`100.x.x.x`）を指定すると tailnet 内からのみ到達可能になり、スマホ等から `http://<apiHost>:13847/`（上記モバイルページ）で状態確認・応答できる（LAN や公開インターネットには出さない）。`0.0.0.0` 指定で全 I/F 待ち受けも可。指定ホストが未割り当て（`EADDRNOTAVAIL`、例: Tailscale 未接続）の場合は `127.0.0.1` にフォールバックして API を起動し続ける。`config.example.json` に `apiHost` の既定値を追記
- [ 不具合修正 ] Claude Code の AskUserQuestion（「❯ 1. … / 2. … / Enter to select」形式の数字選択肢 UI）で「🟡 入力待ち」が点灯しない不具合を修正。`WAITING_PATTERNS` に AskUserQuestion フッター文言（`Enter to select` / `↑/↓ to navigate` / `Esc to cancel`）、数字選択肢（`❯ 1. ラベル`）、バッファ末尾が全角「？」で終わる質問文の検知パターンを追加（[#46](https://github.com/vektor-inc/vk-terminals/issues/46)）
- [ 機能追加 ] ペイン上部のタスクタイトル行の右側に独立した [ PR ↗ ] ボタンを表示できる機能を追加。`POST /api/set-title` に `prUrl` フィールド（任意・`http(s):` のみ・2048 文字以内・`new URL()` で parse 可）を追加し、`prUrl` が設定されているときに限り、タイトル行の右端に GitHub PR グリーン系の `[ PR ↗ ]` ボタン（`.pane-badge` 共通基底 / 共通バッジ規格 h18 / font-size 10 / radius 3px / padding 0 6px）を表示する。クリックすると `shell.openExternal()` で OS の既定ブラウザを開く（renderer 側でも `http(s):` を再チェックする二段構え）。表示条件は `apiTitle` / `taskTitle` のいずれが表示中でも常時表示（OSC タイトル表示中で issue リンクが消える場面でも PR ボタンは独立に出る）。`prUrl` を省略すると PR ボタンなし、空文字 `""` で既存 `prUrl` をクリア。`prUrl` のバリデーション違反は `400` を返す（`url` と完全同一規約）。`states.json` および `GET /api/states` のレスポンスに `apiPrUrl` フィールドを追加（後方互換のため既存フィールドは維持）（[#44](https://github.com/vektor-inc/vk-terminals/issues/44)）
- [ 機能追加 ] ペインのタスクタイトル行をドラッグして他ペインの上下左右にドロップすると、その方向に再分割して挿入できる機能を追加（タスクタイトル行に `cursor: grab` / `grabbing`、ドロップ予定領域を半透明アクセントカラーで塗りつぶす視覚フィードバック、中央 20% はデッドゾーンとして無効化、ペイン1枚状態ではドラッグ不可）（[#40](https://github.com/vektor-inc/vk-terminals/issues/40)）
- [ セキュリティ修正 ] `renderer/app.js` の `renderLeaf()` で `innerHTML` テンプレートリテラル経由でペインヘッダを組み立てる際、`cwd`（OS ファイルシステム由来）や `statusAriaLabel` などの動的文字列を属性値・テキスト内容にエスケープせず挿入していたため、ディレクトリ名に `"` や `<` を含むパスでヘッダ DOM が壊れ任意の HTML が注入されうる問題を修正（属性値用 `escAttr` / テキスト用 `escText` のエスケープヘルパーを導入し、`data-status` / `aria-label` / `pane-cwd` の `title` 属性とテキストノードに適用）（[#39](https://github.com/vektor-inc/vk-terminals/issues/39)）
- [ 不具合修正 ] 自動入力バッジ（`🤖 自動入力`）の自動非表示用 `setTimeout` のタイマー ID を保持していなかったため、短時間に複数回 `terminal:auto-input` イベントが発火すると先発タイマーが残ったままになり、後発の表示が想定の 3 秒より早く消える不具合を修正（[#38](https://github.com/vektor-inc/vk-terminals/issues/38)）
- [ 仕様変更 ] ペインを角丸カード状デザインに変更（`margin: 6px` ＋ `border-radius` を `.pane` / `.term-container` に付与、body 背景を `#333` に変更）。あわせて共通利用想定の CSS カスタムプロパティ `--vktm--border-radius--md` を導入
- [ デザイン不具合修正 ] ペイン下部に body 背景が透けて白い余白が表示される不具合を修正（xterm.js が文字グリッド整数倍でしか描画できないために `.term-container` の下端に残る隙間を、`.term-container` の背景にターミナルテーマ色 `#0d1117` を当てることで隠す）
- [ 不具合修正 ] 入力待ち（🟡 入力待ち）の検知漏れを修正。Claude Code の TUI 再描画や recap メッセージ、ウィンドウリサイズ起因のプロンプト枠再描画によって、確認文（例: 「ご確認をお願いします」）が直近行バッファ（旧: 15 行）から押し出されインジケータが点灯しなくなる不具合を修正（バッファを 80 行／8000 文字に拡張）。あわせて WAITING_PATTERNS に recap で多用される確認待ち表現（「承認待ち」「ご判断ください」「お待ちしています」「いただけたら〜委任/お願い」等）を追加
- [ デザイン不具合修正 ] ペイン上部ステータスインジケータ（issue #27）について、`.pane.drag-over` の緑（#3fb950）と衝突していた running 色を同系統に統一、idle ↔ 表示の切替で発生していた cwd 位置のジッタを `visibility: hidden` + `min-width` 予約で解消、`role="status" aria-live="polite"` と `aria-label` 動的更新で SR 対応、絵文字（🟢🟡）を `::before` で描画する 6×6 の currentColor ドットに置換、`.pane-badge` 共通クラスへ `.pane-status` / `.auto-input-badge` の共通プロパティを集約、`badge-pulse` の周期を `1.5s` に揃え `.pane.waiting` 枠と位相を同期するよう修正
- [ 機能追加 ] 入力待ち判定（WAITING_PATTERNS）に日本語パターンを追加。vk-kore など Claude が確認を求めて中断するケース（「ご確認をお願いします」「続行しますか」「進めてよろしい」「〜よろしいでしょうか」）と、PR 作成後のマージ判断委譲（「マージ判断」「マージ〜ご判断/お任せ/お願い」等）で「🟡 入力待ち」インジケータが点灯するように
- [ 機能追加 ] ペイン上部のタスクタイトル行に外部リンクを指定できるように変更。`POST /api/set-title` に `url` フィールド（任意・`http(s):` のみ・2048 文字以内）を追加し、API 由来タイトル（`apiTitle`）表示時かつ `url` が設定されているときに限り、タイトル全体を `<a>` 化（末尾に外部リンクマーク `↗` を表示）。クリックすると `shell.openExternal()` で OS の既定ブラウザを開く。`url` を省略すると従来通り URL なし表示、空文字 `""` で既存 URL をクリア。`url` のバリデーション違反は `400` を返す。`states.json` および `GET /api/states` のレスポンスに `apiUrl` フィールドを追加（後方互換のため既存フィールドは維持）
- [ その他 ] `main.js` と `renderer/app.js` に重複していた `stripAnsi` を `utils/stripAnsi.js` に共通化（用途別に表示用 `stripAnsiForDisplay` とパターンマッチング用 `stripAnsiForPattern` の 2 関数をエクスポート。正規表現は両方の意図を維持したまま据え置き）
- [ 機能追加 ] ペイン上部のヘッダ左側に動作ステータスインジケータ（🟢 実行中／🟡 入力待ち）を追加。PTY 出力中は緑、入力待ち（既存の WAITING_PATTERNS ヒット時）は黄、それ以外は非表示。`states.json` および `GET /api/states` のレスポンスに `status` フィールド（`'idle' | 'running' | 'waiting'`）を追加（既存 `waiting` フィールドは後方互換のため維持）
- [ 仕様変更 ] 旧 `.waiting-badge`（⚠ 待機中）を新ステータスインジケータに統合して削除。入力待ち表示は `🟡 入力待ち` バッジに一本化（`.pane.waiting` 枠の点滅アニメーションは引き続き動作）
- [ 機能追加 ] 上下分割されたペインを折り畳めるように変更。ヘッダの ▾ ボタン（折り畳み中は ▴）で展開・折り畳みを切り替え。折り畳み中はタスクタイトル行とヘッダのみ表示し、xterm 領域を隠して兄弟ペインを広げる（PTY プロセスは生存し続けるため、出力や waiting バッジは継続）
- [ 機能追加 ] 各ペイン上部に「タスクタイトル行」を追加。OSC 0 / OSC 2 のターミナルタイトル変更（例: `printf '\033]0;ビルド中\007'`）と HTTP API（`POST /api/set-title { termId, title }`）の両方から設定可能。空のときはタイトル行を非表示にして xterm 表示領域を圧迫しない
- [ 機能追加 ] ペインヘッダに上下左右の移動ボタン（◀ ▼ ▲ ▶）を追加。クリックで該当方向にある隣接ペインと位置を入れ替え（PTY セッションは維持・termId 紐付けも変わらない）
- [ 機能追加 ] 起動時 CLI フラグ `--no-claude`（`--plain` も同義）を追加。指定すると新規ペインで claude を自動起動せず素のシェルとして開く（`initialCommand` も送信しない）。`additionalPanes` 設定で個別に `noClaude: true` も指定可能
- [ 機能追加 ] HTTP API（`POST /api/new-pane`）のリクエストボディで `noClaude: true` を指定できるように変更（指定された場合、新規ペインで claude を自動起動せず素のシェルとして開く）
- [ 機能追加 ] HTTP API（`POST /api/new-pane`）のリクエストボディで `cwd` を指定できるように変更（指定があればそのディレクトリ、未指定ならホームディレクトリで新規ペインを開く）
- [ 仕様変更 ] ペインを分割した際、分割元のカレントディレクトリを継承せず常にホームディレクトリで開くよう変更（API 経由で `cwd` が明示された場合のみその場所で開く）
- [ 仕様変更 ] HTTP API（`POST /api/new-pane`）経由で新規ペインを作成する際、フォーカス中ペインではなく表示面積が一番大きいペインを対象に分割するよう変更
- [ 機能追加 ] 設定ファイル（`config.json`）に `additionalPanes` を追加。起動時に追加で開くペインを `cwd` 指定で複数枚作成できる（各ペインは指定ディレクトリで claude が立ち上がる）
- [ 仕様変更 ] HTTP API（`POST /api/new-pane`）経由で新規ペインを作成する際、対象ペインの長辺方向に分割するよう変更（横にだけ広がらず、縦横バランスよくグリッド状に増える挙動に）
- [ 不具合修正 ] 2 つ目以降のターミナルで信頼確認プロンプトが自動承認されず待機状態のままになる不具合を修正（Claude Code の新 UI 文言 "Enter to confirm" にも対応）
- [ 不具合修正 ] Claude Code フッターの "bypass permissions on" 表示によってターミナルが入力待ち状態として誤判定される不具合を修正
- [ 機能追加 ] HTTP API に `POST /api/new-pane` エンドポイントを追加（新規ペインを作成して termId を返す）
- [ 不具合修正 ] Claude の初期化が 4 秒以内に終わらない場合に initialCommand（起動時自動実行コマンド）が無視されてしまう不具合を、Claude のプロンプト（`? for shortcuts`）検知方式に変更して修正
- [ 不具合修正 ] 新規ディレクトリで起動した際の信頼確認プロンプト（`Do you trust the files in this folder?`）で待機して initialCommand が送信されない不具合を修正（Enter を自動送信して承認）
- [ 仕様変更 ] アプリ名を claude-terminals から vk-terminals に変更
- [ 仕様変更 ] 設定・データディレクトリを `~/.vk-terminals/` に変更（旧パス `~/.claude/terminals-config.json` も後方互換で読み込み）
- [ 機能追加 ] 各ターミナルの状態を `~/.vk-terminals/states.json` に定期書き出しする機能を追加
- [ 機能追加 ] ローカル HTTP API（port 13847）を追加し、外部からターミナルの状態取得・コマンド送信が可能に

## 1.3.0

- [ 機能追加 ] ファイル・フォルダをターミナルペインにドラッグ&ドロップするとカーソル位置に絶対パスを挿入する機能を追加（複数ファイルはスペース区切り、スペースを含むパスはシングルクォートで囲む）

## 1.2.0
- [ 機能追加 ] Shift+Enter で改行を送信できる機能を追加（Claude Code の keybindings.json 対応）

## 1.1.0
- [ 機能追加 ] 起動時に新バージョン（git タグ）があるか確認し、あれば自動で `git pull` して再起動を促す機能を追加
- [ デザイン不具合修正 ] ボタンのサイズ・文字サイズ・色を調整

## 1.0.0
- [ 機能追加 ] 起動時に自動実行するコマンドをユーザー設定ファイル（`~/.vk-terminals/config.json` または `config.json`）で指定できる機能を追加
