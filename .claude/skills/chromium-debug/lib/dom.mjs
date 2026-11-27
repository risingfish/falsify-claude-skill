// Helpers that run inside the page. Playwright serializes functions with toString(), so a helper is spliced into the
// page function's source instead of being imported.

function cssPath(el) {
  const parts = [];
  while (el && el.nodeType === 1 && parts.length < 6) {
    let s = el.tagName.toLowerCase();
    if (el.id) {
      parts.unshift(`${s}#${CSS.escape(el.id)}`);
      break;
    }
    s += [...el.classList].slice(0, 2).map((c) => `.${CSS.escape(c)}`).join('');
    const parent = el.parentElement;
    if (parent) {
      const same = [...parent.children].filter((c) => c.tagName === el.tagName);
      if (same.length > 1) s += `:nth-of-type(${same.indexOf(el) + 1})`;
    }
    parts.unshift(s);
    el = parent;
  }
  return parts.join(' > ');
}

function round(n) {
  return Math.round(n * 100) / 100;
}

function rectOf(el) {
  const r = el.getBoundingClientRect();
  return { x: round(r.x), y: round(r.y), width: round(r.width), height: round(r.height), right: round(r.right), bottom: round(r.bottom) };
}

// Wrap fn(a, b) so cssPath, round and rectOf are in scope when it runs in the page.
export function inPage(fn) {
  return new Function('a', 'b', `const cssPath = ${cssPath}; const round = ${round}; const rectOf = ${rectOf}; return (${fn})(a, b);`);
}
