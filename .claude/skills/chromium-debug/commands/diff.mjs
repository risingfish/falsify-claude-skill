import fs from 'node:fs';
import path from 'node:path';
import { CmdError } from '../lib/errors.mjs';
import { decodePng, encodePng } from '../lib/png.mjs';

// Accepts a path (absolute or relative to the caller's cwd) or a bare screenshot name from the output dir.
function resolveImage(ref, cwd, dir) {
  const candidates = [path.resolve(cwd, ref), path.join(dir, ref.endsWith('.png') ? ref : `${ref}.png`)];
  const hit = candidates.find((p) => fs.existsSync(p) && fs.statSync(p).isFile());
  if (!hit) throw new CmdError('BAD_ARGS', `image not found: ${ref} (looked in ${candidates.join(', ')})`);
  return hit;
}

export default {
  name: 'diff',
  description: 'Pixel-compare two screenshots; writes an image with changes in red and returns the changed area',
  noPage: true,
  args: {
    a: { type: 'string', positional: 0, required: true },
    b: { type: 'string', positional: 1, required: true },
    threshold: { type: 'number', default: 0, description: 'ignore per-channel differences up to this value, 0-255 (default 0)' },
    name: { type: 'string', description: 'output file name (default diff-<a>-<b>)' },
  },
  async run({ args, cwd, out }) {
    const [pa, pb] = [resolveImage(args.a, cwd, out.dir), resolveImage(args.b, cwd, out.dir)];
    const [A, B] = [decodePng(fs.readFileSync(pa)), decodePng(fs.readFileSync(pb))];
    if (A.width !== B.width || A.height !== B.height) {
      throw new CmdError('BAD_ARGS', `sizes differ: ${A.width}x${A.height} vs ${B.width}x${B.height}`);
    }
    const t = args.threshold;
    const img = { width: A.width, height: A.height, data: Buffer.alloc(A.data.length) };
    let changed = 0, minX = Infinity, minY = Infinity, maxX = -1, maxY = -1;
    for (let i = 0, px = 0; i < A.data.length; i += 4, px++) {
      const d = Math.max(Math.abs(A.data[i] - B.data[i]), Math.abs(A.data[i + 1] - B.data[i + 1]),
        Math.abs(A.data[i + 2] - B.data[i + 2]), Math.abs(A.data[i + 3] - B.data[i + 3]));
      if (d > t) {
        changed++;
        const x = px % A.width, y = (px - x) / A.width;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
        img.data.set([255, 0, 0, 255], i);
      } else {
        // Faded grayscale of the original keeps the layout recognizable around the red.
        const g = 255 - Math.round((255 - (A.data[i] * 0.3 + A.data[i + 1] * 0.59 + A.data[i + 2] * 0.11)) * 0.3);
        img.data.set([g, g, g, 255], i);
      }
    }
    const base = (p) => path.basename(p, '.png');
    const file = out.path(args.name || `diff-${base(pa)}-${base(pb)}`, 'png');
    fs.writeFileSync(file, encodePng(img));
    const total = A.width * A.height;
    return {
      a: pa,
      b: pb,
      diffPath: file,
      changedPixels: changed,
      totalPixels: total,
      changedPercent: Math.round((changed / total) * 10000) / 100,
      bbox: changed ? { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 } : null,
    };
  },
};
