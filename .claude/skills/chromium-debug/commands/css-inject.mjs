import fs from 'node:fs';
import path from 'node:path';
import { CmdError } from '../lib/errors.mjs';

// Injected through the CDP CSS domain so page Content-Security-Policy can't block it. Uses its own CDP session so
// `emulate --reset` doesn't take injected CSS with it. Navigation or reload drops injected CSS.
export async function cssSession(tab) {
  if (!tab.css) {
    const cdp = await tab.page.context().newCDPSession(tab.page);
    await cdp.send('DOM.enable');
    await cdp.send('CSS.enable');
    tab.css = { cdp, sheets: {} };
  }
  return tab.css;
}

export default {
  name: 'css-inject',
  description: 'Apply trial CSS to the page without editing source; the same --id replaces earlier CSS',
  args: {
    css: { type: 'string', positional: 0, rest: true },
    file: { type: 'string', description: 'read the CSS from this file instead' },
    id: { type: 'string', default: 'default', description: 'name for this block of CSS (default "default")' },
  },
  async run({ tab, args, cwd }) {
    if (!args.css === !args.file) throw new CmdError('BAD_ARGS', 'give CSS text or --file, not both');
    const text = args.file ? fs.readFileSync(path.resolve(cwd, args.file), 'utf8') : args.css;
    const css = await cssSession(tab);
    const existing = css.sheets[args.id];
    let replaced = false;
    if (existing) {
      try {
        await css.cdp.send('CSS.setStyleSheetText', { styleSheetId: existing, text });
        replaced = true;
      } catch { /* sheet vanished with a navigation; make a new one */ }
    }
    if (!replaced) {
      const { frameTree } = await css.cdp.send('Page.getFrameTree');
      const { styleSheetId } = await css.cdp.send('CSS.createStyleSheet', { frameId: frameTree.frame.id });
      await css.cdp.send('CSS.setStyleSheetText', { styleSheetId, text });
      css.sheets[args.id] = styleSheetId;
    }
    return { id: args.id, replaced, bytes: text.length, active: Object.keys(css.sheets) };
  },
};
