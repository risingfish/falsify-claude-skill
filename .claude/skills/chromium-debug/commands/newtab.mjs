import { normalizeUrl } from './goto.mjs';

export default {
  name: 'newtab',
  description: 'Open a new tab, make it current, and optionally load a URL',
  noPage: true,
  args: {
    url: { type: 'string', positional: 0 },
  },
  async run({ session, args }) {
    const rec = await session.newTab(args.url && normalizeUrl(args.url));
    return { id: rec.id, url: rec.page.url() };
  },
};
