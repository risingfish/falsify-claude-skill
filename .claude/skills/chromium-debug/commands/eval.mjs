export default {
  name: 'eval',
  description: 'Run JavaScript in the page: an expression, or statements with an explicit return. await works.',
  args: {
    js: { type: 'string', positional: 0, rest: true, required: true },
  },
  async run({ page, args }) {
    let value;
    try {
      value = await page.evaluate(`(async () => (${args.js}\n))()`);
    } catch (err) {
      if (!/SyntaxError/.test(err.message)) throw err;
      value = await page.evaluate(`(async () => { ${args.js}\n })()`);
    }
    return { value: value === undefined ? null : value };
  },
};
