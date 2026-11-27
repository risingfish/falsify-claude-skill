// Background process: launches the browser as its own child, holds the Playwright connection, serves commands on a
// Unix socket, and tears everything down as soon as the browser goes away. Started detached by `cdp.mjs launch`.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright-core';
import { SOCKET, PID_FILE, STATE_FILE, profileDir, outputDir } from '../lib/paths.mjs';
import { isAlive, killGroup, sweepProfile, profileProcesses, removeRuntimeFiles, waitFor } from '../lib/lifecycle.mjs';
import { serve } from '../lib/protocol.mjs';
import { loadCommands } from '../lib/commands.mjs';
import { CmdError, toErrorPayload } from '../lib/errors.mjs';

const NO_PAGES_GRACE_MS = 3000;
const CONSOLE_LIMIT = 1000;
const STARTUP_TIMEOUT_MS = 30000;
const DEFAULT_TIMEOUT_MS = 15000;

const log = (...a) => console.log(new Date().toISOString(), ...a);

const browserCfg = JSON.parse(process.env.CDBG_BROWSER || 'null');
if (!browserCfg) {
  log('CDBG_BROWSER not set');
  process.exit(2);
}
const profile = profileDir(browserCfg);

let child = null;
let browser = null;
let server = null;
let watchTimer = null;
let shuttingDown = false;
const stateInfo = { daemonPid: process.pid, browser: { id: browserCfg.id, label: browserCfg.label, exe: browserCfg.exe }, profileDir: profile, startedAt: new Date().toISOString() };

// ---- shutdown -------------------------------------------------------------------------------------------------

const browserAlive = () => (child && isAlive(child.pid)) || profileProcesses(profile).length > 0;

async function shutdown(reason, code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  log(`shutdown: ${reason}`);
  clearInterval(watchTimer);
  server?.close();
  fs.rmSync(SOCKET(), { force: true });
  if (browserAlive()) {
    try {
      if (browser?.isConnected()) {
        const s = await browser.newBrowserCDPSession();
        await Promise.race([s.send('Browser.close'), new Promise((r) => setTimeout(r, 3000))]);
      }
    } catch { /* fall through to kill */ }
    await waitFor(() => !browserAlive(), { timeout: 5000 });
  }
  killGroup(child?.pid);
  sweepProfile(profile);
  removeRuntimeFiles();
  log('stopped');
  process.exit(code);
}

for (const sig of ['SIGTERM', 'SIGINT', 'SIGHUP']) process.on(sig, () => shutdown(sig));
process.on('uncaughtException', (err) => { log('uncaught', err.stack || err); shutdown('crash', 1); });
process.on('unhandledRejection', (err) => { log('unhandled rejection', err?.stack || err); });

// ---- tabs -----------------------------------------------------------------------------------------------------

const tabs = new Map(); // page -> { id, page, cdp, emulation }
let current = null;
const state = { console: [], store: {} };

function pushConsole(entry) {
  state.console.push({ time: new Date().toISOString(), ...entry });
  if (state.console.length > CONSOLE_LIMIT) state.console.splice(0, state.console.length - CONSOLE_LIMIT);
}

// The 'page' event and newTab() can both register the same page; they share one in-flight registration.
const registering = new Map(); // page -> Promise<rec | null>

function registerPage(page) {
  if (tabs.has(page)) return Promise.resolve(tabs.get(page));
  if (page.isClosed()) return Promise.resolve(null);
  if (!registering.has(page)) {
    registering.set(page, doRegister(page).finally(() => registering.delete(page)));
  }
  return registering.get(page);
}

async function doRegister(page) {
  const rec = { id: null, page, cdp: null, emulation: {} };
  try {
    rec.cdp = await page.context().newCDPSession(page);
    const { targetInfo } = await rec.cdp.send('Target.getTargetInfo');
    rec.id = targetInfo.targetId.slice(0, 8).toUpperCase();
  } catch {
    return null;
  }
  if (page.isClosed()) return null;
  tabs.set(page, rec);
  page.on('console', (m) => {
    const loc = m.location();
    pushConsole({ tab: rec.id, type: m.type(), text: m.text(), url: loc.url || undefined, line: loc.lineNumber });
  });
  page.on('pageerror', (e) => pushConsole({ tab: rec.id, type: 'pageerror', text: e.message, stack: e.stack }));
  page.on('close', () => {
    tabs.delete(page);
    if (current === rec) current = [...tabs.values()].at(-1) || null;
  });
  if (!current) current = rec;
  return rec;
}

const allPages = () => (browser ? browser.contexts().flatMap((c) => c.pages()) : []);

function findTab(id) {
  const want = String(id).toUpperCase();
  const hits = [...tabs.values()].filter((t) => t.id && t.id.startsWith(want));
  if (hits.length === 0) throw new CmdError('NO_PAGE', `no tab with id ${id}`);
  if (hits.length > 1) throw new CmdError('BAD_ARGS', `tab id prefix ${id} is ambiguous`);
  return hits[0];
}

async function describeTabs() {
  return Promise.all([...tabs.values()].filter((t) => t.id).map(async (t) => ({
    id: t.id,
    url: t.page.url(),
    title: await t.page.title().catch(() => ''),
    current: t === current,
    emulation: t.emulation,
  })));
}

// What command modules see as `session`.
const session = {
  get browser() { return browser; },
  tabs: describeTabs,
  current: () => current,
  select(id) { current = findTab(id); return current; },
  async newTab(url) {
    const page = await browser.contexts()[0].newPage();
    const rec = await registerPage(page);
    current = rec;
    if (url) await page.goto(url);
    return rec;
  },
  // Emulation lives on our CDP session; detaching it drops every override at once.
  async resetEmulation(rec) {
    await rec.cdp.detach().catch(() => {});
    rec.cdp = await rec.page.context().newCDPSession(rec.page);
    rec.emulation = {};
  },
};

// ---- commands -------------------------------------------------------------------------------------------------

const commands = await loadCommands({ onError: (file, why) => log(`skipping commands/${file}: ${why}`) });

function makeOut(cwd, out) {
  const dir = outputDir(cwd || process.cwd(), out);
  return {
    dir,
    path(name, ext) {
      fs.mkdirSync(dir, { recursive: true });
      const base = name || `${ext === 'png' ? 'shot' : 'out'}-${new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15)}-${Date.now() % 1000}`;
      if (/[/\\]/.test(base)) throw new CmdError('BAD_ARGS', `--name must not contain path separators: ${base}`);
      return path.join(dir, base.endsWith(`.${ext}`) ? base : `${base}.${ext}`);
    },
  };
}

async function runCommand({ cmd, args = {}, cwd }) {
  const mod = commands.get(cmd);
  if (!mod) throw new CmdError('UNKNOWN_COMMAND', `unknown command "${cmd}"`);
  const rec = args.tab ? findTab(args.tab) : current;
  if (!rec && !mod.noPage) throw new CmdError('NO_PAGE', 'no open tab; open one in the browser or run `newtab`');
  const timeout = args.timeout ?? DEFAULT_TIMEOUT_MS;
  rec?.page.setDefaultTimeout(timeout);
  rec?.page.setDefaultNavigationTimeout(timeout);
  let timer;
  const result = await Promise.race([
    mod.run({ page: rec?.page, cdp: rec?.cdp, tab: rec, state, args, cwd, out: makeOut(cwd, args.out), session }),
    new Promise((_, reject) => { timer = setTimeout(() => reject(new CmdError('TIMEOUT', `${cmd} took longer than ${timeout} ms`)), timeout + 1000); }),
  ]).finally(() => clearTimeout(timer));
  return { tab: (args.tab ? rec : current)?.id ?? null, result: result ?? null };
}

async function handle(req) {
  try {
    if (req.cmd === '__ping') return { ok: true, result: 'pong' };
    if (req.cmd === '__stop') {
      setTimeout(() => shutdown('stop command'), 50);
      return { ok: true, command: 'stop', result: { stopping: true } };
    }
    if (req.cmd === '__status') {
      return { ok: true, command: 'status', result: { running: true, ...stateInfo, currentTab: current?.id ?? null, tabs: await describeTabs(), consoleEntries: state.console.length } };
    }
    const { tab, result } = await runCommand(req);
    return { ok: true, command: req.cmd, tab, result };
  } catch (err) {
    return { ok: false, command: req.cmd, error: toErrorPayload(err) };
  }
}

// ---- startup --------------------------------------------------------------------------------------------------

function writeState() {
  fs.writeFileSync(STATE_FILE(), JSON.stringify(stateInfo, null, 2));
}

async function start() {
  fs.writeFileSync(PID_FILE(), JSON.stringify({ pid: process.pid }));
  fs.mkdirSync(profile, { recursive: true });
  sweepProfile(profile); // a browser still holding our profile would swallow the launch
  // A SIGKILLed browser leaves its singleton lock behind and the next launch aborts. Nothing else may use this
  // profile and its processes were just swept, so the lock is stale by definition.
  for (const f of ['SingletonLock', 'SingletonSocket', 'SingletonCookie']) fs.rmSync(path.join(profile, f), { force: true });
  const portFile = path.join(profile, 'DevToolsActivePort');
  fs.rmSync(portFile, { force: true });

  const argv = ['--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', ...browserCfg.args];
  log('launching', browserCfg.exe, argv.join(' '));
  child = spawn(browserCfg.exe, argv, { detached: true, stdio: ['ignore', 'ignore', 'inherit'] });
  Object.assign(stateInfo, { browserPid: child.pid, pgid: child.pid });
  writeState();
  child.on('error', (err) => { log('spawn failed', err.message); shutdown('spawn failed', 1); });
  child.on('exit', (code, signal) => {
    log(`browser process exited code=${code} signal=${signal}`);
    // Wrappers may exit while the real browser lives on; only stop once the browser is really gone.
    setTimeout(() => {
      if (!browser?.isConnected() || profileProcesses(profile).length === 0) shutdown('browser exited');
    }, 1000);
  });

  const gotPort = await waitFor(() => fs.existsSync(portFile) && fs.readFileSync(portFile, 'utf8').includes('\n'), { timeout: STARTUP_TIMEOUT_MS });
  if (!gotPort) return shutdown(`browser never wrote ${portFile}`, 1);
  const port = Number(fs.readFileSync(portFile, 'utf8').split('\n')[0]);
  stateInfo.port = port;
  writeState();

  browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`, { timeout: STARTUP_TIMEOUT_MS });
  browser.on('disconnected', () => shutdown('browser disconnected'));
  for (const ctx of browser.contexts()) ctx.on('page', (p) => registerPage(p));
  for (const p of allPages()) await registerPage(p);

  // Covers browsers that keep running in the background after their last window closes.
  let noPagesSince = null;
  watchTimer = setInterval(() => {
    const pages = allPages();
    for (const p of pages) if (!tabs.has(p)) registerPage(p);
    if (pages.length > 0) noPagesSince = null;
    else if ((noPagesSince ??= Date.now()) && Date.now() - noPagesSince >= NO_PAGES_GRACE_MS) shutdown('no open pages');
  }, 500);

  fs.rmSync(SOCKET(), { force: true });
  server = serve(SOCKET(), handle);
  await new Promise((r) => server.once('listening', r));
  fs.chmodSync(SOCKET(), 0o600);
  log(`ready on port ${port}, ${tabs.size} tab(s)`);
}

start().catch((err) => {
  log('startup failed', err.stack || err);
  shutdown('startup failed', 1);
});
