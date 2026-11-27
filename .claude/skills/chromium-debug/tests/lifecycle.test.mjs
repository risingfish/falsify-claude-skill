// Proves the no-leftover-processes requirement: however a session ends, no daemon, browser or helper survives.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { testBrowsers, makeEnv, cli, stateOf, profilePids, mainBrowserPid, alive, waitFor, rawCdp } from './helpers.mjs';

async function startSession(browser, label) {
  const ctx = makeEnv([{ id: browser.id, label: browser.label, exe: browser.exe, snap: browser.snap, args: browser.args }], label);
  const r = await cli(ctx, 'launch');
  assert.equal(r.ok, true, JSON.stringify(r.error));
  const st = stateOf(ctx);
  assert.ok(st?.port && st.daemonPid && st.profileDir, 'state.json is complete');
  assert.ok(profilePids(st.profileDir).length > 0, 'browser processes are running');
  return { ctx, st };
}

async function assertAllGone({ ctx, st }, what) {
  const sock = path.join(ctx.env.CDBG_RUNTIME_DIR, 'daemon.sock');
  const gone = await waitFor(() => !alive(st.daemonPid) && profilePids(st.profileDir).length === 0 && !fs.existsSync(sock));
  assert.ok(gone, `${what}: leftovers: daemon alive=${alive(st.daemonPid)} profile pids=${profilePids(st.profileDir)} socket=${fs.existsSync(sock)}`);
  assert.equal(stateOf(ctx), null, `${what}: state.json removed`);
  fs.rmSync(ctx.root, { recursive: true, force: true });
  fs.rmSync(st.profileDir, { recursive: true, force: true });
}

for (const browser of testBrowsers()) {
  describe(`lifecycle: ${browser.label}`, () => {
    test('user closes the browser (Browser.close over CDP)', async () => {
      const s = await startSession(browser, `${browser.id}-close`);
      await rawCdp(s.st.port, 'Browser.close');
      await assertAllGone(s, 'Browser.close');
    });

    test('browser process is killed', async () => {
      const s = await startSession(browser, `${browser.id}-kill`);
      const pid = mainBrowserPid(s.st.profileDir);
      assert.ok(pid, 'found the main browser process');
      process.kill(pid, 'SIGKILL');
      await assertAllGone(s, 'SIGKILL browser');
    });

    test('every tab is closed while the browser keeps running', async () => {
      const s = await startSession(browser, `${browser.id}-tabs`);
      const { result } = (await rawCdp(s.st.port, 'Target.getTargets')) ?? {};
      for (const t of result.targetInfos.filter((t) => t.type === 'page')) {
        await rawCdp(s.st.port, 'Target.closeTarget', { targetId: t.targetId });
      }
      await assertAllGone(s, 'all tabs closed');
    });

    test('stop command', async () => {
      const s = await startSession(browser, `${browser.id}-stop`);
      const r = await cli(s.ctx, 'stop');
      assert.equal(r.result.stopped, true);
      await assertAllGone(s, 'stop');
    });

    test('daemon is SIGKILLed; the next CLI call cleans up', async () => {
      const s = await startSession(browser, `${browser.id}-orphan`);
      process.kill(s.st.daemonPid, 'SIGKILL');
      await waitFor(() => !alive(s.st.daemonPid));
      assert.ok(profilePids(s.st.profileDir).length > 0, 'browser is orphaned until the next call');
      const r = await cli(s.ctx, 'status');
      assert.equal(r.result.running, false);
      assert.equal(r.result.cleanedStale, true);
      await assertAllGone(s, 'daemon SIGKILL + status');
    });

    test('daemon gets SIGTERM', async () => {
      const s = await startSession(browser, `${browser.id}-term`);
      process.kill(s.st.daemonPid, 'SIGTERM');
      await assertAllGone(s, 'SIGTERM daemon');
    });
  });
}
