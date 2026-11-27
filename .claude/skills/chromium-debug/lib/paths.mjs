// Filesystem locations. Every location can be overridden through env vars so tests never touch real sessions.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const SKILL_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const COMMANDS_DIR = path.join(SKILL_DIR, 'commands');
export const CONFIG_PATH = process.env.CDBG_CONFIG || path.join(SKILL_DIR, '.config');

export function runtimeDir() {
  const dir = process.env.CDBG_RUNTIME_DIR
    || (process.env.XDG_RUNTIME_DIR
      ? path.join(process.env.XDG_RUNTIME_DIR, 'chromium-debug')
      : path.join(os.tmpdir(), `chromium-debug-${process.getuid()}`));
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}

export const runtimeFile = (name) => path.join(runtimeDir(), name);
// Unix socket paths are capped near 108 bytes; fall back to a short, runtime-dir-specific path in /tmp.
export function SOCKET() {
  const p = runtimeFile('daemon.sock');
  if (Buffer.byteLength(p) <= 100) return p;
  const tag = createHash('sha256').update(runtimeDir()).digest('hex').slice(0, 12);
  return path.join(os.tmpdir(), `chromium-debug-${process.getuid()}-${tag}.sock`);
}
export const PID_FILE = () => runtimeFile('daemon.pid');
export const STATE_FILE = () => runtimeFile('state.json');
export const LOG_FILE = () => runtimeFile('daemon.log');

// Snap confinement blocks hidden directories in $HOME, so Snap browsers keep their profile in their own common dir.
export function profileDir(browser) {
  const name = process.env.CDBG_PROFILE_NAME || 'chromium-debug-profile';
  if (browser.snap) return path.join(os.homedir(), 'snap', browser.snap, 'common', name);
  return path.join(os.homedir(), '.local', 'share', 'chromium-debug', `${name}-${browser.id}`);
}

// Screenshots and diffs land next to the work: <caller cwd>/tmp/chromium-debug, unless --out is given.
export function outputDir(cwd, out) {
  return out ? path.resolve(cwd, out) : path.join(cwd, 'tmp', 'chromium-debug');
}
