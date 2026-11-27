import { resolveElement, NTH_ARG } from '../lib/element.mjs';

export default {
  name: 'hover',
  description: 'Move the mouse over one element (to inspect or screenshot hover states)',
  args: {
    selector: { type: 'string', positional: 0, required: true },
    nth: NTH_ARG,
  },
  async run({ page, args }) {
    const el = await resolveElement(page, args.selector, { nth: args.nth });
    await el.hover();
    return { hovered: args.selector };
  },
};
