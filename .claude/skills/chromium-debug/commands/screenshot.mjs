import fs from 'node:fs';
import { CmdError } from '../lib/errors.mjs';
import { resolveElement, NTH_ARG } from '../lib/element.mjs';

// Captured through our own CDP session so the shot always reflects the emulated viewport and device.
// captureBeyondViewport is avoided on purpose: Chromium leaves scrollbars hidden after it until the next reload,
// which would poison every later before/after diff.

// Temporarily stretch the viewport to the full page height, run fn, then restore the tab's exact emulation.
async function withFullHeight(page, cdp, tab, fn) {
  const emu = tab.emulation.viewport;
  const width = emu?.width ?? (await page.evaluate(() => innerWidth));
  const { cssContentSize } = await cdp.send('Page.getLayoutMetrics');
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width,
    height: Math.ceil(cssContentSize.height),
    deviceScaleFactor: emu?.deviceScaleFactor ?? 0,
    mobile: emu?.mobile ?? false,
  });
  try {
    return await fn();
  } finally {
    if (emu) await cdp.send('Emulation.setDeviceMetricsOverride', emu);
    else await cdp.send('Emulation.clearDeviceMetricsOverride');
  }
}

export default {
  name: 'screenshot',
  description: 'PNG of the viewport, the full page (--full) or one element (--selector); returns the file path',
  args: {
    full: { type: 'boolean', description: 'capture the whole page height (at the current viewport width)' },
    selector: { type: 'string', description: 'capture just this element' },
    nth: NTH_ARG,
    name: { type: 'string', description: 'file name (same name overwrites, handy for before/after)' },
  },
  async run({ page, cdp, tab, args, out }) {
    if (args.full && args.selector) throw new CmdError('BAD_ARGS', '--full and --selector are mutually exclusive');
    const capture = async (clip) => Buffer.from((await cdp.send('Page.captureScreenshot', { format: 'png', ...(clip ? { clip } : {}) })).data, 'base64');
    let buf;
    let mode = 'viewport';
    if (args.full) {
      mode = 'full';
      buf = await withFullHeight(page, cdp, tab, () => capture());
    } else if (args.selector) {
      mode = 'element';
      const el = await resolveElement(page, args.selector, { nth: args.nth });
      await el.scrollIntoViewIfNeeded();
      const rectOf = () => el.evaluate((n) => {
        const r = n.getBoundingClientRect();
        return { x: r.x + scrollX, y: r.y + scrollY, width: r.width, height: r.height, fits: r.top >= 0 && r.left >= 0 && r.bottom <= innerHeight && r.right <= innerWidth };
      });
      const r = await rectOf();
      if (r.width === 0 || r.height === 0) throw new CmdError('NO_MATCH', `${args.selector} is not rendered (zero size)`);
      const clipOf = ({ x, y, width, height }) => ({ x, y, width, height, scale: 1 });
      buf = r.fits
        ? await capture(clipOf(r))
        : await withFullHeight(page, cdp, tab, async () => capture(clipOf(await rectOf())));
    } else {
      buf = await capture();
    }
    const file = out.path(args.name, 'png');
    fs.writeFileSync(file, buf);
    const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight, dpr: devicePixelRatio }));
    return { path: file, mode, width: buf.readUInt32BE(16), height: buf.readUInt32BE(20), viewport };
  },
};
