import { inPage } from '../lib/dom.mjs';

export default {
  name: 'at',
  description: 'Which elements are at viewport point x,y, topmost first (finds overlays covering things)',
  args: {
    x: { type: 'number', positional: 0, required: true },
    y: { type: 'number', positional: 1, required: true },
    depth: { type: 'number', default: 5, description: 'how many stacked elements to return (default 5)' },
  },
  async run({ page, args }) {
    return page.evaluate(inPage(({ x, y, depth }) => ({
      stack: document.elementsFromPoint(x, y).slice(0, depth).map((el) => ({
        selector: cssPath(el),
        tag: el.tagName.toLowerCase(),
        rect: rectOf(el),
        zIndex: getComputedStyle(el).zIndex,
        position: getComputedStyle(el).position,
        text: (el.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 80),
      })),
    })), { x: args.x, y: args.y, depth: args.depth });
  },
};
