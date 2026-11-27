import { CmdError } from '../lib/errors.mjs';

export default {
  name: 'viewport',
  description: 'Emulate a viewport size, e.g. viewport 390x844 --dpr 3 --mobile',
  args: {
    size: { type: 'string', positional: 0, required: true },
    dpr: { type: 'number', description: 'device pixel ratio (default: keep the real one)' },
    mobile: { type: 'boolean', description: 'mobile mode: meta viewport and overlay scrollbars apply' },
  },
  async run({ cdp, tab, args }) {
    const m = /^(\d+)x(\d+)$/.exec(args.size);
    if (!m) throw new CmdError('BAD_ARGS', `size must look like 390x844, got "${args.size}"`);
    const viewport = { width: Number(m[1]), height: Number(m[2]), deviceScaleFactor: args.dpr ?? 0, mobile: Boolean(args.mobile) };
    await cdp.send('Emulation.setDeviceMetricsOverride', viewport);
    tab.emulation.viewport = viewport;
    delete tab.emulation.device;
    return { emulation: tab.emulation };
  },
};
