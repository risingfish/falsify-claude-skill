export default {
  name: 'emulate',
  description: 'Show the current tab\'s emulation, or clear all of it with --reset (injected CSS is kept)',
  args: {
    reset: { type: 'boolean', description: 'drop viewport, device, touch, user agent and media emulation' },
  },
  async run({ tab, session, args }) {
    if (args.reset) await session.resetEmulation(tab);
    return { emulation: tab.emulation };
  },
};
