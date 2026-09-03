import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

/** The catalogue aspect ratio. Everything is cropped to this so the grid never shifts. */
export const ASPECT = { w: 16, h: 10 };
export const LARGE = { width: 1600, height: 1000 }; // drawer / retina card
export const SMALL = { width: 800, height: 500 };   // grid card

/**
 * One source image -> two optimised WebP files.
 * Cover-crops from the top: a website's identity lives in its first screenful,
 * so a centre crop would throw away the logo and the hero headline.
 */
export async function writeThumbnails(input, outDir, baseName, { position = 'top' } = {}) {
  fs.mkdirSync(outDir, { recursive: true });

  const file = `${baseName}.webp`;
  const fileSm = `${baseName}@sm.webp`;

  const pipeline = () => sharp(input, { failOn: 'none' }).rotate();

  await pipeline()
    .resize({ ...LARGE, fit: 'cover', position })
    .webp({ quality: 82, effort: 5 })
    .toFile(path.join(outDir, file));

  await pipeline()
    .resize({ ...SMALL, fit: 'cover', position })
    .webp({ quality: 78, effort: 5 })
    .toFile(path.join(outDir, fileSm));

  const bytes =
    fs.statSync(path.join(outDir, file)).size + fs.statSync(path.join(outDir, fileSm)).size;

  return { file, fileSm, bytes, width: LARGE.width, height: LARGE.height };
}

/** Filesystem-safe stem for a repository name. */
export function slug(name) {
  return String(name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'project';
}
