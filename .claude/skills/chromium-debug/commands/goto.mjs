import { CmdError } from '../lib/errors.mjs';

const WAITS = ['load', 'domcontentloaded', 'networkidle', 'commit'];

// "localhost:3000" or "example.com/x" get http:// so quick local URLs just work.
export function normalizeUrl(url) {
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(url) || /^(about|data|file|chrome|blob|javascript):/i.test(url) ? url : `http://${url}`;
}

export default {
  name: 'goto',
  description: 'Navigate the current tab to a URL and wait for it to load',
  args: {
    url: { type: 'string', positional: 0, required: true },
    wait: { type: 'string', description: `wait condition: ${WAITS.join(' | ')} (default load)` },
  },
  async run({ page, args }) {
    const waitUntil = args.wait || 'load';
    if (!WAITS.includes(waitUntil)) throw new CmdError('BAD_ARGS', `--wait must be one of ${WAITS.join(', ')}`);
    const resp = await page.goto(normalizeUrl(args.url), { waitUntil });
    return { url: page.url(), status: resp?.status() ?? null, title: await page.title() };
  },
};
