// Browser detection and executable validation.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { CmdError } from './errors.mjs';

export const KNOWN_BROWSERS = [
  { id: 'chromium', label: 'Chromium', bins: ['chromium', 'chromium-browser'] },
  { id: 'chrome', label: 'Google Chrome', bins: ['google-chrome', 'google-chrome-stable'] },
  { id: 'brave', label: 'Brave', bins: ['brave-browser', 'brave'] },
  { id: 'edge', label: 'Microsoft Edge', bins: ['microsoft-edge', 'microsoft-edge-stable'] },
  { id: 'opera', label: 'Opera', bins: ['opera'] },
];

function isExecutableFile(p) {
  try {
    const st = fs.statSync(p);
    if (!st.isFile()) return false;
    fs.accessSync(p, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

// Resolve a bare name on PATH, or an absolute/relative path as given.
export function resolveExe(exe) {
  if (exe.includes('/')) {
    const p = path.resolve(exe);
    return isExecutableFile(p) ? p : null;
  }
  for (const dir of (process.env.PATH || '').split(':')) {
    if (!dir) continue;
    const p = path.join(dir, exe);
    if (isExecutableFile(p)) return p;
  }
  return null;
}

// Snap binaries live in /snap/bin; distro wrappers such as /usr/bin/chromium-browser can also just call into a snap.
export function snapName(exePath) {
  if (exePath.startsWith('/snap/bin/')) return path.basename(exePath).split('.')[0];
  try {
    const head = fs.readFileSync(exePath, { encoding: 'latin1' }).slice(0, 4096);
    const m = head.startsWith('#!') && head.match(/\/snap\/bin\/([\w-]+)/);
    if (m) return m[1];
  } catch { /* unreadable: treat as non-snap */ }
  return null;
}

export function detect() {
  const found = [];
  for (const b of KNOWN_BROWSERS) {
    for (const bin of b.bins) {
      const exe = resolveExe(bin);
      if (exe) {
        found.push({ id: b.id, label: b.label, exe, snap: snapName(exe) });
        break;
      }
    }
  }
  return found;
}

export function validateExe(exe) {
  const resolved = resolveExe(exe);
  if (!resolved) throw new CmdError('EXE_NOT_FOUND', `"${exe}" is not an executable file or a command on PATH`);
  let version;
  try {
    version = execFileSync(resolved, ['--version'], { timeout: 15000, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  } catch (err) {
    throw new CmdError('EXE_NOT_FOUND', `"${resolved}" did not run with --version: ${String(err.message).split('\n')[0]}`);
  }
  return { exe: resolved, version, snap: snapName(resolved) };
}
