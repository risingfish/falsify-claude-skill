// Turns a command module's `args` spec into a node:util parseArgs call.
//
// Spec fields per argument:
//   type: 'string' | 'number' | 'boolean'
//   positional: N        take the Nth positional instead of a --flag
//   rest: true           (positional only) join this and all later positionals with spaces
//   required, multiple, default, description
//   list: true           (string, non-positional) split comma-separated values, repeatable
import { parseArgs } from 'node:util';
import { CmdError } from './errors.mjs';

// Flags every daemon command accepts.
export const GLOBAL_ARGS = {
  timeout: { type: 'number', description: 'per-command timeout in ms (default 15000)' },
  tab: { type: 'string', description: 'run against this tab id instead of the current tab' },
  out: { type: 'string', description: 'output directory for files (default ./tmp/chromium-debug)' },
};

function toNumber(name, v) {
  const n = Number(v);
  if (v === '' || !Number.isFinite(n)) throw new CmdError('BAD_ARGS', `--${name} must be a number, got "${v}"`);
  return n;
}

export function parseCommandArgs(spec, argv) {
  const all = { ...GLOBAL_ARGS, ...spec };
  const options = {};
  for (const [name, a] of Object.entries(all)) {
    if (a.positional !== undefined) continue;
    options[name] = { type: a.type === 'boolean' ? 'boolean' : 'string', multiple: Boolean(a.multiple || a.list) };
  }
  let parsed;
  try {
    parsed = parseArgs({ args: argv, options, allowPositionals: true, strict: true, allowNegative: true });
  } catch (err) {
    throw new CmdError('BAD_ARGS', err.message);
  }
  const out = {};
  for (const [name, a] of Object.entries(all)) {
    let v;
    if (a.positional !== undefined) {
      v = a.rest ? parsed.positionals.slice(a.positional).join(' ') || undefined : parsed.positionals[a.positional];
    } else {
      v = parsed.values[name];
      if (a.list && v) v = v.flatMap((s) => s.split(',')).map((s) => s.trim()).filter(Boolean);
    }
    if (v === undefined) v = a.default;
    if (v === undefined) {
      if (a.required) throw new CmdError('BAD_ARGS', `missing required ${a.positional !== undefined ? `<${name}>` : `--${name}`}`);
      continue;
    }
    if (a.type === 'number') v = Array.isArray(v) ? v.map((x) => toNumber(name, x)) : toNumber(name, v);
    out[name] = v;
  }
  const maxPositional = Math.max(-1, ...Object.values(spec).filter((a) => a.positional !== undefined).map((a) => (a.rest ? Infinity : a.positional)));
  if (parsed.positionals.length > maxPositional + 1) {
    throw new CmdError('BAD_ARGS', `unexpected argument "${parsed.positionals[maxPositional + 1]}"`);
  }
  return out;
}

export function usage(mod) {
  const pos = Object.entries(mod.args || {})
    .filter(([, a]) => a.positional !== undefined)
    .sort(([, a], [, b]) => a.positional - b.positional)
    .map(([n, a]) => (a.required ? `<${n}${a.rest ? '...' : ''}>` : `[${n}${a.rest ? '...' : ''}]`));
  const flags = Object.entries(mod.args || {})
    .filter(([, a]) => a.positional === undefined)
    .map(([n, a]) => `  --${n}${a.type === 'boolean' ? '' : ` <${a.type}${a.list ? ',...' : ''}>`}  ${a.description || ''}`);
  return [`${mod.name} ${pos.join(' ')}`.trim(), `  ${mod.description}`, ...flags].join('\n');
}
