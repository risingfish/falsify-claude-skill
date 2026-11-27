import { CmdError } from '../lib/errors.mjs';
import { resolveElement, NTH_ARG } from '../lib/element.mjs';

function pair(name, v) {
  const m = /^(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)$/.exec(v);
  if (!m) throw new CmdError('BAD_ARGS', `--${name} must look like x,y, got "${v}"`);
  return [Number(m[1]), Number(m[2])];
}

export default {
  name: 'scroll',
  description: 'Scroll an element into view, or the window to (--to x,y) or by (--by dx,dy) a position',
  args: {
    selector: { type: 'string', positional: 0 },
    to: { type: 'string', description: 'absolute x,y' },
    by: { type: 'string', description: 'relative dx,dy' },
    nth: NTH_ARG,
  },
  async run({ page, args }) {
    const modes = [args.selector, args.to, args.by].filter((v) => v !== undefined).length;
    if (modes !== 1) throw new CmdError('BAD_ARGS', 'give exactly one of <selector>, --to, --by');
    if (args.selector) await (await resolveElement(page, args.selector, { nth: args.nth })).scrollIntoViewIfNeeded();
    else if (args.to) await page.evaluate(([x, y]) => window.scrollTo(x, y), pair('to', args.to));
    else await page.evaluate(([x, y]) => window.scrollBy(x, y), pair('by', args.by));
    return page.evaluate(() => ({ scrollX, scrollY, maxX: document.documentElement.scrollWidth - innerWidth, maxY: document.documentElement.scrollHeight - innerHeight }));
  },
};
