export default {
  name: 'tab',
  description: 'Make another tab current (id prefix from `tabs`) and bring it to the front',
  noPage: true,
  args: {
    id: { type: 'string', positional: 0, required: true },
  },
  async run({ session, args }) {
    const rec = session.select(args.id);
    await rec.page.bringToFront();
    return { id: rec.id, url: rec.page.url(), title: await rec.page.title() };
  },
};
