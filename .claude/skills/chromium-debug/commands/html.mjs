import { resolveElement, NTH_ARG } from '../lib/element.mjs';

export default {
  name: 'html',
  description: 'Markup of one element (outerHTML, or innerHTML with --inner)',
  args: {
    selector: { type: 'string', positional: 0, required: true },
    inner: { type: 'boolean', description: 'innerHTML instead of outerHTML' },
    max: { type: 'number', default: 20000, description: 'truncate after this many characters (default 20000)' },
    nth: NTH_ARG,
  },
  async run({ page, args }) {
    const el = await resolveElement(page, args.selector, { nth: args.nth });
    const html = await el.evaluate((n, inner) => (inner ? n.innerHTML : n.outerHTML), Boolean(args.inner));
    return { length: html.length, truncated: html.length > args.max, html: html.slice(0, args.max) };
  },
};
