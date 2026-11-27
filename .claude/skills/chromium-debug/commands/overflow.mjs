import { inPage } from '../lib/dom.mjs';

export default {
  name: 'overflow',
  description: 'Elements that stick out past the viewport width and cause horizontal scrolling',
  args: {
    limit: { type: 'number', default: 50, description: 'max elements to report (default 50)' },
  },
  async run({ page, args }) {
    return page.evaluate(inPage((limit) => {
      const vw = document.documentElement.clientWidth;
      const sticksOut = (r) => r.right > vw + 0.5 || r.left < -0.5;
      // An ancestor that clips horizontally stops the element from widening the page. If that ancestor sticks out
      // itself, it gets reported on its own.
      const clipped = (el) => {
        for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
          if (getComputedStyle(p).overflowX !== 'visible') return true;
        }
        return false;
      };
      const found = [];
      for (const el of document.body.querySelectorAll('*')) {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0 || !sticksOut(r) || clipped(el)) continue;
        // Report where the overflow starts, not every descendant of an overflowing box.
        const parent = el.parentElement;
        if (parent && parent !== document.body && sticksOut(parent.getBoundingClientRect())) continue;
        found.push({ selector: cssPath(el), rect: rectOf(el), overBy: round(Math.max(r.right - vw, -r.left)) });
      }
      return {
        viewportWidth: vw,
        scrollWidth: document.documentElement.scrollWidth,
        hasHorizontalScroll: document.documentElement.scrollWidth > vw,
        total: found.length,
        elements: found.sort((a, b) => b.overBy - a.overBy).slice(0, limit),
      };
    }), args.limit);
  },
};
