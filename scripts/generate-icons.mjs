#!/usr/bin/env node
/**
 * Generates PWA PNG icons with no image dependencies.
 * Renders a small vector scene at 4x and box-downsamples it for smooth edges.
 */
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = fileURLToPath(new URL('../web/public/icons/', import.meta.url));

const CRC_TABLE = new Uint32Array(256);
for (let n = 0; n < 256; n += 1) {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  CRC_TABLE[n] = c >>> 0;
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const name = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([name, data])), 0);
  return Buffer.concat([length, name, data, crc]);
}

function encodePng(width, height, rgba) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // RGBA
  header[10] = 0;
  header[11] = 0;
  header[12] = 0;
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * (width * 4 + 1);
    raw[rowStart] = 0;
    rgba.copy(raw, rowStart + 1, y * width * 4, (y + 1) * width * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function insideRoundedRect(u, v, x, y, w, h, r) {
  if (u < x || u > x + w || v < y || v > y + h) return false;
  const cx = Math.max(x + r, Math.min(u, x + w - r));
  const cy = Math.max(y + r, Math.min(v, y + h - r));
  if (u >= x + r && u <= x + w - r) return true;
  if (v >= y + r && v <= y + h - r) return true;
  return (u - cx) ** 2 + (v - cy) ** 2 <= r ** 2;
}

function insideCircle(u, v, cx, cy, r) {
  return (u - cx) ** 2 + (v - cy) ** 2 <= r ** 2;
}

function gradient(v) {
  const t = Math.max(0, Math.min(1, v));
  return [
    Math.round(15 + (11 - 15) * t),
    Math.round(118 + (95 - 118) * t),
    Math.round(110 + (90 - 110) * t),
    255,
  ];
}

function paint(u, v, maskable) {
  const bgRadius = maskable ? 0 : 0.22;
  const onBackground = insideRoundedRect(u, v, 0, 0, 1, 1, bgRadius);
  if (!onBackground) return [0, 0, 0, 0];

  const background = gradient(v);

  // Bars
  if (insideRoundedRect(u, v, 0.225, 0.555, 0.14, 0.22, 0.025)) return [255, 255, 255, 255];
  if (insideRoundedRect(u, v, 0.43, 0.455, 0.14, 0.32, 0.025)) return [255, 255, 255, 255];
  if (insideRoundedRect(u, v, 0.635, 0.355, 0.14, 0.42, 0.025)) return [255, 255, 255, 255];

  // Coin ring
  if (insideCircle(u, v, 0.5, 0.235, 0.105)) {
    if (insideCircle(u, v, 0.5, 0.235, 0.055)) return background;
    return [255, 255, 255, 255];
  }

  return background;
}

function render(size, maskable) {
  const ss = 4;
  const big = size * ss;
  const hi = Buffer.alloc(big * big * 4);
  for (let y = 0; y < big; y += 1) {
    for (let x = 0; x < big; x += 1) {
      const rgba = paint((x + 0.5) / big, (y + 0.5) / big, maskable);
      const offset = (y * big + x) * 4;
      hi[offset] = rgba[0];
      hi[offset + 1] = rgba[1];
      hi[offset + 2] = rgba[2];
      hi[offset + 3] = rgba[3];
    }
  }

  const out = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sy = 0; sy < ss; sy += 1) {
        for (let sx = 0; sx < ss; sx += 1) {
          const offset = ((y * ss + sy) * big + (x * ss + sx)) * 4;
          const alpha = hi[offset + 3] / 255;
          r += hi[offset] * alpha;
          g += hi[offset + 1] * alpha;
          b += hi[offset + 2] * alpha;
          a += alpha;
        }
      }
      const samples = ss * ss;
      const outOffset = (y * size + x) * 4;
      out[outOffset] = a > 0 ? Math.round(r / a) : 0;
      out[outOffset + 1] = a > 0 ? Math.round(g / a) : 0;
      out[outOffset + 2] = a > 0 ? Math.round(b / a) : 0;
      out[outOffset + 3] = Math.round((a / samples) * 255);
    }
  }

  return encodePng(size, size, out);
}

mkdirSync(OUT, { recursive: true });
const targets = [
  ['icon-192.png', 192, false],
  ['icon-512.png', 512, false],
  ['maskable-512.png', 512, true],
  ['apple-touch-icon.png', 180, true],
];

for (const [name, size, maskable] of targets) {
  writeFileSync(join(OUT, name), render(size, maskable));
  console.log(`wrote web/public/icons/${name}`);
}
