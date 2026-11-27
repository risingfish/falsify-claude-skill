import { CmdError } from '../lib/errors.mjs';

const SCHEMES = ['light', 'dark', 'no-preference'];

export default {
  name: 'media',
  description: 'Emulate CSS media: --color-scheme dark, --reduced-motion, --print (--no-<flag> turns one off)',
  args: {
    'color-scheme': { type: 'string', description: SCHEMES.join(' | ') },
    'reduced-motion': { type: 'boolean', description: 'prefers-reduced-motion: reduce' },
    print: { type: 'boolean', description: 'print media type instead of screen' },
  },
  async run({ cdp, tab, args }) {
    const media = { ...(tab.emulation.media || {}) };
    if (args['color-scheme'] !== undefined) {
      if (!SCHEMES.includes(args['color-scheme'])) throw new CmdError('BAD_ARGS', `--color-scheme must be one of ${SCHEMES.join(', ')}`);
      media.colorScheme = args['color-scheme'];
    }
    if (args['reduced-motion'] !== undefined) media.reducedMotion = args['reduced-motion'];
    if (args.print !== undefined) media.print = args.print;
    const features = [];
    if (media.colorScheme) features.push({ name: 'prefers-color-scheme', value: media.colorScheme });
    if (media.reducedMotion !== undefined) features.push({ name: 'prefers-reduced-motion', value: media.reducedMotion ? 'reduce' : 'no-preference' });
    await cdp.send('Emulation.setEmulatedMedia', { media: media.print ? 'print' : '', features });
    tab.emulation.media = media;
    return { emulation: tab.emulation };
  },
};
