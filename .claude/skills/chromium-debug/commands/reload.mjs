export default {
  name: 'reload',
  description: 'Reload the current tab and wait for it to load',
  args: {
    wait: { type: 'string', description: 'load | domcontentloaded | networkidle | commit (default load)' },
  },
  async run({ page, args }) {
    const resp = await page.reload({ waitUntil: args.wait || 'load' });
    return { url: page.url(), status: resp?.status() ?? null, title: await page.title() };
  },
};
