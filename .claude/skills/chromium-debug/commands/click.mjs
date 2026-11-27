import { resolveElement, NTH_ARG } from '../lib/element.mjs';

export default {
  name: 'click',
  description: 'Click one element (waits for it to be visible, stable and enabled)',
  args: {
    selector: { type: 'string', positional: 0, required: true },
    nth: NTH_ARG,
  },
  async run({ page, args }) {
    const el = await resolveElement(page, args.selector, { nth: args.nth });
    await el.click();
    return { clicked: args.selector, url: page.url() };
  },
};
