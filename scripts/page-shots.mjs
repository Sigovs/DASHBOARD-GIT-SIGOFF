#!/usr/bin/env node
/**
 * Version thumbnails.
 *
 * A project here is rarely one design. PATTON has seven indexes, Midwest Cobras
 * and BHCC have ten each — those alternatives are the work, and a list of
 * filenames is a bad way to look at design work. So every version and page gets
 * its own small screenshot, and the drawer shows them as a grid you can scan.
 *
 * Cached exactly like the main thumbnails: keyed on the repository's pushedAt,
 * so a rerun captures nothing.
 *
 *   node scripts/page-shots.mjs
 *   node scripts/page-shots.mjs --only PATTON --force
 *   node scripts/page-shots.mjs --versions-only     # skip about/contact/srp/vdp
 */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { withBrowser, capture } from './lib/capture.mjs';
import { writePageThumbnail, slug } from './lib/image.mjs';
import { mapLimit } from './lib/concurrency.mjs';
import { captureTargets } from './lib/pages.mjs';
import {
  THUMB_DIR,
  OVERRIDES_FILE,
  loadEnv,
  readJson,
  writeJson,
  readAllRepos,
} from './lib/paths.mjs';
import { isMain } from './lib/is-main.mjs';
import { log } from './lib/log.mjs';

loadEnv();

const args = process.argv.slice(2);
const flag = (n) => args.includes(`--${n}`);
const val = (n, d) => {
  const i = args.indexOf(`--${n}`);
  return i !== -1 && args[i + 1] ? args[i + 1] : d;
};

export const PAGES_DIR = path.join(THUMB_DIR, 'pages');
export const PAGES_MANIFEST = path.join(PAGES_DIR, 'manifest.json');

const hash = (s) => createHash('sha1').update(String(s)).digest('hex').slice(0, 12);

function readOverrides() {
  const file = readJson(OVERRIDES_FILE, {}) || {};
  if (file.projects) return file.projects;
  const { _readme, categories, ...flat } = file;
  return flat;
}

export async function capturePageThumbnails({
  force = flag('force'),
  only = val('only', null),
  concurrency = Number(val('concurrency', 4)),
  versionsOnly = flag('versions-only'),
  limit = Number(val('limit', 0)) || null,
} = {}) {
  const repoFile = readAllRepos();
  if (!repoFile?.repos?.length) {
    throw new Error('data/repos.json is missing. Run `npm run sync` first.');
  }

  const overrides = readOverrides();
  const manifest = readJson(PAGES_MANIFEST, {}) || {};
  fs.mkdirSync(PAGES_DIR, { recursive: true });

  const wanted = only ? new Set(only.split(',').map((s) => s.trim())) : null;

  const jobs = [];
  let skipped = 0;

  for (const repo of repoFile.repos) {
    if (overrides[repo.name]?.hidden) continue;
    if (wanted && !wanted.has(repo.name)) continue;

    // Each subfolder of a container carries its own set of versions.
    for (const target of captureTargets(repo)) {
      const entries = versionsOnly
        ? target.versions
        : [...(target.versions || []), ...(target.pages || [])];

      for (const entry of entries) {
        const id = `${target.id}/${entry.file}`;
        const key = hash(`${entry.url}|${repo.pushedAt}`);
        const prev = manifest[id];
        // Private repositories keep their screenshots in a git-ignored subfolder.
        const prefix = repo.private ? 'private/' : '';
        const file = `${prefix}${slug(target.id)}--${slug(entry.file.replace(/\.html?$/i, ''))}.webp`;

        if (!force && prev?.sourceKey === key && fs.existsSync(path.join(PAGES_DIR, prev.file))) {
          skipped += 1;
          continue;
        }
        jobs.push({ id, repo, entry, key, file, prev });
      }
    }
  }

  log.step('Version thumbnails');
  log.dim(`${jobs.length} to capture · ${skipped} already current`);
  if (limit) jobs.splice(limit);
  if (!jobs.length) {
    writeJson(PAGES_MANIFEST, manifest);
    return manifest;
  }

  let done = 0;
  let failed = 0;

  await withBrowser(async (browser) => {
    await mapLimit(jobs, concurrency, async ({ id, repo, entry, key, file, prev }) => {
      try {
        // Versions are variations on one design; they settle faster than a
        // cold first load, so a shorter wait keeps 200 captures reasonable.
        const { buffer } = await capture(browser, entry.url, {
          settleMs: 1800,
          timeoutMs: 30000,
        });
        await writePageThumbnail(
          buffer,
          path.join(PAGES_DIR, path.dirname(file)),
          path.basename(file, '.webp'),
        );

        manifest[id] = {
          repo: repo.name,
          file,
          url: entry.url,
          label: entry.label,
          sourceKey: key,
          capturedAt: new Date().toISOString(),
          error: null,
        };
        done += 1;
        if (done % 20 === 0) log.dim(`${done}/${jobs.length}…`);
      } catch (err) {
        const message = String(err?.message || err)
          .split('\n')[0]
          .slice(0, 90);
        manifest[id] = {
          ...(prev || {}),
          repo: repo.name,
          url: entry.url,
          label: entry.label,
          error: message,
        };
        failed += 1;
      }
    });
  });

  writeJson(PAGES_MANIFEST, manifest);
  const bytes = fs
    .readdirSync(PAGES_DIR)
    .filter((f) => f.endsWith('.webp'))
    .reduce((n, f) => n + fs.statSync(path.join(PAGES_DIR, f)).size, 0);

  log.ok(
    `${done} captured${failed ? `, ${failed} failed` : ''} · ${(bytes / 1048576).toFixed(1)} MB total`,
  );
  return manifest;
}

if (isMain(import.meta.url)) {
  capturePageThumbnails().catch((err) => {
    log.err(err.message);
    process.exit(1);
  });
}
