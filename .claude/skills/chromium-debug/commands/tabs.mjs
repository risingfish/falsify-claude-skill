export default {
  name: 'tabs',
  description: 'List open tabs with ids, URLs, titles and which one is current',
  noPage: true,
  async run({ session }) {
    return { tabs: await session.tabs() };
  },
};
