// Test harness: every test session gets its own config, runtime dir and browser profile, so tests never touch a
// real session. Browsers run headless unless CDBG_TEST_HEADFUL=1.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { detect } from '../lib/browsers.mjs';
import { usesProfile } from '../lib/lifecycle.mjs';

export const SKILL_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = path.join(SKILL_DIR, 'scripts', 'cdp.mjs');

// CDBG_TEST_BROWSERS=chromium,brave limits which installed browsers are exercised.
export function testBrowsers() {
  const want = process.env.CDBG_TEST_BROWSERS?.split(',');
  const extra = process.env.CDBG_TEST_HEADFUL ? [] : ['--headless=new'];
  return detect()
    .filter((b) => !want || want.includes(b.id))
    .map((b) => ({ ...b, args: extra }));
}

export function makeEnv(browsers, label = 'test') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `cdbg-${label}-`));
  const env = {
    ...process.env,
    CDBG_CONFIG: path.join(root, 'config.json'),
    CDBG_RUNTIME_DIR: path.join(root, 'run'),
    CDBG_PROFILE_NAME: `chromium-debug-test-${label}`,
  };
  if (browsers) fs.writeFileSync(env.CDBG_CONFIG, JSON.stringify({ version: 1, browsers }));
  return { root, env, cwd: root };
}

// Runs the CLI and returns its parsed JSON (or raw text for help).
export function cli(ctx, ...args) {
  return new Promise((resolve) => {
    execFile(process.execPath, [CLI, ...args], { env: ctx.env, cwd: ctx.cwd, timeout: 90000 }, (err, stdout) => {
      const text = stdout.trim();
      try {
        resolve({ ...JSON.parse(text), exitCode: err?.code ?? 0 });
      } catch {
        resolve({ text, exitCode: err?.code ?? 0 });
      }
    });
  });
}

export function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

export const stateOf = (ctx) => readJson(path.join(ctx.env.CDBG_RUNTIME_DIR, 'state.json'));

// Every live process started with our --user-data-dir (same matching as the daemon's sweep).
export function profilePids(profileDir) {
  return fs.readdirSync('/proc').filter((e) => /^\d+$/.test(e) && Number(e) !== process.pid).filter((pid) => {
    try {
      const args = fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8').split('\0').filter(Boolean);
      return usesProfile(args, profileDir) && alive(Number(pid));
    } catch {
      return false;
    }
  }).map(Number);
}

// The browser's main process: not a helper (--type=...) and not a shell wrapper script.
export function mainBrowserPid(profileDir) {
  return profilePids(profileDir).find((pid) => {
    const line = fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8').split('\0').join(' ');
    return !line.includes('--type=') && !/^(\/usr)?\/bin\/(ba)?sh /.test(line) && !/^(ba)?sh /.test(line);
  });
}

export function alive(pid) {
  try {
    process.kill(pid, 0);
    const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
    return stat.slice(stat.lastIndexOf(')') + 2)[0] !== 'Z';
  } catch {
    return false;
  }
}

export async function waitFor(pred, timeout = 20000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await pred()) return true;
    await new Promise((r) => setTimeout(r, 200));
  }
  return Boolean(await pred());
}

// Sends one browser-level CDP command over a raw WebSocket, outside the daemon.
export async function rawCdp(port, method, params = {}) {
  const { webSocketDebuggerUrl } = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
  const ws = new WebSocket(webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  const reply = new Promise((res) => { ws.onmessage = (m) => res(JSON.parse(m.data)); ws.onclose = () => res(null); });
  ws.send(JSON.stringify({ id: 1, method, params }));
  const r = await Promise.race([reply, new Promise((res) => setTimeout(() => res(null), 3000))]);
  try { ws.close(); } catch { /* already closed */ }
  return r;
}

export function serveFixtures() {
  const dir = path.join(SKILL_DIR, 'tests', 'fixtures');
  const server = http.createServer((req, res) => {
    const file = path.join(dir, path.normalize(decodeURIComponent(req.url.split('?')[0])).replace(/^(\.\.[/\\])+/, ''));
    if (!file.startsWith(dir) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404).end('not found');
      return;
    }
    res.writeHead(200, { 'content-type': file.endsWith('.html') ? 'text/html' : 'application/octet-stream' }).end(fs.readFileSync(file));
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, url: `http://127.0.0.1:${server.address().port}` })));
}
