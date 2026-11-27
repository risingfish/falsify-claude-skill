import { devices } from 'playwright-core';
import { CmdError } from '../lib/errors.mjs';

export default {
  name: 'device',
  description: 'Emulate a phone or tablet from Playwright\'s device list: size, pixel ratio, touch, user agent',
  args: {
    name: { type: 'string', positional: 0, rest: true, description: 'device name, e.g. "iPhone 15 Pro" or "Pixel 7"' },
    list: { type: 'boolean', description: 'list device names (filtered by <name> if given)' },
    reload: { type: 'boolean', description: 'reload afterwards so the server sees the new user agent' },
  },
  async run({ page, cdp, tab, args }) {
    const names = Object.keys(devices);
    if (args.list) {
      const q = (args.name || '').toLowerCase();
      return { devices: names.filter((n) => n.toLowerCase().includes(q)) };
    }
    if (!args.name) throw new CmdError('BAD_ARGS', 'give a device name, or --list');
    const key = names.find((n) => n.toLowerCase() === args.name.toLowerCase());
    if (!key) {
      const q = args.name.toLowerCase();
      throw new CmdError('NO_MATCH', `unknown device "${args.name}"`, { suggestions: names.filter((n) => n.toLowerCase().includes(q)).slice(0, 15) });
    }
    const d = devices[key];
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: d.viewport.width,
      height: d.viewport.height,
      deviceScaleFactor: d.deviceScaleFactor,
      mobile: d.isMobile,
      ...(d.screen ? { screenWidth: d.screen.width, screenHeight: d.screen.height } : {}),
    });
    await cdp.send('Emulation.setUserAgentOverride', { userAgent: d.userAgent });
    await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: d.hasTouch, maxTouchPoints: d.hasTouch ? 5 : 1 });
    tab.emulation.device = key;
    tab.emulation.viewport = { width: d.viewport.width, height: d.viewport.height, deviceScaleFactor: d.deviceScaleFactor, mobile: d.isMobile };
    tab.emulation.touch = d.hasTouch;
    tab.emulation.userAgent = d.userAgent;
    if (args.reload) await page.reload();
    return { emulation: tab.emulation, ...(args.reload ? {} : { note: 'pass --reload (or run reload) so the server gets the new user agent' }) };
  },
};
