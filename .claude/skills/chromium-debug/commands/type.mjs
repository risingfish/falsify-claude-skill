import { resolveElement, NTH_ARG } from '../lib/element.mjs';

export default {
  name: 'type',
  description: 'Replace the value of an input/textarea/contenteditable with text; --enter submits',
  args: {
    selector: { type: 'string', positional: 0, required: true },
    text: { type: 'string', positional: 1, rest: true, required: true },
    enter: { type: 'boolean', description: 'press Enter afterwards' },
    nth: NTH_ARG,
  },
  async run({ page, args }) {
    const el = await resolveElement(page, args.selector, { nth: args.nth });
    await el.fill(args.text);
    if (args.enter) await el.press('Enter');
    return { typed: args.text.length, url: page.url() };
  },
};
