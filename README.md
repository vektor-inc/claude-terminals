# vk-terminals

複数のターミナルを並べて表示できる Electron 製デスクトップアプリです。
起動すると自動的に `claude` コマンドが実行されます。

## スクリーンショット

ペインを自動折返しグリッドに並べて複数の Claude セッションを同時に操作できます。

## 必要環境

- Node.js 20 以上
- macOS / Windows（`node-pty` のネイティブビルドが必要。Windows でのセットアップは[後述](#windows-での起動)）

## セットアップ

```bash
npm install
```

## 起動

```bash
npm start
```

### 素のターミナルモード（claude を自動起動しない）

通常起動では各ペインで自動的に `claude` が実行されますが、`--no-claude`（または `--plain`）フラグを付けると claude を起動せず、素のシェルとしてペインを開きます。`initialCommand` の送信もスキップされます。

```bash
npm start -- --no-claude
# または
electron . --no-claude
```

設定ファイルの `additionalPanes` 各エントリに `noClaude: true` を指定すると、そのペインだけ素のシェルとして開けます（CLI フラグ未指定時の挙動）。

HTTP API（`POST /api/new-pane`）でも `noClaude: true` を指定可能です（後述）。

### GPU 起動モード（`VK_TERMINALS_GPU`）

VK Terminals は Electron アプリのため、macOS 以外（WSLg などの Linux）では Chromium の GPU 初期化が失敗し、起動時に `Exiting GPU process` / `kTransientFailure` などのエラーログが大量に出ます（利用可能な Vulkan ICD がソフトウェア実装のみで SwiftShader へフォールバックするため）。環境変数 `VK_TERMINALS_GPU` で挙動を選べます。

| 値 | 挙動 |
|---|---|
| 未設定（自動） | macOS は通常起動、それ以外は `off` 相当 |
| `off` | GPU を無効化してエラーログを抑制（描画はソフトウェア。ターミナル用途で実害なし） |
| `default` | フラグを足さず Chromium 任せ（元の挙動。macOS 以外では GPU 初期化エラーが出る場合あり） |

> WSLg での HW アクセラ（HW OpenGL / Vulkan）は対応しません。Vulkan は HW ICD（dzn 等）が WSLg に無く、OpenGL も体感差が無いうえ Mesa/Dawn 由来の警告が出るためです。

#### WSLg で出る `vkCreateInstance` / `libEGL.so` 警告について（無害）

`off` で起動しても、claude 起動後（起動から数分後のこともある）に次のような警告が stderr に出ることがあります。

```
Warning: loader_get_json: Failed to open JSON file lvp_icd.json
（他の *_icd.json も同様）
Warning: vkCreateInstance: Found no drivers!
Warning: vkCreateInstance failed with VK_ERROR_INCOMPATIBLE_DRIVER
    at ... third_party/dawn/src/dawn/native/vulkan/BackendVk.cpp ...
Warning: Failed to load libEGL.so
    at DiscoverPhysicalDevices (../../third_party/dawn/src/dawn/native/opengl/BackendGL.cpp:74)
```

これは Chromium がバックグラウンドで行う GPU 情報収集で、**WebGPU 実装の Dawn が Vulkan / OpenGL アダプタを探索**した際のログです。WSLg では次の理由で探索に失敗しますが、**いずれも完全に無害**で、描画はソフトウェアにフォールバックしてアプリは正常動作します（`--disable-gpu` とは別経路のため `off` でも出ます）。

- **Vulkan**: ICD マニフェスト（`/usr/share/vulkan/icd.d/*.json`）や実ドライバ（例: lavapipe の `libvulkan_lvp.so`）自体は存在するが、サンドボックス化された GPU プロセスからは読めず「ドライバ無し」となる。
- **OpenGL**: Dawn が `libEGL.so`（バージョン無し）を `dlopen` するが、WSLg には `libEGL.so.1` しか無く symlink が無いため失敗する。

このアプリは WebGPU を使わないため実害はありません。`VK_TERMINALS_GPU`・`config.json`・設定パネルのどのモードでも、また `--disable-features=Vulkan,WebGPU` 等の Chromium フラグでもこのバックグラウンド探索は止められない（この Electron/Chromium バージョンの挙動）ため、**この警告は無視して問題ありません**。

```bash
VK_TERMINALS_GPU=off npm start
```

`config.json` の `gpu` キーでも同じ値を指定できます（永続設定向け）。

```json
{ "gpu": "off" }
```

設定パネル（歯車 → 「設定」タブ → 「GPU 起動モード」）からも選択できます（保存後の再起動で反映）。

モードの優先順位は **環境変数 `VK_TERMINALS_GPU` > `config.json` の `gpu`（＝設定パネル） > プラットフォーム既定** です（環境変数がその場の上書きとして config を上回ります）。

> `electron . --disable-gpu` のように GPU 関連スイッチを直接指定して起動した場合は、そちらを尊重して `VK_TERMINALS_GPU` / `config.json` の自動適用は行いません（呼び出し側の指定を優先。VK Orchestrator 経由の起動もこの経路）。

## WSLg での起動

Windows 上の WSL2（WSLg）でも動作します。GUI が Windows 側にそのまま表示されます。

### 1. 前提パッケージ

WSL 側（Ubuntu 等）に以下が必要です。

```bash
sudo apt update
sudo apt install -y build-essential python3
```

`node-pty` はネイティブモジュールのため、`npm install` 時に自動でビルドされます（上記ビルドツールが前提）。

### 2. `claude` コマンドの用意

WSL 側のシェルに `claude`（Claude Code CLI）をインストールしてください。Windows 側にインストールしたものは共有されません。

```bash
npm install -g @anthropic-ai/claude-code
```

### 3. 起動

```bash
npm start
```

既定（`VK_TERMINALS_GPU` 未設定）では GPU を無効化して起動するため、`Exiting GPU process` / `kTransientFailure` / `VK_ERROR_INCOMPATIBLE_DRIVER` などのエラーログは出ません（詳細は[GPU 起動モード](#gpu-起動モードvk_terminals_gpu)を参照）。

起動後、ログに `[vk-terminals] API server listening on http://127.0.0.1:13847` が出ていれば正常です。以下で疎通確認できます。

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:13847/
# => 200
```

## Windows での起動

macOS 前提の部分があるため、まっさらな Windows 環境でセットアップする場合は以下を確認してください。

### 1. 前提ツール

- Node.js 20 以上（[Volta](https://volta.sh/) や [nvm-windows](https://github.com/coreybutler/nvm-windows) 経由でも可）
- `node-pty` のネイティブビルドに必要な C++ ビルドツール
  - [Visual Studio Build Tools](https://visualstudio.microsoft.com/ja/downloads/)（「C++ によるデスクトップ開発」ワークロード）
  - もしくは `npm install -g windows-build-tools`（環境によっては非推奨）
- `npm install` 時に `node-pty` のビルド（`electron-rebuild`）が postinstall で自動実行されます。失敗した場合は `npx electron-rebuild -f -w node-pty` を手動で実行してください
  - 環境変数 `NoDefaultCurrentDirectoryInExePath` が設定されていると、`node-pty` 同梱の winpty のビルドが `'GetCommitHash.bat' ... 認識されていません` で失敗します（winpty の `winpty.gyp` がバッチをファイル名だけで呼び出すため、カレントディレクトリ検索が無効化されていると解決できないのが原因）。この変数を（後述の 5. のセキュリティ目的で）有効化している場合は、ビルド中だけ一時的に無効化してください。例: PowerShell で `$env:NoDefaultCurrentDirectoryInExePath=$null; npm install`

### 2. `claude` コマンドの用意

起動時に各ペインで自動実行される `claude` コマンド（Claude Code CLI）が必要です。**ネイティブインストーラ（推奨）**が最も簡単で、npm / Volta のシムを介さない単体 `claude.exe` を導入します。

```powershell
irm https://claude.ai/install.ps1 | iex
```

- インストール先は `%USERPROFILE%\.local\bin\claude.exe`。インストーラの案内どおり、このディレクトリを**ユーザー PATH に追加**してください（未追加の場合は警告が出ます）。追加後は**ターミナル / VSCode を再起動**して反映させます。
- アップデートは `claude update` で完結します。
- npm や Volta のシムを使わないため、**ユーザー名にスペースを含む環境（例: `C:\Users\First Last\...`）でも問題なく動作**します（vk-terminals が各ペインで実行する裸の `claude` コマンドがそのまま解決されます）。

代替として npm グローバルインストールも利用できます。

```powershell
npm install -g @anthropic-ai/claude-code
```

こちらを使う場合、`claude` が見つからない・起動しないときは以下を確認してください。

- **PowerShell / コマンドプロンプトを開き直しても `claude` が見つからない場合**：VSCode などのエディタ内蔵ターミナルから `npm install -g` した場合、そのプロセスツリーは起動時点の古い PATH を引き継いだままのことがあります。**VSCode やターミナルアプリ自体を再起動**すると解消します。
- **Volta 環境でユーザー名にスペースが含まれる場合**、Volta が生成する `.cmd` シムがパスをスペースで分断し `'C:\Users\First' は認識されていません` のように失敗することがあります。この場合は上記のネイティブインストーラへの切り替えを推奨します（`volta uninstall @anthropic-ai/claude-code` で Volta 版を外してから導入してください）。

### 3. VSCode 統合ターミナルから `npm start` する場合の注意

VSCode 自体が Electron 製アプリであるため、その内蔵ターミナルには `ELECTRON_RUN_AS_NODE=1` が環境変数として設定されています。この変数を継承したまま `npm start`（内部的に `electron .`）を実行すると、Electron がプレーンな Node.js として起動してしまい `TypeError: Cannot read properties of undefined (reading 'whenReady')` で失敗します。

回避策：

```powershell
Remove-Item Env:\ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
npm start
```

もしくは VSCode ではなく通常の PowerShell / コマンドプロンプトから起動してください。

### 4. デフォルトシェル・作業ディレクトリ

Windows では各ペインのデフォルトシェルとして `%COMSPEC%`（通常 `cmd.exe`）または `powershell.exe` が、デフォルト作業ディレクトリとして `%USERPROFILE%` が使われます（`SHELL` / `HOME` 環境変数が設定されていればそちらを優先）。

### 5. パス指定の注意点

- `config.json` の `additionalPanes[].cwd` に Windows パスを書く場合、JSON 文字列内の `\` はエスケープが必要です（例: `"C:\\Users\\you\\project"`）。エスケープ不要な `/` 区切り（例: `"C:/Users/you/project"`）でも Node.js 上では問題なく解決されます。
- ユーザー名やインストール先にスペースを含むパス（例: `C:\Users\First Last\...`）は、コマンドラインから直接実行するツールやシムスクリプトで引用符の扱いが原因で正しく解決されないことがあります（実例: Volta の `.cmd` シムがスペース入りパスで壊れるケース）。PATH に追加するディレクトリや実行ファイルのパスにスペースが含まれる場合は注意してください。
- ユーザー設定ファイルの探索先 `~/.vk-terminals/config.json` は、Windows では `os.homedir()`（`%USERPROFILE%`）配下、つまり `%USERPROFILE%\.vk-terminals\config.json` に読み替えられます。
- `cwd`（`additionalPanes[].cwd` や HTTP API `/api/new-pane` の `cwd`）は必ず **Windows ネイティブ形式**（`C:\Users\you\project` または `C:/Users/you/project`）で指定してください。`node-pty` 内部で Node.js の `path.resolve()` を通すため、Git Bash / WSL 由来の POSIX 形式パス（`/c/Users/you/project` など）を渡すとドライブレターが正しく解決されず、意図しないディレクトリが開かれます。
- リポジトリ自体は `C:\` 以外のドライブ（例: `D:\dev\vk-terminals`）に置いても問題なく動作します。ただし `C:\Program Files\...` のような管理者権限が必要なディレクトリや、OneDrive 同期対象フォルダ（既定の `ドキュメント` / `デスクトップ` が同期対象になっている場合あり）に置くと、`npm install` 時のネイティブビルド（`node-pty`）が権限エラーやファイルロックで失敗することがあります。`C:\dev\...` のような同期対象外の短いパスを推奨します。
- リポジトリを配置するディレクトリ自体にスペースが含まれる場合（例: `C:\Users\Taro Yamada\Documents\vk-terminals`）、`node-pty` の `node-gyp` 経由のネイティブビルドがパス中のスペースが原因で失敗することがあります（`npm install` / `electron-rebuild` がビルドツールへの引数展開でパスを分割してしまうケース）。ビルドエラーが出た場合は、まずスペースを含まないパス（例: `C:\dev\vk-terminals`）に配置し直して切り分けてください。
- （セキュリティ向け補足）Windows は既定で、実行ファイル名の解決時に **カレントディレクトリを PATH より先に検索**します。vk-terminals の各ペインは `cwd` を作業ディレクトリとしてシェルを起動するため、信頼できないリポジトリ（`cwd` に指定したフォルダ）に `claude.exe` など正規コマンドと同名の実行ファイルが紛れ込んでいると、そちらが誤って実行される恐れがあります。気になる場合は環境変数 `NoDefaultCurrentDirectoryInExePath=1` を設定すると、カレントディレクトリ検索を無効化し PATH のみから解決されるようになります（`setx NoDefaultCurrentDirectoryInExePath 1` 等）。`setx` はユーザー環境変数としてレジストリに恒久保存されますが、**反映されるのは次回以降に開くコマンドウィンドウのみで、実行した現在のセッションには反映されません**（現在のセッションだけで即座に有効化したい場合は `$env:NoDefaultCurrentDirectoryInExePath=1` を使います）。なお、この変数を有効化すると `node-pty`（winpty）のネイティブビルドが失敗するため、`npm install` の際は一時的に無効化する必要があります（詳細は「1. 前提ツール」を参照）。セキュリティ目的で恒久的に有効化するのではなく一時的な検証として設定しただけの場合は、`reg delete "HKCU\Environment" /F /V NoDefaultCurrentDirectoryInExePath` で削除して元に戻せます（削除も同様に次回以降のウィンドウから反映されます）。

## 使い方

### ペインの追加・並べ替え

ペインはすべて最上位（VK Terminals 直下）に並ぶ自動折返しグリッドで配置されます。ペインが他ペインの内側に入れ子になることはなく、数が増えると自動的に行へ折り返します。各ペインのヘッダーにあるボタンで操作できます。

| ボタン | 操作 |
|---|---|
| `＋` | ペインを追加（グリッド末尾に追加） |
| `◀` `▶` `▲` `▼` | ペインをグリッド上で隣と入れ替え |
| `✕` | ペインを閉じる |

ペインのタスクタイトル行をドラッグして他ペインの左/上（前）・右/下（後）にドロップすると、並び順を入れ替えられます。

### ペインのリサイズ

列間（縦線）・行間（横線）の境界をドラッグすると、その列・行のトラック幅／高さを手動で調整できます。ペインを増減するとグリッド寸法が変わるため、トラックのサイズは均等にリセットされます。

### 待機検出

ターミナルが入力待ち状態（`y/n` 確認・Claude Code の権限承認など）になると：

- ペインのヘッダーが強調表示される
- `⚠ 待機中` バッジが表示される
- 通知音が鳴る

### サイドバーへのペイン格納

グリッド上のペインは、サイドバーに「格納」して表示エリアを空けられます（issue #89）。格納中もターミナルは稼働を継続し、必要になったらグリッドへ戻せます。サイドバーの幅はドラッグで変更できます。HTTP API `POST /api/new-pane` に `stashed: true` を指定すると、最初から格納＋折りたたみ状態でペインを開けます。

格納したペインのヘッダーも、メインエリアと同様にタイトル行＋操作アイコン行の2段表示で、`PR ↗` リンクやタイトルリンクが表示されます（issue #112）。

## サイドバーメニュー

Claude Desktop 風のサイドバーに、外部リンクや設定モーダル起動などの項目を追加表示できます（issue #80）。項目は次の 2 系統から供給できます。

- `config.json` の `menuItems`（永続設定）
- HTTP API `POST /api/menu`（外部から動的に登録・置換。前述の[`POST /api/menu`](#post-apimenu)を参照）

各項目は `id` / `label` / `icon`（任意）/ `action` を持ち、`action.type` は `open-url`（URL を OS の既定ブラウザで開く）または `open-settings`（設定モーダルを開く）に対応します。`config.json` の記述例は [`config.example.json`](config.example.json) を参照してください。

## Claude 使用量表示

Claude の利用状況（セッション使用率 / 週間制限の使用率とリセット時刻）を、サイドバー最上部の「Claude使用量」として常時表示します（issue #69 / #73 / #109）。

- 表示は opt-out 方式で既定 ON です。`config.json` の `showUsage: false`（または設定パネルの「トークン使用量を表示」をオフ）で無効化できます。
- 値は公式 usage API（`source: 'oauth'`）を主とし、取得できない場合はローカルのトランスクリプト集計（`source: 'transcript'`）にフォールバックします。
- 同じ使用量スナップショットは `GET /api/states` レスポンスのトップレベル `usage` にも含まれ、モバイルページ（後述）でも表示されます。

## モバイルページ

vk-terminals を起動している間は、パソコン（vk-terminals を動かしているマシン）の中で小さな Web サーバー（ページの配信係）も一緒に動いています。スマートフォンのブラウザでその Web サーバーのアドレスを開くと、全ターミナルの状況をまとめて見られる専用ページが表示され、応答などの簡単な操作もできます。スマートフォン側にアプリをインストールする必要はなく、普段使っているブラウザだけで使えます。ただし初期設定では vk-terminals を動かしているマシン自身からしか見えないため、スマートフォンから見るには後述の設定が必要です。

HTTP API サーバーのルート（`GET http://<apiHost>:13847/`）は、スマートフォン等のブラウザから全ペインの状態確認と簡易操作ができるモバイル向け Web ページを返します。ページは `GET /api/states` を約 2 秒ごとにポーリングして、タスクタイトル・稼働ステータス・直近の出力プレビュー・Claude 使用量を更新します。

### スマートフォンから開く手順

既定では HTTP API サーバーは `127.0.0.1:13847` で待ち受けるため、同じパソコン上からしか見えません。スマートフォンなど LAN 内の別端末から開く場合は、パソコンの LAN IP アドレスを `apiHost` に設定します。

`apiHost` に `127.0.0.1` 以外を指定すると、アクセストークンによる認証が自動的に必須になります（issue #313）。ただし LAN 経由の通信は暗号化されないため、同じネットワーク上でパケットを覗き見できる第三者にはトークンが漏れる可能性があります。必ず信頼できるネットワークでのみ設定してください（詳細は後述の[セキュリティ上の注意](#セキュリティ上の注意)を参照）。

1. パソコンとスマートフォンを同じ信頼できるネットワークに接続します。
2. パソコンの IP アドレスを確認します。macOS の Wi-Fi ではターミナルで `ipconfig getifaddr en0` を実行するか、「システム設定」→「Wi-Fi」→接続中ネットワークの詳細から確認します。Windows ではコマンドプロンプトで `ipconfig` を実行し、接続中のアダプターの「IPv4 アドレス」を確認します。
3. タイトルバー右端の ⚙ →「設定」タブで「API ホスト」にパソコンの IP アドレス（例: `192.168.1.23`）を入力して保存します。`config.json` を直接編集する場合は、`"apiHost": "192.168.1.23"` のように指定します。設定ファイルの場所や優先順位は[起動時の初期コマンド設定](#起動時の初期コマンド設定)、設定パネルの挙動は[設定パネル](#設定パネル)を参照してください。
4. vk-terminals を再起動します。`apiHost` は起動時に読み込まれるため、保存後の再起動が必要です。
5. 次の[スマートフォンの初回登録](#スマートフォンの初回登録)の手順で、スマートフォンを登録します。

WSL2 上で vk-terminals を動かしている場合は、Windows との間に仮想ネットワークを挟むため、LAN 内の他端末からアクセスするには Windows 側でのポート転送（`netsh interface portproxy` など）の追加設定が必要です（関連: [WSLg での起動](#wslg-での起動)）。

ポートは通常 `13847` です。テストや並列起動では環境変数 `VK_TERMINALS_API_PORT` で上書きできますが、通常利用では変更不要です。

`GET /api/health` は疎通確認用に `{ "ok": true }` を返し、唯一認証不要のエンドポイントです。起動時に環境変数 `VK_TERMINALS_INSTANCE_ID` を指定すると、レスポンスに `instanceId` も含めます（未指定または空文字の場合は従来どおり含めません）。`instanceId` は認証不要な `/api/health` に到達できる利用者なら誰でも読めるため、`VK_TERMINALS_INSTANCE_ID` には認証情報などの機密値ではなく、取り違え検出用の非機密の識別子を指定してください。

### 外出先からのアクセス

ここに書いた手順は、アプリ内でも読めます。タイトルバー右端の ⚙ →「モバイルから確認」タブに、Tailscale を使って外出先のスマートフォンからモバイルページを開くまでの案内をまとめてあります。エンドユーザー向けの説明はそちらが正で、この節は同じ内容の開発者向けの要約です。

パネル側は「最短で使えるまで」を先に置く構成で、前半が手順 1（両端末を Tailscale に接続）→ 手順 2（Tailscale IP を調べる）→ 手順 3（`apiHost` に指定して再起動・現在の待ち受けアドレスで確認）→ 手順 4（スマートフォンの登録）、後半が状況によって必要になる話（うまく開けないときの確認点・Tailscale とは何か・`tailscale serve` を使う別の方法・セキュリティ上の注意）です。下記の「方法 1 / 方法 2」はこの README 内の呼び分けで、パネルでは手順 1〜4 が方法 1 に、後半の「別の方法: `tailscale serve` で公開する」が方法 2 に対応します。

外出先から使う場合は、Tailscale などの信頼できるプライベートネットワーク経由で公開してください。方法は 2 つあり、どちらか一方を行えば開けます。

- **方法 1: `apiHost` に Tailscale IP（`100.x.x.x`）を指定する** — 設定パネルだけで完結させたい場合はこちら。tailnet 内から `http://<Tailscale IP>:13847/` を開きます。`apiHost` は起動時に読み込むため保存後の再起動が必要です。Tailscale 未接続などで指定した `apiHost` が割り当てられていない場合、API サーバーは `127.0.0.1` にフォールバックして起動します（この場合スマートフォンからは開けないため、起動ログの `API server listening on ...` を確認してください）。`apiHost` が `127.0.0.1` 以外で実際に待ち受けているため、アクセストークンによる認証が自動的に必須になります。
- **方法 2: `tailscale serve` で公開する** — ターミナル操作に抵抗がなければこちらも使えます。`apiHost` の変更は不要です。`tailscale serve --bg 13847` で vk-terminals を動かしているマシンの `127.0.0.1:13847` を tailnet に公開し、表示された URL を開きます（`--bg` は Tailscale 1.54 以降の書式）。tailnet の構成（MagicDNS・HTTPS 証明書の有効化など）や Tailscale の導入方法によっては、先に有効化などの準備が必要で、そのままでは実行できない場合があります。**既知の限界として、この方法による公開状態は vk-terminals 側からは自動で検知できません。** `tailscale serve` は TCP レベルでの転送のため、vk-terminals からは tailnet 経由のアクセスも通常のローカルアクセス（待ち受けアドレスは `127.0.0.1` のまま）と区別がつきません。設定パネルの「常にアクセストークン認証を必須にする」を**手動で**有効にして vk-terminals を再起動してください。設定が無効なままなら、tailnet 側の名前を使ったアクセスは安全のため `403 {"error":"forbidden host"}` で拒否されます。

Tailscale IP は、Tailscale の管理コンソール（Machines の一覧）、または対象マシンで `tailscale ip -4` を実行して確認できます。

### スマートフォンの初回登録

`apiHost` を変更した場合（方法 1）・`tailscale serve` で公開した場合（方法 2）のいずれも、最後にスマートフォンの登録が必要です（issue #313）。登録は端末ごとに 1 回だけ行えば、以降はブックマークから開くだけで使えます。

1. パソコンのタイトルバー右端の ⚙ →「モバイルから確認」タブを開き、「アクセストークン」欄の「初回登録用の URL」の「コピー」を押します（値の確認だけしたい場合は「表示」を押すと伏せ字が解除されます）。
2. AirDrop や自分宛てのメッセージ（メール・チャット等）で、コピーした URL をスマートフォンへ転送します。**手入力はしないでください**（トークンは長い文字列で、打ち間違えると登録できません）。
3. スマートフォンでその URL を開きます。開くと自動的に登録が完了し、アドレスがトークンの付いていない `http://<アドレス>:13847/` へ切り替わります。
4. **この状態でブックマークします。** トークン付きの URL のままブックマークすると、ブックマークや閲覧履歴にトークンが残ってしまいます。

この操作は初回だけでよく、以降は毎回この手順をやり直す必要はありません。ブックマークを開くだけでモバイルページを使えます。

補足:

- 初回登録用の URL はパスワードと同等です。他人に渡さないでください。
- 複数のスマートフォン・タブレットで使う場合は、それぞれの端末で同じ手順（1〜4）を行ってください。
- 機種変更やブラウザの Cookie 削除などで登録状態が失われた場合は、同じ手順をやり直せば再登録できます。
- 端末を紛失した場合は、設定パネルの「トークンを再発行」を押してください。**登録済みのすべての端末が使えなくなります**（個別の端末だけを無効化することはできません）。紛失した端末以外は、上記の手順で再登録してください。

### モバイルページでできること

- 全ペインのタスクタイトル・作業ディレクトリ・`idle` / `running` / `waiting` ステータス・直近出力プレビューを確認できます。`waiting` は点滅表示されます。
- Claude 使用量表示が有効な場合は、サイドバーと同じ使用量スナップショットをページ上部に表示します。設定は[Claude 使用量表示](#claude-使用量表示)を参照してください。
- 各ペインのヘッダーをタップして、出力プレビューと操作ボタンを折りたためます。折りたたみ状態は端末の localStorage に保存されます。
- PR URL が設定されている場合は、ヘッダーの `PR ↗` またはタイトルをタップして別タブで開けます（issue #103）。
- クイックボタンから `1` / `2` / `3` / `↵ Enter` / `Yes (y↵)` / `No (n↵)` / `Esc` / `Ctrl-C` を送信できます。
- 自由入力欄から任意のテキストを送信できます。「末尾に改行(↵)を付ける」をオンにすると Enter 付きで送信します。
- ▲▼ ボタンでペインの並び順を手動変更できます。順序は端末の localStorage に保存されます（issue #106）。
- 「ターミナルを終了」ボタンで対象ペインを終了できます。実行中のプロセスも停止し、元に戻せません（issue #100）。
- ペイン一覧の一番下の「ペインを追加」ボタンで新規ペインを作成できます。デスクトップの「＋」ボタンと同じく `newPaneStartupDir` / `newPaneAutoLaunchClaude` 設定に従います（issue #217）。

外部からペインを作成する場合は HTTP API の [`POST /api/new-pane`](#post-apinew-pane) も使用できます。

### セキュリティ上の注意

モバイルページと HTTP API は、アクセストークンによる認証で保護されています（issue #313）。実際に待ち受けているアドレスが `127.0.0.1` 以外の場合、または設定パネルで「常にアクセストークン認証を必須にする」を有効にした場合は、状態取得・操作を行うデータ系エンドポイント（`GET /api/health` を除く `/api/*`）で認証が必須になります。**これとは別に、ページ本体を構成する静的ファイル（`/`・`/index.html`・`mobile.js` など計 12 パス）も認証不要です。** いずれもアプリに同梱された固定の内容を返すだけで利用者のデータを一切含まないため無認証でも実害が無く、未登録の端末でもページの外枠は表示できます（未登録のままだと画面側の JS が実データの取得で 401 を検知し、登録を促す案内に切り替わります）。実際の状態確認・操作は、登録済みの端末（[スマートフォンの初回登録](#スマートフォンの初回登録)を済ませた端末）だけができます。`POST /api/send` などの更新系エンドポイントには、これとは別に Host ヘッダと Origin ヘッダを突き合わせる CSRF 対策もあります。

アクセストークン認証が不要な構成では、HTTP API のすべてのリクエストで、接続先を示す Host ヘッダが `localhost`、ループバックアドレス、設定した `apiHost`、または実際の待ち受けアドレスのいずれかであることも確認します。一致しないアクセスは `403 {"error":"forbidden host"}` で拒否します。認証が必須になる構成では、外部公開に使う名前を列挙できないためこの許可リスト照合を省略し、アクセストークン認証で保護します（Host ヘッダが無い・空・不正形式の場合は、認証の要否にかかわらず拒否します）。

- **`0.0.0.0` を `apiHost` に指定して LAN に開く使い方は避けてください。** 全インターフェースで待ち受けるうえ、HTTPS ではないため通信が暗号化されず、アクセストークンが平文で流れます。同一 LAN 上でパケットを覗き見できる第三者にトークンが漏れる可能性があります。Tailscale 経由なら Tailscale 側の暗号化があるため問題になりません。
- 自宅 LAN や tailnet など、信頼できるネットワーク以外には公開しないでください。
- 指定した `apiHost` が使えない場合は `127.0.0.1` にフォールバックするため、スマートフォンから見えないときは起動ログの `API server listening on ...` を確認してください（この場合 `127.0.0.1` での待ち受けに戻るため、`apiHost` に `127.0.0.1` 以外を指定していても認証は必須になりません）。
- モバイルページが `403 {"error":"forbidden host"}` で開けない場合は、`tailscale serve` で公開しているのに設定パネルの「常にアクセストークン認証を必須にする」が無効になっていないか確認してください。この設定を有効にして vk-terminals を再起動すると開けるようになります。
- 登録済みのスマートフォンで、同じホストの別ポートで動く他の HTTP サービスを開かないでください。ブラウザはポートを区別せず認証情報（Cookie）を送るため、そのサービス側に認証情報が渡ります（Cookie は RFC 6265 の仕様上ポートを区別しません）。
- トークンを紛失・流出させた場合は、設定パネルの「トークンを再発行」を押してください。登録済みのすべての端末が無効になります（個別の端末だけを無効化することはできません）。

## 起動時の初期コマンド設定

アプリ起動後、最初のターミナルで claude が起動した直後に自動実行するコマンドを設定できます。

設定ファイルを以下のいずれかのパスに配置してください（上が優先）：

1. `~/.vk-terminals/config.json` — ユーザー固有設定（推奨）
2. `config.json`（リポジトリ直下）— ローカル設定（`.gitignore` 対象）

`config.example.json` をコピーして編集してください：

```bash
cp config.example.json config.json
# または
mkdir -p ~/.vk-terminals
cp config.example.json ~/.vk-terminals/config.json
```

設定例：

```json
{
  "initialCommand": "スキルでタスク管理を呼び出して",
  "additionalPanes": [
    { "cwd": "/Users/you/Documents/git/your-project" },
    { "cwd": "/Users/you/Documents/git/other-project", "noClaude": true }
  ]
}
```

- `initialCommand`：1 ペイン目で claude が起動した直後に自動実行されるコマンド。省略または空にすると自動実行は行われません。`--no-claude` 起動時は送信されません。
- `additionalPanes`：起動時に追加で開くペインのリスト。各要素の `cwd`（絶対パス）でペインが分割作成され、その作業ディレクトリで claude が立ち上がります。複数指定可。省略または空配列の場合は 1 ペインのみで起動します。
  - `noClaude: true` を指定すると、そのペインのみ claude を自動起動せず素のシェルとして開きます（省略時は CLI フラグの設定に従う）。
- `showUsage`：Claude の使用量表示（サイドバー最上部の「Claude使用量」・モバイルページ）の ON/OFF。opt-out 方式で、省略時は ON。明示的に `false` にしたときだけ無効化されます（後述の[Claude 使用量表示](#claude-使用量表示)を参照）。
- `confirmClose`：ペインの ✕ ボタンで閉じる時に確認ダイアログを表示する条件。`busy`（実行中・入力待ちのみ確認。省略時の既定）／`always`（常に確認）／`never`（確認なし）。HTTP API 経由（`POST /api/close-pane`）やプロセス自然終了などの自動クローズには適用されません。
- `menuItems`：サイドバーに表示する追加メニュー項目（外部リンク・設定モーダル起動）のリスト。省略時は表示なし（後述の[サイドバーメニュー](#サイドバーメニュー)を参照）。
- `apiHost`：HTTP API サーバーの待受ホスト。省略時は `127.0.0.1`。LAN やモバイル端末からアクセスさせたい場合に自ホストの IP などを指定します。`127.0.0.1` 以外を指定すると、アクセストークンによる認証が自動的に必須になります（詳細は[モバイルページ](#モバイルページ)を参照）。`0.0.0.0` を指定する使い方は、通信が暗号化されずトークンが平文で流れるため避けてください。
- `apiRequireAuthAlways`：`true` にすると、`apiHost` が `127.0.0.1` のままでも常にアクセストークン認証を必須にします。`tailscale serve --bg` で公開する場合（[外出先からのアクセス](#外出先からのアクセス)の「方法 2」）に有効化が必要です。省略時は `false`。
- `gpu`：GPU 起動モード（`off` / `default` / 未設定）。詳細は[GPU 起動モード](#gpu-起動モードvk_terminals_gpu)を参照。
- `agentroom`：`true` にすると、各ペイン下部に開閉式の「エージェントルーム」を表示します（後述の[エージェントルーム](#エージェントルームissue-58)を参照）。省略時は `false`（非表示）。**現在は β 扱いで一旦無効化されており、設定パネルからは編集できません**（#70）。利用する場合は config.json に直接 `agentroom: true` を記述してください。

> **移行メモ**: 旧パス `~/.claude/terminals-config.json` も後方互換として読み込まれます。

## 設定パネル

タイトルバー右端の ⚙ ボタンから、設定を GUI 上で編集・保存できます。単体起動でも常に表示されます。

- **単体起動時**（`VK_TERMINALS_SETTINGS` 未指定）：vk-terminals 自身の `config.json`（`apiHost` / `apiRequireAuthAlways` / `initialCommand` / `confirmClose` / `showUsage` / `gpu` / `menuItems` / `additionalPanes`）を編集します。編集対象は `loadUserConfig()` と同じ探索順で、既存の `config.json` があればそれ、無ければリポジトリ直下 `config.json` を作成します。`apiToken`（アクセストークン）はこの汎用フィールド経由では編集できません。「モバイルから確認」タブの専用パネル（初回登録用 URL の表示・コピーと、トークンの再発行）でのみ扱います（誤って伏せ字のまま保存してトークンを壊す事故を避けるため）。
- **呼び出し側から渡された場合**（`VK_TERMINALS_SETTINGS` に「設定ディスクリプタ JSON」のパスを指定）：そのディスクリプタが指す任意の config ファイルを編集します（vk-orchestrator が自身の統合 `config.json` を編集させる用途など）。vk-terminals 自身は編集対象の設定内容を知らず、ディスクリプタ（編集対象パス + 項目スキーマ）に従って読み書きするだけの汎用実装です。

`waitingExcludeCwdPatterns` は設定 GUI では編集できず、config.json の直編集専用です。

いずれの場合も、保存後の反映には再起動が必要です（設定は起動時に読み込むため）。

ディスクリプタの形式:

```jsonc
{
  "title": "○○ 設定",                       // パネル上部の見出し
  "note": "保存後に再起動で反映されます",    // 任意の注意書き（省略可）
  "targetPath": "/abs/path/to/config.json",  // 読み書きする対象ファイル（絶対パス）
  "groups": [
    {
      "label": "GitHub",
      "fields": [
        { "key": "github.token", "label": "Token", "type": "password", "emptyToNull": true },
        { "key": "github.owner", "label": "Owner", "type": "text" }
      ]
    }
  ]
}
```

- `key`：ドット区切りで対象 JSON の入れ子キーを指す（例 `github.token`）。
- `type`：`text` / `password` / `number` / `boolean` / `select` / `json` / `lines` のいずれか。`json` は配列・オブジェクトを textarea で編集します。`lines` は改行区切りの文字列配列を textarea で編集します。`select` は許可された値のみ選べるピッカーで、`options`（`{ value, label }` の配列）を併記します。
- `default`（任意）：値が未設定のときの既定値。`boolean` で `default: true`（opt-out 項目）を指定すると、未設定のチェックボックスが誤ってオフ保存される問題を避けられます。
- `emptyToNull`（任意）：`text` / `password` / `select` で空欄を `null` として書き出します。
- 保存時はディスクリプタに載っているキーだけを型変換して書き戻し、**載っていない既存キーは保持**します。書き込み先は必ず `targetPath` に限定されます。

#### タブ（`tabs`）

トップレベルに `tabs`（`{ id, label, note?, content?, contentAfter? }` の配列）を置くと、設定パネルがタブ表示になります。各 `group` の `tab` に `id` を指定すると、そのタブへ振り分けられます（`tab` 未指定・不明な `id` は先頭タブ）。`tabs` が無ければ従来どおりタブ無しで表示されます。フッターの「保存」は全タブ横断で、1 回の保存で全タブの変更をまとめて書き戻します。

`content` を指定すると、そのタブに**保存対象を持たない読み取り専用の説明**を表示できます（アプリ内ヘルプ用途。組み込みスキーマの「モバイルから確認」タブがこの形式です）。ブロックの配列で、使える `type` は次のとおりです。

```jsonc
"content": [
  { "type": "heading",   "text": "親セクションの見出し" },              // モーダル見出し配下の h3
  { "type": "heading",   "level": 4, "text": "子セクションの見出し" },   // 直前の h3 の下位（h4）
  { "type": "paragraph", "text": "本文" },
  { "type": "list",      "ordered": true, "items": ["手順1", "手順2"] }, // ordered 省略時は箇条書き
  { "type": "code",      "text": "http://<Tailscale IP>:13847/" },     // コマンド・URL の例
  { "type": "links",     "items": [{ "label": "公式サイト", "url": "https://example.com/" }] },
  { "type": "callout",   "tone": "warning", "text": "注意書き" },       // tone は info（既定）/ warning
  { "type": "tabLink",   "label": "API ホストの設定へ移動", "tab": "general", "field": "apiHost" },
  { "type": "table",     "caption": "…" },                             // 詳細は下記「表（table）」を参照
  { "type": "applyButton", "label": "…", "confirmTemplate": "…", "sets": [] } // 詳細は下記「一括切り替えボタン（applyButton）」を参照
]
```

`contentAfter` を指定すると、同じブロックを**そのタブの入力欄グループより後ろ**に表示できます（書き方・使える `type`・正規化の規則は `content` と同じで、置く位置だけが違います）。入力欄を一通り読んだあとに読ませたい補足はこちらに書きます。設定パネルは `保存先 → note → content → 入力欄グループ → contentAfter` の順に描くため、入力欄と入力欄の間に説明を差し込むことはできません。

- テキストは必ずエスケープして表示され、HTML やマークダウンとしては解釈されません。
- `heading` の `level`（任意）は `3`（既定）または `4` です。`3` は親セクションの見出し（`<h3>`・15px）、`4` はその子セクションの見出し（`<h4>`・13px）として、サイズと上下の余白の差で親子関係が見て分かるように表示されます。読み上げでも「子セクションに入った／抜けた」が伝わるため、章立てのある説明は `level` で階層を付けてください。
- `heading` の `level` に `3` / `4` 以外を書いてもブロックは消えません。`5` 以上は `4` として、それ以外（`2` 以下・文字列の `"4"`・小数・`null` など）は既定の `3` として表示されます（見出しが消えると、その後ろの本文が直前のセクションの続きに見えてしまうため）。
- `content` / `contentAfter` の先頭（親となる `<h3>` がまだ出ていない位置）に `level: 4` を書いた場合は、`3` に繰り上げて表示します。繰り上げの判定は `content` と `contentAfter` で別々に行うため（間に入力欄グループを挟むため）、どちらも先頭の見出しは必ず `<h3>` になります。モーダル全体の見出し（`<h2>`）の直下が `<h4>` になると見出しレベルが 1 段飛び、スクリーンリーダーで階層をたどれなくなるためです。`text` を書き忘れた見出しは表示されないため、親としても数えません（その直後の `level: 4` は `3` になります）。
- `links` の URL は `http` / `https` のみ許可され、クリックすると OS の既定ブラウザで開きます。
- `tabLink` は同じモーダル内の別タブへ移動するボタンです。`field`（任意）に移動先タブのフィールド `key` を指定すると、タブを切り替えたうえでその入力欄までスクロールしてフォーカスします。省略時は移動先タブのタブボタンへフォーカスします。
- 不正なブロック（未知の `type`、`text` 欠落、`http(s)` 以外の URL、存在しないタブを指す `tabLink` など）は黙って取り除かれます。`tabLink` の `field` が実在しないキーを指す場合や、そのフィールドが `tab` とは別のタブに属している場合は、`field` の指定だけを落としてタブ移動は有効なままにします（着地の成否によって別のタブへ飛ぶことがないようにするため）。
- 移動先が**行き止まりのタブ**（開いても「このタブに表示できる設定項目はありません。」という案内だけが表示されるタブ）の場合、その `tabLink` は表示されません（押した先に何も無いボタンがあると、同じ画面の他の移動ボタンまで信用できなくなるため）。取り除いたときは開発者コンソールに `[settings]` から始まる警告を出すので、書いたはずのボタンが出ないときはそちらで原因を確認してください。警告は `mobile タブの「API ホストの設定へ移動」→ general` の形式で、`起点のタブ id`・`ボタンのラベル`・`移動先のタブ id` を並べます。取り除かれるのは移動ボタンだけで、タブ自体はタブバーに残るため、自分でそのタブを開くことはできます。
- `tabLink` を取り除いた結果、それを書いていたタブ自身が行き止まりのタブになった場合は、そこを指す `tabLink` も同じように取り除きます（連鎖が収束するまで繰り返します）。
- ボタンを表示させたい場合は、移動先のタブに設定項目（`groups` のフィールド）・説明ブロック（`content` / `contentAfter`）・`note` のいずれかを用意するか、`tab` の指定を中身のあるタブへ変えてください。そもそも不要な導線であれば `tabLink` ブロックごと削除します。
- ボタンだけが消えて前後の説明文（「詳しくは〜タブで設定します」など）が残ると、読み手は在りもしないボタンを探すことになります。`tabLink` を消したときは、その周辺の文章も一緒に見直してください。
- `visibleWhen` で隠れている入力欄を `field` に指定した場合は、その状況では着地できないため、移動先タブのタブボタンへのフォーカスにフォールバックします。
- タブの `id` が重複している場合は最初の 1 つだけを採用します（後勝ちにすると、先に定義したタブが中身の無い空タブになるため）。
- `tabs` が配列でない場合はタブ定義だけを落とし、タブ無し表示に degrade します（設定項目は消えません）。
- 保存対象のフィールドを 1 つも持たないタブでは、`note` の継承（トップレベル `note` の表示）を行わず、「保存」ボタンも隠します（未保存の変更が他タブに残っている間は、保存できなくならないよう表示したままにします）。
- タブに `note` を書いた場合、そのタブでは「このタブに表示できる設定項目はありません。」を表示しません（`note` に書いた代替手段を打ち消してしまうため）。したがって行き止まりのタブにはならず、`tabLink` の移動先としても有効です。
- ただし `note` は行き止まり判定を外すための逃げ道ではありません。設定項目が無い理由や、代わりの設定方法を書く場所です（例: 「この機能は環境変数 `VK_TERMINALS_API_PORT` で設定します」）。「準備中です」のような読む価値のない一言だけを書くと、判定上は移動先として有効になっても、ボタンを押した人は結局行き止まりに着きます。移動先のタブを開いた人が次に何をすればよいか分かる内容を書いてください。
- 欄を持たないグループ（`fields` が空）をタブに置く場合は、`label` を必ず書いてください。そのタブではグループ名がそのタブの唯一の表示内容になるため、`label` が無い（または空白だけの）と枠線だけが表示され、案内も出ないまま行き止まりになります。

##### 表（`table`）

関連する設定が複数タブ・複数項目に散らばっているとき、「今どうなっているか」の全体像を 1 か所にまとめて示すための読み取り専用ブロックです（issue #380）。

```jsonc
{
  "type": "table",
  "caption": "AI エンジン設定の現在値",
  "columns": [{ "label": "現在の値" }],
  "rows": [
    {
      "label": "エンジン",
      "cells": [
        {
          "type": "fieldValue",
          "key": "engine",
          "map": [
            { "value": "claude", "label": "Claude", "tone": "success" },
            { "value": "codex",  "label": "Codex",  "tone": "info" }
          ]
        }
      ]
    },
    {
      "label": "保存済みの API キー",
      "cells": [{ "type": "savedValue", "key": "apiKeyProvider" }]
    },
    {
      "label": "備考",
      "cells": ["常に表示される静的テキスト"]
    }
  ]
}
```

- `caption`（表題）は必須です。空・省略の場合はブロックごと表示されません。
- `columns`（任意）は列見出しの配列（`{ "label": "…" }`）。省略・空の場合は見出し無しの 1 列として扱います。
- `rows` の各要素は `label`（行見出し。**必須**。空・省略の行は表示されません）と `cells`（配列）を持ちます。`cells` は `columns` の数に合わせて自動的に詰め・切り詰めが行われるため、列数と要素数を必ず一致させる必要はありません（足りない分は空欄になります）。
- `cells` の各要素（セル）に置けるのは次の 4 種類だけです。リンク・ボタン・任意の HTML は置けません。
  - 文字列（例 `"備考"`）：そのまま表示するテキスト。空文字も指定できます。
  - `{ "type": "badge", "tone": "info" | "warning" | "error" | "success" | "neutral", "text": "…" }`：状態を表す小さなラベル。`tone` は callout / status と同じ語彙に `error` / `success` / `neutral` を加えたものです。色だけに頼らず、`info`/`warning`/`error`/`success` には見出し語（情報／注意／エラー／良好）を前置して表示します。`text` が空の場合は通常のテキストセル（空欄）として扱われます。
  - `{ "type": "fieldValue", "key": "<フィールドの key>", "map"?: [{ "value": "…", "label": "…", "tone"?: "…" }] }`：**今の入力値**（保存前の値を含む）を表示します。入力のたびに再計算され、画面上の表示も自動で更新されます。`map` の `value`（文字列化して比較）に現在値が一致すればバッジとして表示し、一致しなければ現在値をそのままテキスト表示します（未知の値を隠さないための既定動作です）。値が空・未設定の場合は「未設定」と表示します。参照する `key` は表と同じタブに限らず、モーダル内の任意のタブのフィールドを指せます。**参照先が `type: "password"` の欄の場合は値を出さず「（マスク中）」と表示します**（設定画面が `<input type="password">` で意図的にマスクしている値を表で迂回させないための必須の挙動です）。
  - `{ "type": "savedValue", "key": "<フィールドの key>" }`：**設定ファイルに実際に保存されている値**を表示します（今の入力値ではありません）。renderer だけでは分からないため、モーダルを開いたとき（および再試行時）に IPC で都度取得します。表内の複数セル分はまとめて 1 回の IPC 呼び出しで取得されます。取得中はそのセルだけ「確認中…」、失敗した場合はそのセルだけ「取得できません」＋再試行ボタンになります（表全体は止まりません）。**セキュリティ上の制約**: `key` はそのディスクリプタ自身が `groups[].fields[].key` として宣言しているキーだけが読めます。宣言されていないキー・`__proto__` 等の危険なキーセグメントを含むキー・`type: "password"` の欄を指すキーは、いずれもエラーになります（任意のキー・任意のパスを読み出せる窓口ではなく、マスク対象の秘密情報も返しません）。
- 表に `fieldValue` セルが 1 つでもある場合、未保存の変更がある間だけ表の直下に「この表は保存前の入力内容をもとに計算しています。実際に反映するには保存してください。」という注記が表示されます（読み上げの重複を避けるため、入力停止から約 300ms 後にまとめて 1 回だけ通知されます）。
- 列が `.settings-tab-panel` の実効幅（実測 522px）に収まらない場合は、表全体が横スクロールします。スクロール領域は Tab キーで到達でき、フォーカスした状態で ArrowLeft / ArrowRight（少しずつ）・Home / End（両端へ）でも操作できます。右端には「まだ続きがある」ことを示す固定のフェードを常時表示します（マウスホイール・トラックパッドでもスクロールできます）。
- `rows` は 1 表あたり最大 200 行までです。超過分は黙って切り詰められます（設定ディスクリプタは外部から差し替え可能な信頼できない入力のため、行数を定義側の良識に任せません）。

##### 一括切り替えボタン（`applyButton`）

表の直下に置き、押すと定義側が宣言した複数の設定欄へまとめて値をセットするボタンです（issue #380）。**その場では保存しません**。値をセットするだけで、実際にファイルへ書き込むには通常の「保存」ボタンを押す必要があります。

```jsonc
{
  "type": "applyButton",
  "label": "この端末を Claude 用に揃える",
  "confirmTemplate": "{count}件の設定を Claude 用の値に上書きします。今入力している内容は失われます。よろしいですか？",
  "sets": [
    { "key": "engine", "value": "claude" },
    { "key": "model",  "value": "claude-sonnet-5" }
  ],
  "danger": false
}
```

- `label`（必須）：ボタンのラベル文字列。
- `confirmTemplate`（必須）：上書き確認ダイアログに表示する文言。`{count}` は書き換え対象になった欄の数（無効化中の欄・存在しないキーを除いた実際の対象数）に renderer 側が置き換えます。定義側が件数を計算する必要はなく、むしろ独自に数字を書き込まないでください（対象を増減させたときに文面の数字だけずれる事故を防ぐためです）。
- `sets`（必須・1 件以上）：`{ "key": "<フィールドの key>", "value": <string | number | boolean | null> }` の配列。`key` はモーダル内の任意のタブのフィールドを指せます（同じ設定が複数タブに分かれているケースをまとめて切り替えるための仕組みのため）。`value` がこの 4 型以外の要素は間引かれ、有効な要素が 1 つも残らない場合はブロックごと表示されません。
- `danger`（任意・既定 `false`）：`true` にすると、ボタンへ `.settings-content-apply-button-danger` クラスが付き、危険な一括操作であることを示す強調色（既存の危険色トークンを再利用）で表示します。
- 押したときの挙動:
  - 対象の欄のうち、**現在無効化中（`disabledWhen` 等でグレーアウト）の欄・非表示（`visibleWhen` で隠れている）の欄・`type: "password"` の欄・存在しないキーの欄は対象から自動的に除外**されます（無効化中の値を固定する既存の仕組みと競合しないため、非表示の欄は検証をすり抜けて不正な値のまま保存されうるため、`password` はマスク対象の秘密情報を保護するための、それぞれ必須の挙動です）。対象がすべて除外される場合、ボタンは操作できない状態（`aria-disabled="true"`）になり、「対象の項目がすべて無効化されているため使用できません」という理由が添えられます。
  - 対象の中に savedValue セルの取得が完了していない表が紐づいている場合、取得が終わるまでボタンは操作を待たせます。
  - 対象欄のうち、**今の値と既に一致していない（＝上書きが発生する）欄が 1 つでもある場合だけ**、アプリ内の確認ダイアログ（`window.confirm()` は使いません）を挟みます。全欄が既に対象の値と一致している場合（実質的に何も失われない場合）は確認を挟まず、そのまま適用します。
  - 適用すると、対象の欄へ値をセットし、既存の「未保存」マーカー（タブの●）が対象欄を含む**すべてのタブ**に立ちます（別タブの項目が変わったことも伝えるため）。今見ているタブ内で変わった行は一時的に背景色でフラッシュします（`prefers-reduced-motion` を尊重し、アニメーションを減らす設定では点滅しません）。
  - 完了すると、画面下部のトーストで結果を要約します（例:「3件の設定を切り替えました。保存するには「保存」を押してください。」／一部が対象外だった場合は「2件の設定を切り替えました（1件は対象外です。無効化中・非表示・保護対象の項目や、反映できない値だったため）。保存するには「保存」を押してください。」）。対象外の理由（無効化中・非表示・`password` 型・反映できない値）は問わず中立な言い回しにしています。
  - `number` 欄への非数値・`select` 欄の未知の選択肢など、ブラウザが受理しない値は書き込まれず対象外（トーストの「対象外」件数側）として扱われます。

### 外部設定ディスクリプタのフィールド契約

外部ディスクリプタの各フィールドでは、通常の `text` / `select` 等に加えて次の指定を使えます。

- `type: "combo"`：候補を示しつつ自由入力も許可する入力欄。`options` は `[{ "value": "保存値", "label": "表示名" }]` の形式で指定します。
- `visibleWhen`：条件一致時に表示します。条件へ `hide: true` を付けた場合は一致時に非表示になります。
- `disabledWhen`：条件一致時に値を保持したまま編集を無効化します。`disabledReason` に理由を書くと、無効時だけ表示され、入力欄の読み上げ対象にもなります。
- 条件を配列で指定すると AND、`{ "anyOf": [...] }` で包むと OR になります。条件は `{ "key": "参照先フィールド", "value": "比較値" }` の形式で、比較時は現在値と `value` を文字列化します。

```json
{
  "key": "model",
  "label": "モデル",
  "type": "combo",
  "options": [{ "value": "gpt-5.6-sol", "label": "GPT-5.6 Sol" }],
  "visibleWhen": { "anyOf": [
    { "key": "engine", "value": "claude" },
    { "key": "engine", "value": "codex" }
  ] },
  "disabledWhen": { "key": "engine", "value": "codex" },
  "disabledReason": "Codex 選択中は変更できません。"
}
```

参照先キーの欠落は条件不一致として扱います。形式が壊れた条件や 5 段を超える `anyOf` は fail-open とし、設定画面全体を操作不能にしないため、`visibleWhen` では表示、`disabledWhen` では編集可能になります。

### 組み込み設定スキーマ

単体起動時の設定パネル項目は、リポジトリ直下の `settings-schema.json` を単一ソースとして読み込みます。`settings-schema.json` には `groups` 配列と各 `field` の `key` / `label` / `type` / `default` / `help` / `placeholder` / `options` / `emptyToNull` などの静的な定義だけを置き、実行時に決まる編集対象ファイルの `targetPath` はアプリ側で `loadUserConfig()` と同じ探索順から合成します。

呼び出し側（例: vk-orchestrator）は、この JSON を読み込んで表示したい `key` だけを選んだり、`title` / `note` / `label` / `help` などの文言を上書きしたりできます。

組み込みスキーマは「設定」（全設定項目）と「モバイルから確認」（Tailscale 経由でスマートフォンから見る手順の案内。入力欄は無く読み取り専用）の 2 タブ構成です。`VK_TERMINALS_SETTINGS` で外部ディスクリプタを指定している場合は組み込みスキーマを読まないため、これらのタブは表示されません（設定パネルの内容は外部ディスクリプタが持つ、という既存の仕様どおりです）。

組み込みスキーマの運用メモ:

- `confirmClose` は既定 `busy`（実行中・入力待ちのみ確認）です。ペインの ✕ ボタンで閉じる操作にだけ適用され、HTTP API 経由（force）の自動クローズには適用されません。
- `showUsage` は opt-out（既定 ON）です。`default: true` により、未設定の boolean が設定保存時に誤って `false` になることを避けています。
- `gpu` は環境変数 `VK_TERMINALS_GPU` が最優先で、未指定時に `config.json` の `gpu`（設定パネル保存値）を使います。空値はプラットフォーム既定です。
- `agentroom` は issue #70 で β 機能を一旦無効化しているため、`settings-schema.json` には含めていません。設定パネルへ復帰する場合は任意の group の `fields` に `{ "key": "agentroom", "label": "エージェントルーム（β）表示", "type": "boolean" }` を追加し、`app:get-config` の `agentroom` 返却値を `config.agentroom === true` に戻してください。

## HTTP API（外部連携用）

アプリ起動時にローカル HTTP API サーバーが `http://127.0.0.1:13847` で起動します。外部スクリプトや Claude Code の監視スキルからターミナルを操作できます。

### エンドポイント

#### アクセストークン認証（issue #313）

実際に待ち受けているアドレスが `127.0.0.1` 以外の場合（LAN IP や Tailscale IP を `apiHost` に指定した場合、または設定パネルで「常にアクセストークン認証を必須にする」を有効にした場合）、この節に挙げる `/api/*` エンドポイントは `GET /api/health` を除く**すべて**でアクセストークンによる認証が必須になります（ページ本体を構成する静的ファイルは別枠で認証不要です。[セキュリティ上の注意](#セキュリティ上の注意)を参照）。`127.0.0.1`（既定）のままなら認証不要ですが、以下の例には `apiHost` を変更した場合にもそのまま使えるよう、常に `Authorization` ヘッダを付けています。

トークンは初回起動時に自動生成され `~/.vk-terminals/config.json` の `apiToken` に保存されます。値はこのファイルを直接開いて確認してください（設定パネルはトークン単体を表示しません。スマートフォンの登録に必要なのはトークン込みの「初回登録用の URL」だけのため、パネルはそちらの表示・コピーと再発行に絞っています）。認証が必要な状態でトークンを付けずにリクエストすると `401 {"error": "unauthorized"}` が返ります。

```bash
curl -s http://127.0.0.1:13847/api/states \
  -H 'Authorization: Bearer <アクセストークン>'
```

#### `GET /api/health`

ヘルスチェック（`/api/*` の中で唯一、認証不要のエンドポイントです。ページ本体を構成する静的ファイルも別枠で認証不要ですが、それらは `/api/*` の一覧には含めていません）。

```bash
curl -s http://127.0.0.1:13847/api/health
# => {"ok":true}
```

#### `GET /api/states`

全ターミナルの状態を取得。

```bash
curl -s http://127.0.0.1:13847/api/states \
  -H 'Authorization: Bearer <アクセストークン>' | python3 -m json.tool
```

レスポンス例:

```json
{
  "updatedAt": "2026-04-17T10:00:00.000Z",
  "terminals": {
    "pane-1": {
      "termId": "1",
      "cwd": "/Users/you/project",
      "cwdShort": "~/project",
      "waiting": false,
      "externalWaiting": false,
      "status": "idle",
      "lastOutputTime": 1713340800000,
      "lastInputTime": 1713340790000,
      "lastLines": "最近の出力15行分...",
      "backgroundAgents": 0,
      "agentGeneration": 1
    }
  }
}
```

| フィールド | 説明 |
|---|---|
| `termId` | ターミナル ID（`/api/send` で使用） |
| `cwd` / `cwdShort` | カレントディレクトリ（フルパス / 短縮表示） |
| `waiting` | 入力待ち状態（権限確認プロンプト等）かどうか |
| `externalWaiting` | `POST /api/set-status` で設定された外部権威の入力待ち状態 |
| `status` | 表示用ステータス（`idle` / `running` / `waiting`） |
| `lastOutputTime` | 最後に出力があった時刻（Unix ms） |
| `lastInputTime` | 最後にユーザーが入力した時刻（Unix ms） |
| `agentGeneration` | ペイン内で起動した AI の世代番号。AI 起動ペインは `1`、素のシェルは `0` で始まり、`POST /api/restart-agent` 成功ごとに 1 増加 |
| `lastLines` | 最近の出力テキスト（ANSI除去済み、最大15行） |
| `backgroundAgents` | そのペインでバックグラウンドに動いている Claude Code サブエージェント数（issue #340）。画面末尾のフッター表示（`← N agents` 等）から判定した整数（0 以上）、または判定できないときは `null`（不明）。`0` と `null` は区別されており、`null` は「フッターが読み取れる Claude Code の画面ではない」等の判定不能を表す（バックグラウンドで動くサブエージェントが無いことが確定した状態は `0`）。ペイン幅が狭くフッター表示が `…` で截断され、agents 表示の有無を確認しきれない場合も `0` と断定せず `null` になる。サブエージェントが終了すると `0` に戻る。司令塔（vk-orchestrator）はこの値が `null` のときは、従来どおり `lastOutputTime` だけでペインの稼働を判定する想定 |

各ペインには上記に加え、`POST /api/set-title` 由来の `apiTitle` / `apiUrl` / `apiPrUrl` / `apiPrMerged` / `apiWaitingMerge`、`agentroom: true` のときは `agentRoom` も含まれます（各エンドポイントの節を参照）。

また、レスポンスのトップレベルには `updatedAt` / `terminals` に加えて `usage`（Claude の使用量スナップショット）が含まれます。使用量表示が opt-out（`showUsage: false`）または取得失敗のときは `usage: null` です（後方互換）。モバイルページはこの `usage` を利用します（後述の[Claude 使用量表示](#claude-使用量表示)を参照）。

#### `POST /api/send`

指定ターミナルにコマンドを送信。

```bash
curl -s -X POST http://127.0.0.1:13847/api/send \
  -H 'Authorization: Bearer <アクセストークン>' \
  -H 'Content-Type: application/json' \
  -d '{"termId": "1", "input": "y\r"}'
```

- `termId`: 送信先のターミナル ID（`/api/states` で確認）
- `input`: 送信するテキスト。改行を送る場合は末尾に `\r` を付ける

送信成功時、対象ペインに「🤖 自動入力」バッジが3秒間表示されます。

#### `POST /api/set-title`

指定ペイン上部の「タスクタイトル行」に表示する文字列を設定します。任意で外部リンクの URL を渡すと、タイトル全体がリンク化され、クリックで OS の既定ブラウザで開きます。あわせて `prUrl` を渡すと、タイトル行の右端に独立した `PR ↗` ボタンが表示されます。

```bash
# タイトルだけ設定（リンクなし）
curl -s -X POST http://127.0.0.1:13847/api/set-title \
  -H 'Authorization: Bearer <アクセストークン>' \
  -H 'Content-Type: application/json' \
  -d '{"termId": "1", "title": "issue #29 対応中"}'

# タイトルとリンク URL をセットで設定
curl -s -X POST http://127.0.0.1:13847/api/set-title \
  -H 'Authorization: Bearer <アクセストークン>' \
  -H 'Content-Type: application/json' \
  -d '{"termId": "1", "title": "issue #29", "url": "https://github.com/vektor-inc/vk-terminals/issues/29"}'

# タイトル・issue リンク・PR ボタンをまとめて設定
curl -s -X POST http://127.0.0.1:13847/api/set-title \
  -H 'Authorization: Bearer <アクセストークン>' \
  -H 'Content-Type: application/json' \
  -d '{"termId": "1", "title": "issue #44", "url": "https://github.com/vektor-inc/vk-terminals/issues/44", "prUrl": "https://github.com/vektor-inc/vk-terminals/pull/99"}'

# PR ボタンをマージ済み表示（紫）にする
curl -s -X POST http://127.0.0.1:13847/api/set-title \
  -H 'Authorization: Bearer <アクセストークン>' \
  -H 'Content-Type: application/json' \
  -d '{"termId": "1", "title": "issue #44", "prUrl": "https://github.com/vektor-inc/vk-terminals/pull/99", "prMerged": true}'

# PR ボタンをマージ待ち表示（青）にする（issue #363）
curl -s -X POST http://127.0.0.1:13847/api/set-title \
  -H 'Authorization: Bearer <アクセストークン>' \
  -H 'Content-Type: application/json' \
  -d '{"termId": "1", "title": "issue #44", "prUrl": "https://github.com/vektor-inc/vk-terminals/pull/99", "waitingMerge": true}'

# タイトル・URL・PR ボタンをクリア（空文字で消す）
curl -s -X POST http://127.0.0.1:13847/api/set-title \
  -H 'Authorization: Bearer <アクセストークン>' \
  -H 'Content-Type: application/json' \
  -d '{"termId": "1", "title": "", "url": "", "prUrl": ""}'
```

リクエストボディ:

- `termId`: 対象のターミナル ID（必須）
- `title`: 表示する文字列。空文字 `""` を渡すと API 由来タイトルがクリアされ、OSC 由来タイトル（`taskTitle`）にフォールバックします。
- `url`（任意）: タイトル全体をリンク化するための URL。`http(s):` スキームのみ許可、2048 文字以内、`new URL()` で parse 可能であることが必須。違反時は `400` を返します。空文字 `""` を渡すと既存の URL がクリアされます。省略すると URL なしになります。
- `prUrl`（任意・issue #44）: タイトル行の右端に独立して表示する `PR ↗` ボタンに紐づける URL。バリデーションは `url` と完全同一（`http(s):` のみ・2048 文字以内・`new URL()` で parse 可）。空文字 `""` を渡すと PR ボタンが消えます。省略すると PR ボタンなしになります。
- `prMerged`（任意・issue #113）: `PR ↗` ボタンをマージ済み表示（紫背景 + 非色アイコン）にする真偽値。**厳密な `true` のときだけ**マージ済み表示になり、それ以外の値（省略・`false`・文字列など）は通常表示（未マージ）になります。`prUrl` と組み合わせて使います。
- `waitingMerge`（任意・issue #363）: `PR ↗` ボタンをマージ待ち表示（青背景 + 非色アイコン）にする真偽値。`prMerged` と同じく**厳密な `true` のときだけ**マージ待ち表示になり、それ以外の値（省略・`false`・文字列など）は「PR が出ただけ」表示（灰背景）になります。`prMerged` と同時に `true` を送った場合は `prMerged` が優先されます（マージ済みが最終状態のため）。フィールド名は送信側（vk-orchestrator）の実装に合わせています（`prWaitingMerge` ではありません）。

| 挙動 |
|---|
| `title` / `url` / `prUrl` はペアで都度送る**置換セマンティクス**です（patch 形式ではありません）。一部だけ更新したい場合でも、必要な値はその都度すべて一緒に送る必要があります（送らないフィールドは「なし」扱いになります）。 |
| `url` が設定されている間のみ、ペインのタイトル文字列全体が `<a>` として描画され、末尾に外部リンクマーク `↗` が付きます。クリックすると `shell.openExternal()` で OS の既定ブラウザを開きます。 |
| OSC 0 / OSC 2 由来のタイトル（`taskTitle`）が表示されている間は `url` のリンク化は無効になります。API 由来のタイトル（`apiTitle`）が選択されているときだけリンク化されます。 |
| `prUrl` で表示される `PR ↗` ボタンは `apiTitle` / `taskTitle` のどちらが表示されている間でも常時表示されます（issue リンクが消える場面でも PR ボタンは独立に出続けます）。 |
| `prUrl` だけを送った場合（`prMerged` も `waitingMerge` も省略）は「PR が出ただけ」表示（灰背景）になります。`prMerged: true` を送ると紫（マージ済み）、`waitingMerge: true` を送ると青（マージ待ち）に変わります。いずれも他フィールド同様に置換セマンティクスで、送らなければ「PR が出ただけ」表示に戻ります。 |

レスポンス例:

```json
{ "ok": true, "termId": "1", "title": "issue #44", "url": "https://github.com/vektor-inc/vk-terminals/issues/44", "prUrl": "https://github.com/vektor-inc/vk-terminals/pull/99", "prMerged": true, "waitingMerge": false }
```

エラー例:

- `400 {"error": "url must be http(s)"}` — `file:` などの非 http(s) スキーム
- `400 {"error": "invalid url"}` — `new URL()` で parse 失敗
- `400 {"error": "url too long (max 2048 chars)"}` — 2048 文字超過
- `400 {"error": "prUrl must be http(s)"}` — `prUrl` フィールドのスキーム違反
- `400 {"error": "invalid prUrl"}` — `prUrl` フィールドが `new URL()` で parse 失敗
- `400 {"error": "prUrl too long (max 2048 chars)"}` — `prUrl` フィールドが 2048 文字超過
- `404 {"error": "terminal <id> not found"}` — 指定 `termId` のペインが存在しない

バリデーション動作確認用のリクエスト例（リグレッション検知用）:

```bash
# 大文字スキーム（`new URL()` がプロトコルを小文字化するため http(s) 判定で弾かれる）
curl -i -s -X POST http://127.0.0.1:13847/api/set-title \
  -H 'Authorization: Bearer <アクセストークン>' \
  -H 'Content-Type: application/json' \
  -d '{"termId":"1","title":"x","url":"JAVASCRIPT:alert(1)"}'
# => 400 {"error":"url must be http(s)"}

# javascript: スキーム
curl -i -s -X POST http://127.0.0.1:13847/api/set-title \
  -H 'Authorization: Bearer <アクセストークン>' \
  -H 'Content-Type: application/json' \
  -d '{"termId":"1","title":"x","url":"javascript:alert(1)"}'
# => 400 {"error":"url must be http(s)"}

# data: スキーム
curl -i -s -X POST http://127.0.0.1:13847/api/set-title \
  -H 'Authorization: Bearer <アクセストークン>' \
  -H 'Content-Type: application/json' \
  -d '{"termId":"1","title":"x","url":"data:text/html,<script>alert(1)</script>"}'
# => 400 {"error":"url must be http(s)"}
```

設定された値は `GET /api/states` のレスポンス（および `~/.vk-terminals/states.json`）の各ペインオブジェクトに `apiTitle` / `apiUrl` / `apiPrUrl` / `apiPrMerged` / `apiWaitingMerge` フィールドとして含まれます。

#### `POST /api/set-status`

指定ペインの入力待ち状態を外部権威として設定します。オーケストレーター等が GitHub status などの外部状態をもとに、ローカル PTY のパターン検知とは別レイヤーで `waiting` 表示を制御するための API です。

```bash
# 外部権威の入力待ちフラグを立てる
curl -s -X POST http://127.0.0.1:13847/api/set-status \
  -H 'Authorization: Bearer <アクセストークン>' \
  -H 'Content-Type: application/json' \
  -d '{"termId": "1", "waiting": true}'

# 外部権威の入力待ちフラグを解除する
curl -s -X POST http://127.0.0.1:13847/api/set-status \
  -H 'Authorization: Bearer <アクセストークン>' \
  -H 'Content-Type: application/json' \
  -d '{"termId": "1", "waiting": false}'
```

リクエストボディ:

- `termId`: 対象のターミナル ID（必須）
- `waiting`: 外部権威の入力待ち状態（真偽値必須）。文字列 `"true"` / `"false"` は受け付けません。

挙動:

- `waiting: true` を送ると、ローカル PTY 検知の `waiting` が false でも表示用 `status` は `waiting` になります。
- `waiting: false` を送ると、外部権威フラグだけを解除します。ローカル PTY 検知の `waiting` が true の場合、表示用 `status` は引き続き `waiting` です。
- 外部権威フラグは自動入力（`POST /api/send`）・リサイズ・再描画では解除されず、`POST /api/set-status` で `waiting: false` が明示 push されたときだけ解除されます。

レスポンス例:

```json
{ "ok": true, "termId": "1", "waiting": true }
```

エラー例:

- `400 {"error": "termId required"}` — `termId` 未指定
- `400 {"error": "waiting must be a boolean"}` — `waiting` が真偽値以外
- `404 {"error": "terminal <id> not found"}` — 指定 `termId` のペインが存在しない

設定された値は `GET /api/states` のレスポンス（および `~/.vk-terminals/states.json`）の各ペインオブジェクトに `externalWaiting` フィールドとして含まれます。表示用 `status` はローカル `waiting` と `externalWaiting` の OR で `waiting` になります。

#### `POST /api/new-pane`

新規ペインを作成し、作成されたターミナルの `termId` を返します。ペインは通常グリッドの末尾に追加され、全体は自動折返しグリッドで再配置されます。`stashed: true` を指定した場合はサイドバー格納＋折りたたみ状態で作成されます。

```bash
curl -s -X POST http://127.0.0.1:13847/api/new-pane \
  -H 'Authorization: Bearer <アクセストークン>'
# => {"ok":true,"termId":"3"}

# cwd を指定して開く
curl -s -X POST http://127.0.0.1:13847/api/new-pane \
  -H 'Authorization: Bearer <アクセストークン>' \
  -H 'Content-Type: application/json' \
  -d '{"cwd": "/Users/you/Documents/git/your-project"}'

# claude を起動せず素のシェルとして開く
curl -s -X POST http://127.0.0.1:13847/api/new-pane \
  -H 'Authorization: Bearer <アクセストークン>' \
  -H 'Content-Type: application/json' \
  -d '{"noClaude": true}'

# Codex を起動する
curl -s -X POST http://127.0.0.1:13847/api/new-pane \
  -H 'Authorization: Bearer <アクセストークン>' \
  -H 'Content-Type: application/json' \
  -d '{"engine": "codex"}'

# サイドバーに格納して折りたたみ状態で開く
curl -s -X POST http://127.0.0.1:13847/api/new-pane \
  -H 'Authorization: Bearer <アクセストークン>' \
  -H 'Content-Type: application/json' \
  -d '{"stashed": true}'

# モデルを指定して claude を起動する
curl -s -X POST http://127.0.0.1:13847/api/new-pane \
  -H 'Authorization: Bearer <アクセストークン>' \
  -H 'Content-Type: application/json' \
  -d '{"model": "sonnet"}'

# モデルを指定して Codex を起動する
curl -s -X POST http://127.0.0.1:13847/api/new-pane \
  -H 'Authorization: Bearer <アクセストークン>' \
  -H 'Content-Type: application/json' \
  -d '{"engine": "codex", "model": "gpt-5.6-sol"}'
```

リクエストボディ（任意）:

- `cwd`：新規ペインのカレントディレクトリ（絶対パス）。未指定ならホームディレクトリ。
- `noClaude`：`true` の場合、新規ペインで AI を自動起動せず素のシェルとして開く。未指定なら起動時の `--no-claude` フラグの値に従う。名前が `claude` 前提になっているのは歴史的経緯で、`engine: "codex"` と併用した場合も同様に無効化されます（AI は一切起動しません）。
- `engine`：新規ペインで起動する AI エンジン。指定できるのは `"claude"` / `"codex"` のみ（許可リスト方式）。未指定の場合は従来どおり `"claude"` を起動します＝既存の呼び出し元に影響はありません。それ以外の値（未対応の文字列・空文字・文字列以外）は `400` で拒否され、**ペインは作成されません**。
- `stashed`：`true` の場合、新規ペインをサイドバー格納＋折りたたみ状態で開く。未指定または `false` ならグリッドに追加。
- `model`：新規ペインで起動する AI エンジンのモデル名。`engine: "claude"`（省略時含む）では `claude --model '<model>'`、`engine: "codex"` では `codex --model '<model>'` として実行されます。Claude Code では `sonnet` / `opus` や `claude-opus-5[1m]`、Codex では `gpt-5.6-sol` / `gpt-5.5` / `o3` のような値を指定できます。**未指定の場合は選択したエンジンを引数なしで実行**し、各エンジン側のデフォルトモデルで起動します。
  - 指定できるのは **英数字・`.`・`_`・`-`・`[`・`]` のみ、64 文字以内、先頭は英数字** の文字列。それ以外の文字（空白・`;`・`&`・`` ` ``・`$`・引用符・改行など）を含む値、長すぎる値、文字列でない値は、どちらの `engine` でも `400` で拒否され、**ペインは作成されません**（値が実在するモデル名かどうかまでは検証していません。文字種・長さのチェックのみです）。
  - 値が選択した `engine` に対応するモデル名かどうかは検証しません。エンジンに合わないモデル名を渡すとペインは作成されますが、AI 側の起動時にエラーになります。呼び出し側で `engine` と `model` の組み合わせを確認してから送信してください。
  - `noClaude: true` と同時に指定した場合は AI を起動しないため、`model` は無視されます。

`noClaude` / `engine` / `model` の優先順位（併用した場合にどれが効くか）:

| 指定 | 優先順位 | 挙動 |
|---|---|---|
| `noClaude: true` | 最優先 | `engine`・`model` の指定にかかわらず AI を起動せず素のシェルを開く |
| `engine` | 次点 | `"claude"`（省略時の既定）なら Claude Code、`"codex"` なら Codex を起動 |
| `model` | 選択した `engine` に適用 | Claude Code は `claude --model '<値>'`、Codex は `codex --model '<値>'` として起動 |

ただし `engine` 自体の値が不正な場合（許可リストに無い文字列・文字列以外など）は、`noClaude` の値によらず `400` で拒否されペインは作成されません。`model` が不正な場合も同様に、どちらの `engine` でも `noClaude` の値によらず `400` で拒否されます（`{"noClaude": true, "model": "bad;value"}` のような組み合わせでも `400 invalid model` になります）。いずれも、不正値のチェックは `noClaude` の反映より先に行われるためです。

レスポンス:

- 成功時: `200 {"ok": true, "termId": "<新規ターミナルID>"}`
- `engine` が不正: `400 {"error": "invalid engine (allowed: \"claude\", \"codex\")"}`
- `model` が不正: `400 {"error": "invalid model"}`
- 不正な JSON: `400 {"error": "invalid JSON"}`
- ウィンドウが利用できない: `503 {"error": "window not available"}`
- タイムアウト（15秒）: `504 {"error": "timeout waiting for new pane"}`
- renderer 側でペイン作成に失敗（既存ペインなし／分割失敗など）: `500 {"error": "<renderer からのエラーメッセージ>"}`

#### `POST /api/restart-agent`

ペインを閉じずに、ログインシェル配下で動く AI だけを停止確認して起動し直します。別タスクへ入れ替わったペインを誤って止めないよう、直前の `GET /api/states` で得た `agentGeneration` を必ず指定します。

```bash
curl -s -X POST http://127.0.0.1:13847/api/restart-agent \
  -H 'Authorization: Bearer <アクセストークン>' \
  -H 'Content-Type: application/json' \
  -d '{"termId":"1","expectedGeneration":1,"cwd":"/Users/you/project","engine":"claude","model":"sonnet"}'
# => {"ok":true,"termId":"1","stopped":true,"generation":2}
```

リクエストボディ:

- `termId`：対象のターミナル ID（必須）。
- `expectedGeneration`：呼び出し元が認識している現在の世代番号（必須、0 以上の整数）。現在値と一致しない場合は何も停止・起動せず `409` を返します。
- `cwd`：再起動後の作業ディレクトリ（任意）。省略時は現在のディレクトリを維持します。存在するディレクトリだけを指定できます。
- `engine`：`"claude"` / `"codex"`（任意、省略時は `"claude"`）。
- `model`：選択エンジンへ渡すモデル名（任意）。検証規則は `POST /api/new-pane` と同じです。

レスポンス:

- 成功時: `200 {"ok":true,"termId":"<ID>","stopped":true,"generation":<次の世代>}`
- JSON・必須値・`engine`・`model`・`cwd` が不正: `400 {"error":"<理由>"}`
- Origin が不正: `403 {"error":"forbidden origin"}`
- 指定ペインが存在しない: `404 {"error":"terminal <id> not found"}`
- 世代が一致しない: `409 {"error":"generation mismatch","currentGeneration":<現在の世代>}`
- 子プロセスの停止を確認できない: `500 {"error":"failed to stop agent"}`（`SIGKILL` まで送った後でも消滅を確認できなかった場合を含みます。この場合「何も起きなかった」わけではなく、対象ペインの AI が停止した状態のまま残っている可能性があるため、呼び出し元は再試行や状態確認を行ってください）

停止時はまず `SIGTERM` を送り、猶予後も残る子孫プロセスには `SIGKILL` を送ります。ログインシェル配下のすべての子孫プロセスが対象になるため、そのペインで手動起動した `npm run dev` 等の常駐プロセスも停止します。PTY のログインシェル自身は停止せず、対象 PID が実際に消えたことを確認してから新しい AI を起動します。Windows ではこの操作に対応していません。

#### `POST /api/close-pane`

指定した `termId` のペインを閉じます（`✕` ボタンと同じ操作を外部から実行します）。

```bash
curl -s -X POST http://127.0.0.1:13847/api/close-pane \
  -H 'Authorization: Bearer <アクセストークン>' \
  -H 'Content-Type: application/json' \
  -d '{"termId": "3"}'
# => {"ok":true,"termId":"3"}
```

リクエストボディ:

- `termId`：閉じる対象のターミナル ID（必須）。

レスポンス:

- 成功時: `200 {"ok": true, "termId": "<閉じたターミナルID>"}`
- `termId` 未指定: `400 {"error": "termId required"}`
- 不正な JSON: `400 {"error": "invalid JSON"}`
- 指定 `termId` のペインが存在しない: `404 {"error": "terminal <id> not found"}`
- ウィンドウが利用できない: `503 {"error": "window not available"}`
- タイムアウト（15秒）: `504 {"error": "timeout waiting for close pane"}`

#### `POST /api/menu`

サイドバーに表示する追加メニュー項目を `source` 単位で登録・置換します（`config.json` の `menuItems` と同じ内容を外部から動的に反映させる用途）。同じ `source` を再送すると置換、`items: []` を送るとその `source` の項目をクリアします。

```bash
# source ごとにメニュー項目を登録・置換
curl -s -X POST http://127.0.0.1:13847/api/menu \
  -H 'Authorization: Bearer <アクセストークン>' \
  -H 'Content-Type: application/json' \
  -d '{
        "source": "vk-orchestrator",
        "title": "VK Orchestrator",
        "items": [
          { "id": "task-queue", "label": "task-queue", "icon": "📋",
            "action": { "type": "open-url", "url": "https://github.com/vektor-inc/task-queue/issues" } }
        ]
      }'

# 指定 source の項目をクリア
curl -s -X POST http://127.0.0.1:13847/api/menu \
  -H 'Authorization: Bearer <アクセストークン>' \
  -H 'Content-Type: application/json' \
  -d '{"source": "vk-orchestrator", "items": []}'
```

リクエストボディ:

- `source`：メニューのグループ識別子（必須）。同じ `source` の再送で置換されます。
- `title`（任意）：サイドバーに表示するグループ見出し。
- `items`：メニュー項目の配列。各項目は `id` / `label` / `icon`（任意）/ `action` を持ちます。`action.type` は `open-url`（`url` を OS の既定ブラウザで開く）または `open-settings`（設定モーダルを開く）のみ対応。`items: []` で該当 `source` をクリアします。

レスポンス:

- 成功時: `200 {"ok": true, "source": "<source>"}`
- バリデーション違反 / 不正な JSON: `400 {"error": "<内容>"}`
- 登録済み source 数の上限超過: `400 {"error": "too many menu sources (max <N>)"}`

> サイドバーメニューの詳細は後述の[サイドバーメニュー](#サイドバーメニュー)を参照してください。

#### `POST /api/agentroom`

エージェントルーム（後述）の各キャラの稼働状況を更新します。`config.json` の `agentroom: true` のときだけ表示に反映されます。

```bash
# ルーム状態を丸ごと置換（agents オブジェクト）
curl -s -X POST http://127.0.0.1:13847/api/agentroom \
  -H 'Authorization: Bearer <アクセストークン>' \
  -H 'Content-Type: application/json' \
  -d '{"termId": "1", "agents": {"司": "consulting", "和田": "working", "麗美": "working"}}'

# 1 人だけ更新（agent + state のマージ）
curl -s -X POST http://127.0.0.1:13847/api/agentroom \
  -H 'Authorization: Bearer <アクセストークン>' \
  -H 'Content-Type: application/json' \
  -d '{"termId": "1", "agent": "麗美", "state": "idle"}'
```

リクエストボディ:

- `termId`：対象のターミナル ID（必須）。
- `agents`：`{ "<キャラ名>": "<state>" }` のオブジェクト。指定するとそのペインのルーム状態を**丸ごと置換**します。
- `agent` + `state`：1 人だけ更新（既存状態にマージ）。`agents` と `agent` のどちらかは必須。
- `state` の語彙：`consulting`（相談中）／`working`（作業中）／`idle`（待機中）／`off`（離席）。日本語（「相談」「作業」「テスト」「待機」「離席」等）や大文字でも受け付け、表示側で正規化します。
- キャラ名は `司` / `和田` / `安藤` / `麗美` / `植草`。未知の名前は無視されます。

更新は最終受信から 90 秒間「新鮮」として優先表示され、それを過ぎると PTY 出力ベースのフォールバック表示に切り替わります（[エージェントルーム](#エージェントルームissue-58)を参照）。

### 状態ファイル

`~/.vk-terminals/states.json` に2秒ごとに全ターミナルの状態が書き出されます。HTTP API と同じ内容です。アプリ終了時に自動削除されます。`agentroom: true` のときは各ペインに解決済みのルーム状態 `agentRoom`（`{ "<キャラ名>": "<state>" }`）も含まれます。

## エージェントルーム（issue #58）

> **現状（β・一旦無効化）**: エージェントルームは β 機能として、issue #70 で設定パネルからの項目とデフォルト表示を無効化しています。設定パネルからは切り替えられません。以下の内容は `config.json` に直接 `agentroom: true` を記述して有効化した場合の挙動です。

`config.json` で `agentroom: true` にすると、各ペイン下部に開閉式（アコーディオン）の「エージェントルーム」が表示されます。司／和田／安藤／麗美／植草の 5 キャラを、Gather / WorkAdventure 風のチビキャラ（ドット絵）で次のように描き分けます。

| state | 表示 |
|---|---|
| `consulting`（相談中） | テーブルを囲み、吹き出しを出す |
| `working`（作業中） | デスクで PC（モニタ）に向かう |
| `idle`（待機中） | コーヒーを飲む |
| `off`（離席） | 薄く表示 |

状態は 2 系統で供給されます。

1. **HTTP API（正確）**: 上記 `POST /api/agentroom` で各キャラの状態を通知します。スキル（staff-director など）からサブエージェントの起動・終了時に ping する想定です。
2. **PTY 出力ベースのフォールバック**: API 未通知 / 古い場合、司（メイン Claude）はペインの稼働ステータス（実行中→作業中／入力待ち→相談中／それ以外→待機中）を写像し、その他のキャラは直近の出力にその名前が出ていれば作業中とみなします（ベストエフォート）。

## 技術スタック

- [Electron](https://www.electronjs.org/)
- [xterm.js](https://xtermjs.org/) (`@xterm/xterm`)
- [node-pty](https://github.com/microsoft/node-pty)
