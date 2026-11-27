import { CmdError } from '../lib/errors.mjs';
import { resolveElement, NTH_ARG } from '../lib/element.mjs';

export default {
  name: 'css',
  description: 'Computed CSS of one element: chosen properties (--props) or everything (--all)',
  args: {
    selector: { type: 'string', positional: 0, required: true },
    props: { type: 'string', list: true, description: 'properties to read, comma-separated' },
    all: { type: 'boolean', description: 'every computed property' },
    nth: NTH_ARG,
  },
  async run({ page, args }) {
    if (!args.all === !args.props) throw new CmdError('BAD_ARGS', 'give exactly one of --props or --all');
    const el = await resolveElement(page, args.selector, { nth: args.nth });
    const styles = await el.evaluate((n, props) => {
      const cs = getComputedStyle(n);
      const names = props || [...cs];
      return Object.fromEntries(names.map((p) => [p, cs.getPropertyValue(p)]));
    }, args.props || null);
    return { styles };
  },
};
