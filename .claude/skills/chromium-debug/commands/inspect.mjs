import { resolveElement, NTH_ARG } from '../lib/element.mjs';
import { inPage } from '../lib/dom.mjs';

const KEY_STYLES = [
  'display', 'position', 'top', 'right', 'bottom', 'left', 'z-index', 'box-sizing', 'width', 'height',
  'margin', 'padding', 'border-width', 'overflow', 'flex-direction', 'justify-content', 'align-items', 'gap',
  'grid-template-columns', 'font-family', 'font-size', 'font-weight', 'line-height', 'color', 'background-color',
  'opacity', 'visibility', 'transform',
];

export default {
  name: 'inspect',
  description: 'Position and size, key computed styles, attributes and text of one element',
  args: {
    selector: { type: 'string', positional: 0, required: true },
    props: { type: 'string', list: true, description: 'extra CSS properties to include' },
    nth: NTH_ARG,
  },
  async run({ page, args }) {
    const el = await resolveElement(page, args.selector, { nth: args.nth });
    return el.evaluate(inPage((node, props) => {
      const cs = getComputedStyle(node);
      const rect = rectOf(node);
      return {
        selector: cssPath(node),
        tag: node.tagName.toLowerCase(),
        attributes: Object.fromEntries([...node.attributes].map((a) => [a.name, a.value])),
        rect,
        documentRect: { x: round(rect.x + scrollX), y: round(rect.y + scrollY), width: rect.width, height: rect.height },
        visible: rect.width > 0 && rect.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none',
        inViewport: rect.bottom > 0 && rect.right > 0 && rect.y < innerHeight && rect.x < innerWidth,
        viewport: { width: innerWidth, height: innerHeight, scrollX, scrollY, dpr: devicePixelRatio },
        children: node.children.length,
        text: (node.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 200),
        styles: Object.fromEntries(props.map((p) => [p, cs.getPropertyValue(p)])),
      };
    }), [...KEY_STYLES, ...(args.props || [])]);
  },
};
