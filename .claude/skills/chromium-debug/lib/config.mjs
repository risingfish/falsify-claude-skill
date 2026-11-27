// Reads, validates and writes the per-user .config file in the skill folder.
import fs from 'node:fs';
import { CONFIG_PATH } from './paths.mjs';
import { CmdError } from './errors.mjs';

const ID_RE = /^[a-z0-9][a-z0-9-]{0,31}$/;

export function validateConfig(cfg) {
  const fail = (msg) => { throw new CmdError('CONFIG_INVALID', msg); };
  if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) fail('config must be a JSON object');
  if (cfg.version !== 1) fail('config.version must be 1');
  if (!Array.isArray(cfg.browsers) || cfg.browsers.length === 0) fail('config.browsers must be a non-empty array');
  const ids = new Set();
  for (const [i, b] of cfg.browsers.entries()) {
    const at = `browsers[${i}]`;
    if (!b || typeof b !== 'object') fail(`${at} must be an object`);
    if (typeof b.id !== 'string' || !ID_RE.test(b.id)) fail(`${at}.id must match ${ID_RE}`);
    if (ids.has(b.id)) fail(`duplicate browser id "${b.id}"`);
    ids.add(b.id);
    if (typeof b.label !== 'string' || !b.label) fail(`${at}.label must be a non-empty string`);
    if (typeof b.exe !== 'string' || !b.exe.startsWith('/')) fail(`${at}.exe must be an absolute path`);
    if (b.snap != null && (typeof b.snap !== 'string' || !/^[\w-]+$/.test(b.snap))) fail(`${at}.snap must be a snap name or null`);
    if (!Array.isArray(b.args) || b.args.some((a) => typeof a !== 'string')) fail(`${at}.args must be an array of strings`);
  }
  return cfg;
}

export function readConfig() {
  let raw;
  try {
    raw = fs.readFileSync(CONFIG_PATH, 'utf8');
  } catch {
    throw new CmdError('CONFIG_MISSING', `No config at ${CONFIG_PATH}. Run first-time setup (see SKILL.md).`);
  }
  let cfg;
  try {
    cfg = JSON.parse(raw);
  } catch (err) {
    throw new CmdError('CONFIG_INVALID', `${CONFIG_PATH} is not valid JSON: ${err.message}`);
  }
  return validateConfig(cfg);
}

export function writeConfig(cfg) {
  validateConfig(cfg);
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2) + '\n', { mode: 0o600 });
  return CONFIG_PATH;
}
