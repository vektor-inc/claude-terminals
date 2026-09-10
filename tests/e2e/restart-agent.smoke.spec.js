const { test, expect } = require('@playwright/test');
const fs = require('fs');
const os = require('os');
const path = require('path');
// 起動〜初期描画待ちは共通ヘルパーへ集約している（issue #263 / #269）。
const { closeApp, getFreePort, launchAppAndWait } = require('./helpers/electron-app');

// issue #392 / PR #393: POST /api/restart-agent（ペインを閉じずに、その配下で動いている
// AI（Claude Code / Codex）だけを停止して起動し直す API）の end-to-end 確認。
// issue #392 の完了条件をそのまま観点にしている。
//   1. 再起動の前後でペイン数・並び・termId が変わらないこと
//   2. expectedGeneration が食い違う場合は何も停止・起動しないまま 409 で拒否すること
//   3. 成功時の応答（stopped / generation）から停止の完了と再起動後の世代番号が確認できること
//   4. GET /api/states の各ペインから agentGeneration が読めること
//      （AI 起動ペインは 1、素のシェルのペインは 0 で始まり、再起動成功後に増える）
//   5. 既存の /api/states のキー（termId / cwd / status / lastOutputTime / backgroundAgents）
//      にデグレが無いこと
//
// tests/e2e/new-pane-engine.smoke.spec.js・tests/e2e/close-pane.smoke.spec.js と同じ手法
// （HOME の一時化・動的ポート取得・_electron.launch への env 展開）に合わせている。
//
// 【この環境で検証できない観点】
// テスト環境には Claude Code / Codex の実体が無いため、new-pane-engine.smoke.spec.js と
// 同じ手法で PATH の先頭に偽 claude / 偽 codex を置く。偽実行ファイルは引数を記録して
// 即終了するだけの Node スクリプトのため、「起動し続けている実 AI プロセスを実際に
// SIGTERM/SIGKILL で停止させる」動作そのものは検証できない
// （utils/restartAgent.js の stopAgentChildren は追跡対象の子プロセスが既に存在しない場合、
// 何も送信せずに stopped=true を返す実装になっている）。
// ここで検証できるのは、ペインが閉じないこと・世代番号の初期値と増減・409 拒否時に
// 何も再起動されないこと・GET /api/states の agentGeneration・起動コマンドが実際に
// PTY へ書き込まれたこと（偽実行ファイルが呼ばれたこと）までである。

// GET /api/states を叩き、terminals（paneId -> state）を返す。
async function getStates(port) {
  const res = await fetch(`http://127.0.0.1:${port}/api/states`);
  if (res.status !== 200) throw new Error(`/api/states returned ${res.status}`);
  const json = await res.json();
  return json.terminals || {};
}

function findTermState(states, termId) {
  return Object.values(states).find((t) => t && String(t.termId) === String(termId)) || null;
}

// states 内に存在する termId の一覧（文字列）を返す。
function termIdsOf(states) {
  return Object.values(states)
    .map((t) => (t && t.termId != null ? String(t.termId) : null))
    .filter(Boolean);
}

async function getPaneCount(port) {
  return Object.keys(await getStates(port)).length;
}

// API サーバー起動直後や renderer の定期報告待ちを吸収し、指定したペイン数になるまで待つ。
async function waitForPaneCount(port, expected, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  let lastCount = null;
  while (Date.now() < deadline) {
    try {
      lastCount = await getPaneCount(port);
      if (lastCount === expected) return;
    } catch (_e) {
      // HTTP サーバー起動前の fetch 失敗は同じ待機ループで吸収する。
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`pane count did not become ${expected}; last count: ${lastCount}`);
}

// 指定 termId が states に現れる / 消えるまで短くリトライして待つ。
async function waitForTermId(port, termId, shouldExist = true, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  let lastSeen = null;
  while (Date.now() < deadline) {
    try {
      const states = await getStates(port);
      const ids = termIdsOf(states);
      lastSeen = ids;
      const exists = ids.includes(String(termId));
      if (exists === shouldExist) return findTermState(states, termId);
    } catch (_e) {
      // HTTP サーバー起動前は fetch が失敗する。同じループで吸収する。
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(
    `termId ${termId} did not reach exists=${shouldExist} in time. last states: ${JSON.stringify(lastSeen)}`
  );
}

// agentGeneration が期待値になるまで GET /api/states をポーリングする。
// renderer の terminal:report-states 自体は 2000ms 間隔のポーリングだが、agentGeneration は
// main プロセスが応答のたびに agentGenerations ストアから additive に足す値のため、
// 直前の restart-agent 応答が返った直後の 1 回で反映されているはず。念のため短くリトライする。
async function waitForAgentGeneration(port, termId, expected, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  let lastSeen;
  while (Date.now() < deadline) {
    const t = findTermState(await getStates(port), termId);
    lastSeen = t ? t.agentGeneration : undefined;
    if (t && t.agentGeneration === expected) return t;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(
    `agentGeneration for ${termId} did not become ${expected}; last seen: ${JSON.stringify(lastSeen)}`
  );
}

async function postJson(port, pathname, payload) {
  const res = await fetch(`http://127.0.0.1:${port}${pathname}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  let body = null;
  try { body = await res.json(); } catch (_e) { /* 非 JSON 応答も診断のため許容 */ }
  return { status: res.status, body };
}

// 一時 PATH の先頭へ置く偽 claude / 偽 codex（new-pane-engine.smoke.spec.js と同じ手法）。
// 実バイナリや認証状態に依存せず、PTY のシェルが受け取った引数だけを JSON Lines で記録する。
function createFakeExecutable(root, binName, captureEnvVar) {
  const binDir = path.join(root, 'bin');
  const capturePath = path.join(root, `${binName}-calls.jsonl`);
  const executablePath = path.join(binDir, binName);
  fs.mkdirSync(binDir, { recursive: true });
  fs.writeFileSync(executablePath, `#!/usr/bin/env node
const fs = require('fs');
fs.appendFileSync(process.env.${captureEnvVar}, JSON.stringify(process.argv.slice(2)) + '\\n');
`, { mode: 0o755 });
  return { binDir, capturePath };
}

function readCalls(capturePath) {
  if (!fs.existsSync(capturePath)) return [];
  return fs.readFileSync(capturePath, 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

async function waitForCallCount(capturePath, expected, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const calls = readCalls(capturePath);
    if (calls.length >= expected) return calls;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(
    `fake executable was not called ${expected} time(s) (last seen: ${readCalls(capturePath).length})`
  );
}

// close-pane.smoke.spec.js（issue #348）と同じ理由で、Electron の起動を全テストで
// 1 回だけ共有する（起動は起動シーケンス予算だけでも数秒かかるため）。各テストは
// 世代番号を前のテストから引き継いで進める設計にしているため、実行順に依存する。
test.describe.serial('POST /api/restart-agent によるペイン内 AI の再起動（issue #392）', () => {
  let launched;
  let fixtureRoot;
  let fakeClaude;
  let fakeCodex;
  let port;
  let agentPaneTermId;

  test.beforeAll(async () => {
    port = await getFreePort();
    fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'vk-terminals-e2e-restart-agent-fixture-'));
    fakeClaude = createFakeExecutable(fixtureRoot, 'claude', 'VK_TERMINALS_E2E_CLAUDE_CAPTURE');
    fakeCodex = createFakeExecutable(fixtureRoot, 'codex', 'VK_TERMINALS_E2E_CODEX_CAPTURE');

    launched = await launchAppAndWait({
      port,
      prefix: 'vk-terminals-e2e-restart-agent-',
      env: {
        // 偽 claude と偽 codex を同じ PATH に共存させる（どちらのディレクトリも先頭側）。
        PATH: `${fakeClaude.binDir}${path.delimiter}${fakeCodex.binDir}${path.delimiter}${process.env.PATH || ''}`,
        VK_TERMINALS_E2E_CLAUDE_CAPTURE: fakeClaude.capturePath,
        VK_TERMINALS_E2E_CODEX_CAPTURE: fakeCodex.capturePath,
      },
    });
    // 起動直後の最初のペイン（termId "1"。launchApp は常に --no-claude を渡すため素のシェル）
    // が report-states に現れるまで待つ。
    await waitForTermId(port, '1', true);
  });

  test.afterAll(async () => {
    if (launched) await closeApp(launched);
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  });

  test('起動直後の素のシェルのペインは agentGeneration が 0 で始まり、/api/states の既存キーが揃っている', async () => {
    const t = await waitForTermId(port, '1', true);
    // 観点4: 素のシェルのペインは 0 で始まる。
    expect(t.agentGeneration).toBe(0);
    // 観点5: 既存キーのデグレが無いこと（今回の PR は additive のはず）。
    expect(t.termId).not.toBeUndefined();
    expect(typeof t.cwd).toBe('string');
    expect(typeof t.status).toBe('string');
    expect(typeof t.lastOutputTime).toBe('number');
    expect(t).toHaveProperty('backgroundAgents');
  });

  test('POST /api/new-pane で AI を起動したペインは agentGeneration が 1 で始まる', async () => {
    const beforeCount = await getPaneCount(port);
    const created = await postJson(port, '/api/new-pane', { engine: 'claude', noClaude: false });
    expect(created.status).toBe(200);
    expect(created.body && created.body.ok).toBe(true);
    agentPaneTermId = String(created.body.termId);
    expect(agentPaneTermId).toBeTruthy();

    await waitForPaneCount(port, beforeCount + 1);
    // 起動コマンドが PTY へ書き込まれ、偽 claude が呼ばれたことを確認する（実 AI 起動の代替確認）。
    await waitForCallCount(fakeClaude.capturePath, 1);

    // 観点4: AI 起動ペインは 1 で始まる。
    const t = await waitForAgentGeneration(port, agentPaneTermId, 1);
    expect(t.agentGeneration).toBe(1);
  });

  test('成功時: ペイン数・並び・termId を変えずに AI だけを再起動し、応答と /api/states の世代番号が一致する', async () => {
    const statesBefore = await getStates(port);
    const orderBefore = Object.keys(statesBefore);
    const termIdsBefore = termIdsOf(statesBefore);

    const res = await postJson(port, '/api/restart-agent', {
      termId: agentPaneTermId,
      expectedGeneration: 1,
      engine: 'claude',
    });

    // 観点3: 成功応答から停止の完了と再起動後の世代番号が確認できる。
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      ok: true,
      termId: agentPaneTermId,
      stopped: true,
      generation: 2,
    });

    // 観点1: ペインは閉じず、数・並び（キー順）・termId のいずれも変わらない。
    const statesAfter = await getStates(port);
    expect(Object.keys(statesAfter)).toEqual(orderBefore);
    expect(termIdsOf(statesAfter)).toEqual(termIdsBefore);

    // 起動コマンドが再度 PTY へ書き込まれ、偽 claude が再度呼ばれたこと。
    await waitForCallCount(fakeClaude.capturePath, 2);

    // 観点4: GET /api/states からも増えた世代番号が読める。
    const t = await waitForAgentGeneration(port, agentPaneTermId, 2);
    expect(t.agentGeneration).toBe(2);
  });

  test('世代の食い違い: 古い expectedGeneration は 409 で拒否し、AI を停止・起動し直さない', async () => {
    const beforeCalls = readCalls(fakeClaude.capturePath).length;
    const statesBefore = await getStates(port);
    const orderBefore = Object.keys(statesBefore);

    // 現在の世代は 2（直前のテストで進んでいる）。呼び出し元が古い値 1 を指定するケース。
    const res = await postJson(port, '/api/restart-agent', {
      termId: agentPaneTermId,
      expectedGeneration: 1,
      engine: 'claude',
    });

    // 観点2: 409 で拒否し、currentGeneration が本文に含まれる。
    expect(res.status).toBe(409);
    expect(res.body && res.body.error).toBeTruthy();
    expect(res.body.currentGeneration).toBe(2);

    // 肝心な点: 何も停止・起動していないこと（偽 claude の呼び出し回数が増えていない）。
    // 非同期に呼び出しが漏れて増えていないか、少し待ってから確認する。
    await new Promise((resolve) => setTimeout(resolve, 1000));
    expect(readCalls(fakeClaude.capturePath).length).toBe(beforeCalls);

    // ペイン構成も世代番号もそのまま。
    const statesAfter = await getStates(port);
    expect(Object.keys(statesAfter)).toEqual(orderBefore);
    const t = findTermState(statesAfter, agentPaneTermId);
    expect(t.agentGeneration).toBe(2);
  });

  test('素のシェルのペイン（termId "1"）でも restart-agent は成功し、世代番号が 0 → 1 に増える', async () => {
    const statesBefore = await getStates(port);
    const orderBefore = Object.keys(statesBefore);

    const res = await postJson(port, '/api/restart-agent', {
      termId: '1',
      expectedGeneration: 0,
      engine: 'codex',
    });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      ok: true,
      termId: '1',
      stopped: true,
      generation: 1,
    });

    // ここでもペイン構成（数・並び）は変わらない。
    const statesAfter = await getStates(port);
    expect(Object.keys(statesAfter)).toEqual(orderBefore);

    await waitForCallCount(fakeCodex.capturePath, 1);
    const t = await waitForAgentGeneration(port, '1', 1);
    expect(t.agentGeneration).toBe(1);
  });

  test('異常系（任意項目）: 存在しないディレクトリを cwd に指定すると 400、存在しない termId は 404', async () => {
    // 不正な cwd。expectedGeneration はペイン "1" の現在値（1）を正しく指定するが、
    // cwd の実在確認（fs.promises.stat）で弾かれる想定。
    const invalidCwd = await postJson(port, '/api/restart-agent', {
      termId: '1',
      expectedGeneration: 1,
      cwd: '/no/such/directory/vk-terminals-e2e-restart-agent',
    });
    expect(invalidCwd.status).toBe(400);
    expect(invalidCwd.body && invalidCwd.body.error).toBeTruthy();
    // 弾かれた場合は世代を進めない（何も停止・起動していない）。
    const afterInvalidCwd = await waitForAgentGeneration(port, '1', 1);
    expect(afterInvalidCwd.agentGeneration).toBe(1);

    // 存在しない termId。
    const notFound = await postJson(port, '/api/restart-agent', {
      termId: '999999',
      expectedGeneration: 0,
    });
    expect(notFound.status).toBe(404);
    expect(notFound.body && notFound.body.error).toBeTruthy();
  });
});
