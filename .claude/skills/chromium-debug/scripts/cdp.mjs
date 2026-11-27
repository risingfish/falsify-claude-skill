#!/usr/bin/env node
// Single entry point. Lifecycle commands run here; everything else is parsed here and forwarded to the daemon.
// Prints one JSON object per call (except `help`, which prints text). Exit code 0 on success, 1 on error.
import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { parseArgs } from 'node:util';
import { SKILL_DIR, SOCKET, LOG_FILE, runtimeDir } from '../lib/paths.mjs';
import { CmdError, toErrorPayload } from '../lib/errors.mjs';
import { detect, validateExe } from '../lib/browsers.mjs';
import { readConfig, writeConfig } from '../lib/config.mjs';
import { liveDaemonPid, cleanupStale, isAlive, waitFor, readJson } from '../lib/lifecycle.mjs';
import { request } from '../lib/protocol.mjs';
import { GLOBAL_ARGS } from '../lib/args.mjs';

const LAUNCH_TIMEOUT_MS = 40000;

function print(obj) {
  process.stdout.write(JSON.stringify(obj) + '\n');
  process.exitCode = obj.ok ? 0 : 1;
}

function flags(argv, options, { positionals = 0 } = {}) {
  try {
    const r = parseArgs({ args: argv, options, allowPositionals: positionals > 0, strict: true });
    if (r.positionals.length > positionals) throw new Error(`unexpected argument "${r.positionals[positionals]}"`);
    return r;
  } catch (err) {
    throw new CmdError('BAD_ARGS', err.message);
  }
}

// ---- dependencies ---------------------------------------------------------------------------------------------

function depsStatus() {
  const want = JSON.parse(fs.readFileSync(path.join(SKILL_DIR, 'package.json'), 'utf8')).dependencies['playwright-core'];
  const have = readJson(path.join(SKILL_DIR, 'node_modules', 'playwright-core', 'package.json'))?.version ?? null;
  return { installed: have === want, want, have };
}

function requireDeps() {
  const d = depsStatus();
  if (!d.installed) throw new CmdError('DEPS_MISSING', `playwright-core ${d.want} not installed (found ${d.have ?? 'none'}); run: cdp.mjs setup --install`);
}

// ---- lifecycle commands ---------------------------------------------------------------------------------------

function setup(argv) {
  const { values } = flags(argv, { install: { type: 'boolean' }, validate: { type: 'string' }, write: { type: 'string' } });
  if (values.install) {
    execFileSync('npm', ['ci', '--no-audit', '--no-fund'], { cwd: SKILL_DIR, stdio: ['ignore', 'ignore', 'pipe'] });
    return { deps: depsStatus() };
  }
  if (values.validate) return validateExe(values.validate);
  if (values.write) {
    let cfg;
    try {
      cfg = JSON.parse(values.write);
    } catch (err) {
      throw new CmdError('CONFIG_INVALID', `--write is not valid JSON: ${err.message}`);
    }
    return { written: writeConfig(cfg), config: cfg };
  }
  let config = null, configError = null;
  try {
    config = readConfig();
  } catch (err) {
    configError = toErrorPayload(err);
  }
  return { deps: depsStatus(), config, configError };
}

async function daemonStatus() {
  return (await request(SOCKET(), { cmd: '__status' }, 10000)).result;
}

async function status() {
  if (!liveDaemonPid()) return { running: false, cleanedStale: cleanupStale().stale };
  return daemonStatus();
}

function logTail(lines = 15) {
  try {
    return fs.readFileSync(LOG_FILE(), 'utf8').trim().split('\n').slice(-lines).join('\n');
  } catch {
    return '';
  }
}

async function launch(argv) {
  const { positionals } = flags(argv, {}, { positionals: 1 });
  const wanted = positionals[0];
  requireDeps();
  const cfg = readConfig();

  if (liveDaemonPid()) {
    const st = await daemonStatus();
    if (wanted && wanted !== st.browser.id) {
      throw new CmdError('SESSION_ACTIVE', `${st.browser.label} is already running; run stop first`, { running: st.browser.id });
    }
    return { alreadyRunning: true, ...st };
  }
  cleanupStale();

  let browser;
  if (wanted) {
    browser = cfg.browsers.find((b) => b.id === wanted);
    if (!browser) throw new CmdError('BAD_ARGS', `no browser "${wanted}" in config`, { choices: cfg.browsers.map((b) => b.id) });
  } else if (cfg.browsers.length === 1) {
    browser = cfg.browsers[0];
  } else {
    throw new CmdError('BROWSER_CHOICE_REQUIRED', 'several browsers configured; ask the user which one, then run launch <id>',
      { choices: cfg.browsers.map((b) => ({ id: b.id, label: b.label })) });
  }

  runtimeDir();
  const logFd = fs.openSync(LOG_FILE(), 'w', 0o600);
  const d = spawn(process.execPath, [path.join(SKILL_DIR, 'scripts', 'daemon.mjs')], {
    detached: true,
    stdio: ['ignore', logFd, logFd],
    cwd: SKILL_DIR,
    env: { ...process.env, CDBG_BROWSER: JSON.stringify(browser) },
  });
  d.unref();
  fs.closeSync(logFd);

  let ready = false;
  await waitFor(async () => {
    if (!isAlive(d.pid)) return true;
    try {
      ready = (await request(SOCKET(), { cmd: '__ping' }, 2000)).ok;
    } catch { /* not listening yet */ }
    return ready;
  }, { timeout: LAUNCH_TIMEOUT_MS, interval: 250 });

  if (!ready) {
    if (isAlive(d.pid)) process.kill(d.pid, 'SIGTERM');
    await waitFor(() => !isAlive(d.pid), { timeout: 10000 });
    cleanupStale();
    throw new CmdError('LAUNCH_FAILED', `${browser.label} did not start a debug session`, { log: logTail() });
  }
  return daemonStatus();
}

async function stop() {
  const pid = liveDaemonPid();
  if (!pid) return { stopped: false, reason: 'no session', cleanedStale: cleanupStale().stale };
  try {
    await request(SOCKET(), { cmd: '__stop' }, 5000);
  } catch {
    process.kill(pid, 'SIGTERM');
  }
  if (!(await waitFor(() => !isAlive(pid), { timeout: 15000 }))) process.kill(pid, 'SIGKILL');
  await waitFor(() => !isAlive(pid), { timeout: 3000 });
  cleanupStale();
  return { stopped: true };
}

// ---- help -----------------------------------------------------------------------------------------------------

const LIFECYCLE_HELP = `Lifecycle:
  setup                      show deps + config status
  setup --install            install pinned dependencies (npm ci)
  setup --validate <exe>     check a browser executable exists and runs
  setup --write '<json>'     validate and save .config
  detect                     list known Chromium browsers installed here
  launch [id]                start a debug session (id required when several browsers are configured)
  status                     session, tabs and emulation state
  stop                       close the browser and the daemon`;

async function help(argv) {
  const { loadCommands } = await import('../lib/commands.mjs');
  const { usage } = await import('../lib/args.mjs');
  const errors = [];
  const commands = await loadCommands({ onError: (f, why) => errors.push(`  commands/${f}: ${why}`) });
  const name = argv[0];
  if (name) {
    const mod = commands.get(name);
    if (!mod) throw new CmdError('UNKNOWN_COMMAND', `unknown command "${name}"`);
    process.stdout.write(usage(mod) + '\n');
    return;
  }
  const globals = Object.entries(GLOBAL_ARGS).map(([n, a]) => `  --${n} <${a.type}>  ${a.description}`).join('\n');
  const list = [...commands.values()].map((m) => `  ${m.name.padEnd(12)} ${m.description}`).join('\n');
  process.stdout.write(`Usage: cdp.mjs <command> [args] [--flags]\n\n${LIFECYCLE_HELP}\n\nBrowser commands (cdp.mjs help <command> for details):\n${list}\n\nFlags for every browser command:\n${globals}\n`
    + (errors.length ? `\nSkipped broken command modules:\n${errors.join('\n')}\n` : ''));
}

// ---- forwarding -----------------------------------------------------------------------------------------------

async function forward(cmd, argv) {
  requireDeps();
  const { loadCommands } = await import('../lib/commands.mjs');
  const { parseCommandArgs, usage } = await import('../lib/args.mjs');
  const commands = await loadCommands();
  const mod = commands.get(cmd);
  if (!mod) throw new CmdError('UNKNOWN_COMMAND', `unknown command "${cmd}"; run cdp.mjs help`);
  if (argv.includes('--help')) {
    process.stdout.write(usage(mod) + '\n');
    return null;
  }
  const args = parseCommandArgs(mod.args, argv);
  if (!liveDaemonPid()) {
    cleanupStale();
    throw new CmdError('NO_SESSION', 'no browser session; run cdp.mjs launch');
  }
  return request(SOCKET(), { cmd, args, cwd: process.cwd() }, (args.timeout ?? 15000) + 10000);
}

// ---- main -----------------------------------------------------------------------------------------------------

const LIFECYCLE = { setup, detect: () => ({ browsers: detect() }), launch, status, stop };

async function main([cmd, ...argv]) {
  try {
    if (!cmd || cmd === 'help' || cmd === '--help') return await help(argv);
    if (LIFECYCLE[cmd]) return print({ ok: true, command: cmd, result: await LIFECYCLE[cmd](argv) });
    const reply = await forward(cmd, argv);
    if (reply) print(reply);
  } catch (err) {
    print({ ok: false, command: cmd, error: toErrorPayload(err) });
  }
}

await main(process.argv.slice(2));
