import { CmdError } from '../lib/errors.mjs';

export default {
  name: 'console',
  description: 'Console messages and uncaught page errors captured since launch (all tabs, newest last)',
  noPage: true,
  args: {
    errors: { type: 'boolean', description: 'only console errors and uncaught exceptions' },
    since: { type: 'string', description: 'only entries at or after this ISO time' },
    limit: { type: 'number', default: 100, description: 'return at most the last N entries (default 100)' },
    clear: { type: 'boolean', description: 'empty the buffer after reading' },
  },
  async run({ state, args }) {
    let since = null;
    if (args.since) {
      since = Date.parse(args.since);
      if (Number.isNaN(since)) throw new CmdError('BAD_ARGS', `--since must be an ISO time, got "${args.since}"`);
    }
    const matching = state.console.filter((e) => (!args.errors || e.type === 'error' || e.type === 'pageerror')
      && (since === null || Date.parse(e.time) >= since));
    const entries = matching.slice(-args.limit);
    if (args.clear) state.console.length = 0;
    return { total: matching.length, returned: entries.length, entries, now: new Date().toISOString() };
  },
};
