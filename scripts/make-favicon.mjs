// Generates public/favicon.ico — a rounded teal→blue tile with a white "T"
// monogram (TWikki branding, core theme accents #6db193 → #8fbfdf).
// Pure Node: hand-builds RGBA buffers with 4x supersampling, encodes PNGs, packs an ICO.
import {deflateSync} from 'node:zlib';
import {writeFileSync, mkdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname, join} from 'node:path';

const SS = 4; // supersampling factor for smooth edges
const A = [0x6d, 0xb1, 0x93]; // gradient start (teal)
const B = [0x8f, 0xbf, 0xdf]; // gradient end (blue)

const lerp = (a, b, t) => a + (b - a) * t;

// Is the point inside a rounded square of side `s` with corner radius `r`?
function insideRoundRect(px, py, s, r) {
  const dx = Math.min(px, s - px); // distance to nearest vertical edge
  const dy = Math.min(py, s - py);
  if (dx >= r || dy >= r) return px >= 0 && px <= s && py >= 0 && py <= s; // straight edges
  // within a corner zone: test distance to the corner's center
  const cx = px < r ? r : s - r;
  const cy = py < r ? r : s - r;
  return Math.hypot(px - cx, py - cy) <= r;
}

// The "T" glyph in unit (0..1) coordinates.
function inGlyph(u, v) {
  const bar = u >= 0.18 && u <= 0.82 && v >= 0.20 && v <= 0.34;     // top bar
  const stem = u >= 0.43 && u <= 0.57 && v >= 0.20 && v <= 0.80;    // vertical stem
  return bar || stem;
}

function renderRGBA(size) {
  const buf = Buffer.alloc(size * size * 4); // RGBA
  const r = size * 0.22;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let tileHits = 0, glyphHits = 0;
      // supersample
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const px = x + (sx + 0.5) / SS;
          const py = y + (sy + 0.5) / SS;
          if (insideRoundRect(px, py, size, r)) {
            tileHits++;
            if (inGlyph(px / size, py / size)) glyphHits++;
          }
        }
      }
      const total = SS * SS;
      const tileCov = tileHits / total;     // tile coverage (anti-aliased corners)
      const glyphCov = glyphHits / total;   // glyph coverage on top of the tile

      // base gradient colour at pixel centre
      const t = (x + y) / (2 * (size - 1));
      let rr = lerp(A[0], B[0], t);
      let gg = lerp(A[1], B[1], t);
      let bb = lerp(A[2], B[2], t);
      // top highlight: white wash fading out by mid-height
      const hl = Math.max(0, 0.22 * (1 - y / (size * 0.5)));
      rr = lerp(rr, 255, hl); gg = lerp(gg, 255, hl); bb = lerp(bb, 255, hl);
      // composite the white glyph over the tile
      rr = lerp(rr, 255, glyphCov);
      gg = lerp(gg, 255, glyphCov);
      bb = lerp(bb, 255, glyphCov);

      const i = (y * size + x) * 4;
      buf[i] = Math.round(rr);
      buf[i + 1] = Math.round(gg);
      buf[i + 2] = Math.round(bb);
      buf[i + 3] = Math.round(tileCov * 255);
    }
  }
  return buf;
}

// --- minimal PNG encoder (RGBA, 8-bit) ---
function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xEDB88320 & -(c & 1));
  }
  return ~c >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const body = Buffer.concat([typeBuf, data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}
function encodePNG(rgba, size) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 6;   // colour type RGBA
  // rows with filter byte 0
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  const idat = deflateSync(raw, {level: 9});
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

// --- ICO container (PNG-compressed entries) ---
function buildICO(images) {
  const count = images.length;
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(count, 4);
  const dir = Buffer.alloc(16 * count);
  let offset = 6 + 16 * count;
  const blobs = [];
  images.forEach((img, n) => {
    const o = 16 * n;
    dir[o] = img.size >= 256 ? 0 : img.size;     // width (0 = 256)
    dir[o + 1] = img.size >= 256 ? 0 : img.size; // height
    dir[o + 2] = 0; dir[o + 3] = 0;              // palette, reserved
    dir.writeUInt16LE(1, o + 4);                 // colour planes
    dir.writeUInt16LE(32, o + 6);                // bits per pixel
    dir.writeUInt32LE(img.png.length, o + 8);    // data size
    dir.writeUInt32LE(offset, o + 12);           // data offset
    offset += img.png.length;
    blobs.push(img.png);
  });
  return Buffer.concat([header, dir, ...blobs]);
}

const sizes = [16, 32, 48];
const images = sizes.map(size => ({size, png: encodePNG(renderRGBA(size), size)}));
const ico = buildICO(images);

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, '..', 'public', 'favicon.ico');
mkdirSync(dirname(out), {recursive: true});
writeFileSync(out, ico);
console.log(`Wrote ${out} (${ico.length} bytes, sizes: ${sizes.join('/')})`);
