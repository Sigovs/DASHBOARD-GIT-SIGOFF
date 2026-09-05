#!/usr/bin/env node
/**
 * Desktop icons.
 *
 * Windows gives a .cmd file a generic gear and a .url a generic browser page.
 * On a desktop full of folders that is invisible, so the shortcuts get real
 * icons instead.
 *
 * They read as one family: a dark tile with a brass mark, matching the catalog
 * itself. UPDATE is the exception — it inverts to a solid brass tile, because
 * it is the one you press rather than the one you open, and inversion is what
 * makes it findable at a glance without shouting in a different colour.
 *
 *   node scripts/make-icons.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { ROOT } from './lib/paths.mjs';
import { log } from './lib/log.mjs';

const OUT = path.join(ROOT, 'assets', 'icons');

// Small sizes carry the desktop; 256 carries the "large icons" view.
const SIZES = [16, 24, 32, 48, 64, 128, 256];

const INK = '#0B0B0D';
const BRASS_HI = '#F2D69B';
const BRASS = '#C6A76B';

const tile = (fill, extra = '') => `
  <rect width="256" height="256" rx="58" fill="${fill}"/>
  ${extra}`;

/**
 * A circular arrow.
 *
 * The arc deliberately ends at twelve o'clock, where the tangent is exactly
 * horizontal, so the head is a plain right-pointing triangle rather than a
 * rotated one. Anything angled develops a visible seam against the stroke once
 * the icon is scaled to 16px; a flat join never does. The tail stops at two
 * o'clock, leaving a gap wide enough to still read as a gap that small.
 */
const UPDATE = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="0.35" y2="1">
      <stop offset="0" stop-color="${BRASS_HI}"/>
      <stop offset="1" stop-color="${BRASS}"/>
    </linearGradient>
  </defs>
  ${tile('url(#g)')}
  <path d="M 186.3 106.8 A 62 62 0 1 1 128 66"
        fill="none" stroke="${INK}" stroke-width="28" stroke-linecap="round"/>
  <path d="M 168 66 L 120 92 L 120 40 Z" fill="${INK}"/>
</svg>`;

/** Four panes: the grid of thumbnails, reduced to the smallest thing that still reads. */
const grid = (a, b) => `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256">
  ${tile(INK, `<rect x="1.5" y="1.5" width="253" height="253" rx="56.5" fill="none" stroke="rgba(255,255,255,.10)" stroke-width="3"/>`)}
  <rect x="52"  y="60"  width="70" height="58" rx="11" fill="${a}"/>
  <rect x="134" y="60"  width="70" height="58" rx="11" fill="${b}"/>
  <rect x="52"  y="130" width="70" height="58" rx="11" fill="${b}"/>
  <rect x="134" y="130" width="70" height="58" rx="11" fill="${a}"/>
</svg>`;

const ICONS = {
  update: UPDATE,
  'catalog-live': grid(BRASS_HI, 'rgba(255,255,255,.30)'),
  'catalog-offline': grid('rgba(255,255,255,.42)', 'rgba(255,255,255,.16)'),
  'catalog-git': grid(BRASS, 'rgba(255,255,255,.22)'),
};

/**
 * ICO container. Each entry is a whole PNG — supported since Vista and far
 * simpler than packing DIB bitmaps with their upside-down masks.
 */
function buildIco(pngs) {
  const count = pngs.length;
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // 1 = icon
  header.writeUInt16LE(count, 4);

  const directory = Buffer.alloc(16 * count);
  let offset = 6 + 16 * count;

  pngs.forEach(({ size, data }, i) => {
    const at = i * 16;
    directory.writeUInt8(size >= 256 ? 0 : size, at + 0); // 0 means 256
    directory.writeUInt8(size >= 256 ? 0 : size, at + 1);
    directory.writeUInt8(0, at + 2); // palette
    directory.writeUInt8(0, at + 3); // reserved
    directory.writeUInt16LE(1, at + 4); // colour planes
    directory.writeUInt16LE(32, at + 6); // bits per pixel
    directory.writeUInt32LE(data.length, at + 8);
    directory.writeUInt32LE(offset, at + 12);
    offset += data.length;
  });

  return Buffer.concat([header, directory, ...pngs.map((p) => p.data)]);
}

export async function makeIcons() {
  fs.mkdirSync(OUT, { recursive: true });
  log.step('Desktop icons');

  const written = [];

  for (const [name, svg] of Object.entries(ICONS)) {
    const pngs = [];
    for (const size of SIZES) {
      pngs.push({
        size,
        data: await sharp(Buffer.from(svg)).resize(size, size).png({ compressionLevel: 9 }).toBuffer(),
      });
    }

    const file = path.join(OUT, `${name}.ico`);
    fs.writeFileSync(file, buildIco(pngs));

    // A PNG alongside, so the design can be looked at without opening Windows.
    await sharp(Buffer.from(svg)).resize(256, 256).png().toFile(path.join(OUT, `${name}.png`));

    written.push(`${name}.ico`);
    log.ok(`${name}.ico — ${SIZES.length} sizes, ${(fs.statSync(file).size / 1024).toFixed(0)} KB`);
  }

  return written;
}

makeIcons().catch((err) => {
  log.err(err.message);
  process.exit(1);
});
