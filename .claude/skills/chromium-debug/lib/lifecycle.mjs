// Process bookkeeping shared by the CLI and the daemon: liveness checks, group kills, stale-session cleanup.
import fs from 'node:fs';
import { PID_FILE, STATE_FILE, SOCKET } from './paths.mjs';

export function isAlive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
  } catch (err) {
    return err.code === 'EPERM';
  }
  // A zombie still answers signal 0; treat it as dead.
  try {
    const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
    return stat.slice(stat.lastIndexOf(')') + 2)[0] !== 'Z';
  } catch {
    return false;
  }
}

function cmdline(pid) {
  try {
    return fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8').split('\0');
  } catch {
    return null;
  }
}

export function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

export function readDaemonPid() {
  const pid = Number(readJson(PID_FILE())?.pid);
  return Number.isInteger(pid) && pid > 0 ? pid : null;
}

// The pid file is only trusted if that pid is still our daemon (pids get reused).
export function liveDaemonPid() {
  const pid = readDaemonPid();
  if (!pid || !isAlive(pid)) return null;
  const args = cmdline(pid);
  return args && args.some((a) => a.endsWith('daemon.mjs')) ? pid : null;
}

// True if the command line carries --user-data-dir=<profileDir>. Some browsers (Snap Chromium) rewrite their process
// title into one space-joined string, so match on the joined line with a boundary instead of exact argv entries.
export function usesProfile(args, profileDir) {
  const line = args.join(' ');
  const needle = `--user-data-dir=${profileDir}`;
  for (let i = line.indexOf(needle); i !== -1; i = line.indexOf(needle, i + 1)) {
    const next = line[i + needle.length];
    if (next === undefined || next === ' ' || next === '\0') return true;
  }
  return false;
}

// Every process whose command line mentions the profile directory belongs to our browser session.
export function profileProcesses(profileDir) {
  if (!profileDir) return [];
  const pids = [];
  for (const entry of fs.readdirSync('/proc')) {
    const pid = Number(entry);
    if (!Number.isInteger(pid) || pid === process.pid) continue;
    const args = cmdline(pid);
    if (args && usesProfile(args, profileDir) && isAlive(pid)) pids.push(pid);
  }
  return pids;
}

export function killGroup(pgid, signal = 'SIGKILL') {
  if (!pgid) return;
  try {
    process.kill(-pgid, signal);
  } catch { /* group already gone */ }
}

export function sweepProfile(profileDir) {
  for (const pid of profileProcesses(profileDir)) {
    try {
      process.kill(pid, 'SIGKILL');
    } catch { /* already gone */ }
  }
}

export function removeRuntimeFiles() {
  for (const f of [SOCKET(), PID_FILE(), STATE_FILE()]) fs.rmSync(f, { force: true });
}

// If the daemon died without cleaning up (SIGKILL, crash), finish its job: kill the browser and clear files.
export function cleanupStale() {
  if (liveDaemonPid()) return { stale: false };
  const state = readJson(STATE_FILE());
  const hadFiles = [SOCKET(), PID_FILE(), STATE_FILE()].some((f) => fs.existsSync(f));
  if (state) {
    killGroup(state.pgid);
    sweepProfile(state.profileDir);
  }
  removeRuntimeFiles();
  return { stale: hadFiles, killedBrowser: Boolean(state) };
}

export async function waitFor(pred, { timeout = 10000, interval = 100 } = {}) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await pred()) return true;
    await new Promise((r) => setTimeout(r, interval));
  }
  return Boolean(await pred());
}
