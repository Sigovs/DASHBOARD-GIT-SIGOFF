#!/usr/bin/env node
/**
 * The one command.
 *
 *   npm run catalog:update
 *
 *   1. pull every repository the account owns from GitHub
 *   1a. delete anything cached for a repository that no longer exists
 *   2. discover live preview URLs and in-repo preview images
 *   3. seed catalog-overrides.json with any repository it has not seen before
 *   4. find local clones so "Open in VS Code" works
 *   5. capture thumbnails for anything new or changed
 *   6. report what the catalog now contains
 *
 * Create a repository, deploy it, run this, and the new card is simply there
 * with a current screenshot. Nothing needs editing by hand unless you want a
 * nicer title.
 *
 * Flags are passed through to the underlying steps:
 *   --force          recapture every thumbnail
 *   --no-screenshots skip capture entirely (metadata only, seconds not minutes)
 *   --no-versions    skip the per-version screenshots, keep the main ones
 *   --no-local       skip the local clone scan
 *   --max-age 30     also recapture screenshots older than 30 days
 */
import { sync } from './sync-github.mjs';
import { scanLocal } from './scan-local.mjs';
import { captureThumbnails } from './screenshots.mjs';
import { capturePageThumbnails } from './page-shots.mjs';
import { buildCatalog } from './lib/catalog.mjs';
import { prune, reportPrune } from './lib/prune.mjs';
import { log } from './lib/log.mjs';

const args = process.argv.slice(2);
const flag = (n) => args.includes(`--${n}`);

const started = Date.now();

try {
  const repos = await sync();

  log.step('Removing what is gone');
  reportPrune(prune(repos, { isAuthoritative: process.env.CATALOG_PUBLIC_ONLY !== '1' }));

  if (!flag('no-local')) {
    scanLocal();
  }

  if (!flag('no-screenshots')) {
    await captureThumbnails();
    if (!flag('no-versions')) await capturePageThumbnails();
  }

  const catalog = buildCatalog();
  const { total, withPreview, withThumbnail, pinned, variants } = catalog.counts;

  log.step('Catalog');
  log.info(`${total} projects · ${pinned} pinned`);
  log.info(`${withPreview} with a live preview URL`);
  log.info(`${variants} versions and pages across the catalog`);
  log.info(`${withThumbnail} with a thumbnail · ${total - withThumbnail} on the generated placeholder`);

  const noThumb = catalog.projects.filter((p) => !p.thumb).map((p) => p.repo);
  if (noThumb.length) log.dim(`placeholder: ${noThumb.join(', ')}`);

  log.done(`Ready in ${((Date.now() - started) / 1000).toFixed(1)}s — run \`npm run dev\``);
} catch (err) {
  log.err(err.message);
  process.exit(1);
}
