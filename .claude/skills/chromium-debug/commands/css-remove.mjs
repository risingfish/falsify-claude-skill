import { CmdError } from '../lib/errors.mjs';
import { cssSession } from './css-inject.mjs';

export default {
  name: 'css-remove',
  description: 'Remove injected CSS: one block by --id, or all of it',
  args: {
    id: { type: 'string', description: 'which block to remove (default: all)' },
  },
  async run({ tab, args }) {
    const css = await cssSession(tab);
    const ids = args.id ? [args.id] : Object.keys(css.sheets);
    if (args.id && !css.sheets[args.id]) throw new CmdError('NO_MATCH', `no injected CSS with id "${args.id}"`);
    for (const id of ids) {
      await css.cdp.send('CSS.setStyleSheetText', { styleSheetId: css.sheets[id], text: '' }).catch(() => {});
      delete css.sheets[id];
    }
    return { removed: ids, active: Object.keys(css.sheets) };
  },
};
