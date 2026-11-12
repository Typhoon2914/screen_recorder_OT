import fs from 'node:fs';
import path from 'node:path';
import { deflateSync } from 'node:zlib';

// Deliberately temporary orange laboratory identity. No outside dependencies.
// The built icon files are generated in the experimental output only; the
// original installed extension and source artwork remain untouched.
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const value of bytes) {
    crc ^= value;
    for (let bit = 0; bit < 8; bit++) {
      crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function pngChunk(type, data) {
  const tag = Buffer.from(type, 'ascii');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([tag, data])), 0);
  return Buffer.concat([length, tag, data, checksum]);
}
function makeIcon(size) {
  const bytes = Buffer.alloc(size * (1 + size * 4));
  const paint = (x, y, red, green, blue, alpha = 255) => {
    const index = y * (1 + size * 4) + 1 + 4 * x;
    bytes[index] = red;
    bytes[index + 1] = green;
    bytes[index + 2] = blue;
    bytes[index + 3] = alpha;
  };
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = (x + 0.5) / size;
      const v = (y + 0.5) / size;
      // High-contrast amber badge: instantly distinguishable from blue backup.
      const rounded = (u > 0.16 && u < 0.84 && v > 0.08 && v < 0.92)
        || (u > 0.08 && u < 0.92 && v > 0.16 && v < 0.84)
        || ((Math.abs(u - 0.16) ** 2 + Math.abs(v - 0.16) ** 2) < 0.08 ** 2)
        || ((Math.abs(u - 0.84) ** 2 + Math.abs(v - 0.16) ** 2) < 0.08 ** 2)
        || ((Math.abs(u - 0.16) ** 2 + Math.abs(v - 0.84) ** 2) < 0.08 ** 2)
        || ((Math.abs(u - 0.84) ** 2 + Math.abs(v - 0.84) ** 2) < 0.08 ** 2);
      const background = rounded ? [250, 162, 33, 255] : [0, 0, 0, 0];
      paint(x, y, ...background);
      if (!rounded) continue;
      // Bold dark E: the experimental variant of the recorder.
      const vertical = u >= 0.29 && u <= 0.43 && v >= 0.23 && v <= 0.77;
      const top = u >= 0.39 && u <= 0.72 && v >= 0.23 && v <= 0.35;
      const middle = u >= 0.39 && u <= 0.66 && v >= 0.44 && v <= 0.56;
      const bottom = u >= 0.39 && u <= 0.72 && v >= 0.65 && v <= 0.77;
      if (vertical || top || middle || bottom) paint(x, y, 23, 28, 42);
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // 8-bit RGBA
  header[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(bytes)),
    pngChunk('IEND', Buffer.alloc(0))
  ]);
}
export function writeExperimentIcons(outputDir) {
  const iconDir = path.join(outputDir, 'icons');
  fs.mkdirSync(iconDir, { recursive: true });
  for (const size of [16, 32, 48, 128]) {
    fs.writeFileSync(path.join(iconDir, `icon${size}.png`), makeIcon(size));
  }
}
