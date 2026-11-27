// Loads command modules from commands/. A malformed module is reported and skipped, never fatal.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { COMMANDS_DIR } from './paths.mjs';

const RESERVED = new Set(['setup', 'detect', 'launch', 'status', 'stop', 'help']);

function problem(mod) {
  if (!mod || typeof mod !== 'object') return 'no default export';
  if (typeof mod.name !== 'string' || !/^[a-z][a-z0-9-]*$/.test(mod.name)) return 'name must be lowercase kebab-case';
  if (RESERVED.has(mod.name)) return `name "${mod.name}" is reserved`;
  if (typeof mod.description !== 'string') return 'description must be a string';
  if (mod.args !== undefined && (typeof mod.args !== 'object' || Array.isArray(mod.args))) return 'args must be an object';
  if (typeof mod.run !== 'function') return 'run must be a function';
  return null;
}

export async function loadCommands({ onError = () => {} } = {}) {
  const commands = new Map();
  for (const file of fs.readdirSync(COMMANDS_DIR).filter((f) => f.endsWith('.mjs')).sort()) {
    try {
      const mod = (await import(pathToFileURL(path.join(COMMANDS_DIR, file)).href)).default;
      const why = problem(mod);
      if (why) onError(file, why);
      else if (commands.has(mod.name)) onError(file, `duplicate command name "${mod.name}"`);
      else commands.set(mod.name, { args: {}, ...mod, file });
    } catch (err) {
      onError(file, err.message);
    }
  }
  return commands;
}
