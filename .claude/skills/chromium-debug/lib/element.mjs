// Selector resolution shared by every command that targets one element.
import { CmdError } from './errors.mjs';

// Returns a Playwright locator for exactly one element. Several matches without --nth is an error, so a command
// never silently acts on the wrong element. nth is 0-based.
export async function resolveElement(page, selector, { nth } = {}) {
  const all = page.locator(selector);
  let count;
  try {
    count = await all.count();
  } catch (err) {
    throw new CmdError('BAD_ARGS', `invalid selector "${selector}": ${err.message.split('\n')[0]}`);
  }
  if (count === 0) throw new CmdError('NO_MATCH', `${selector} matched 0 elements`);
  if (nth === undefined) {
    if (count > 1) throw new CmdError('AMBIGUOUS_MATCH', `${selector} matched ${count} elements; pass --nth <0..${count - 1}>`, { count });
    return all.first();
  }
  if (!Number.isInteger(nth) || nth < 0 || nth >= count) {
    throw new CmdError('BAD_ARGS', `--nth ${nth} out of range; ${selector} matched ${count} elements`);
  }
  return all.nth(nth);
}

export const NTH_ARG = { type: 'number', description: 'pick the Nth match (0-based) when the selector matches several' };
