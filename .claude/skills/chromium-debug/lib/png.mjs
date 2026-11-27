// Minimal PNG codec on node:zlib, enough for browser screenshots: 8-bit, non-interlaced, grayscale/RGB/RGBA.
import zlib from 'node:zlib';
import { CmdError } from './errors.mjs';

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const CHANNELS = { 0: 1, 2: 3, 4: 2, 6: 4 }; // color type -> channels

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

// Returns { width, height, data } where data is RGBA, 4 bytes per pixel.
export function decodePng(buf) {
  if (!buf.subarray(0, 8).equals(SIGNATURE)) throw new CmdError('BAD_ARGS', 'not a PNG file');
  let pos = 8, width, height, depth, colorType, interlace;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('latin1', pos + 4, pos + 8);
    const body = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      depth = body[8];
      colorType = body[9];
      interlace = body[12];
    } else if (type === 'IDAT') {
      idat.push(body);
    } else if (type === 'IEND') {
      break;
    }
    pos += 12 + len;
  }
  const channels = CHANNELS[colorType];
  if (depth !== 8 || !channels || interlace !== 0) {
    throw new CmdError('BAD_ARGS', `unsupported PNG (bit depth ${depth}, color type ${colorType}, interlace ${interlace})`);
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const px = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const src = y * (stride + 1) + 1;
    const dst = y * stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? px[dst + x - channels] : 0;
      const b = y > 0 ? px[dst - stride + x] : 0;
      const c = x >= channels && y > 0 ? px[dst - stride + x - channels] : 0;
      const v = raw[src + x];
      px[dst + x] = (filter === 0 ? v
        : filter === 1 ? v + a
          : filter === 2 ? v + b
            : filter === 3 ? v + ((a + b) >> 1)
              : v + paeth(a, b, c)) & 0xff;
    }
  }
  if (channels === 4) return { width, height, data: px };
  const data = Buffer.alloc(width * height * 4);
  for (let i = 0, j = 0; i < width * height; i++, j += channels) {
    const gray = channels <= 2;
    data[i * 4] = px[j];
    data[i * 4 + 1] = gray ? px[j] : px[j + 1];
    data[i * 4 + 2] = gray ? px[j] : px[j + 2];
    data[i * 4 + 3] = channels === 2 ? px[j + 1] : 255;
  }
  return { width, height, data };
}

function chunk(type, body) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(body.length);
  const tb = Buffer.concat([Buffer.from(type, 'latin1'), body]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(zlib.crc32(tb) >>> 0);
  return Buffer.concat([len, tb, crc]);
}

// Encodes RGBA pixels with filter 0 on every row.
export function encodePng({ width, height, data }) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) data.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  return Buffer.concat([SIGNATURE, chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
