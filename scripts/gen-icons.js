import sharp from 'sharp';
import { existsSync, mkdirSync, readFileSync } from 'fs';

const ICON_SIZES = [180, 192, 512];
const INPUT = 'public/favicon.ico';
const OUT_DIR = 'public/icons';
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);

function findLargestPNG(icoBuf) {
  const count = icoBuf.readUInt16LE(4);
  let best = null;
  for (let i = 0; i < count; i++) {
    const base = 6 + i * 16;
    const w = icoBuf[base] || 256;
    const h = icoBuf[base + 1] || 256;
    const size = icoBuf.readUInt32LE(base + 8);
    const offset = icoBuf.readUInt32LE(base + 12);
    const isPNG = icoBuf.slice(offset, offset + 8).equals(PNG_MAGIC);
    if (isPNG && (!best || w * h > best.w * best.h)) {
      best = { w, h, offset, size };
    }
  }
  if (!best) throw new Error('No PNG entry found in ICO');
  return icoBuf.subarray(best.offset, best.offset + best.size);
}

if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });

const icoBuf = readFileSync(INPUT);
const pngBuf = findLargestPNG(icoBuf);
console.log(`Extracted PNG from ICO (${pngBuf.length} bytes)`);

await Promise.all(ICON_SIZES.map(async size => {
  const path = `${OUT_DIR}/icon-${size}.png`;
  await sharp(pngBuf)
    .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toFile(path);
  console.log(`Generated ${path}`);
}));

console.log('Done.');
