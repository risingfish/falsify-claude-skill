import { CmdError } from '../lib/errors.mjs';

const STATES = ['visible', 'attached', 'hidden', 'detached'];

export default {
  name: 'wait',
  description: 'Wait for a selector, for the network to go idle, or for a fixed time',
  args: {
    selector: { type: 'string', positional: 0 },
    state: { type: 'string', description: `selector state: ${STATES.join(' | ')} (default visible)` },
    'network-idle': { type: 'boolean', description: 'wait until no network requests for 500 ms' },
    ms: { type: 'number', description: 'sleep this many milliseconds' },
  },
  async run({ page, args }) {
    const modes = [args.selector !== undefined, Boolean(args['network-idle']), args.ms !== undefined].filter(Boolean).length;
    if (modes !== 1) throw new CmdError('BAD_ARGS', 'give exactly one of <selector>, --network-idle, --ms');
    const started = Date.now();
    if (args.ms !== undefined) await page.waitForTimeout(args.ms);
    else if (args['network-idle']) await page.waitForLoadState('networkidle');
    else {
      const state = args.state || 'visible';
      if (!STATES.includes(state)) throw new CmdError('BAD_ARGS', `--state must be one of ${STATES.join(', ')}`);
      await page.locator(args.selector).first().waitFor({ state });
    }
    return { waitedMs: Date.now() - started };
  },
};
