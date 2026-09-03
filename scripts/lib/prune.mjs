import fs from 'node:fs';
import path from 'node:path';
import {
  THUMB_DIR,
  OVERRIDES_FILE,
  MANIFEST_FILE,
  MANIFEST_PRIVATE_FILE,
  PAGES_MANIFEST_FILE,
  readJson,
  writeJson,
  readManifest,
} from './paths.mjs';
import { log } from './log.mjs';

const PAGES_DIR = path.join(THUMB_DIR, 'pages');

/**
 * Removes everything that belongs to a repository, or a page, that no longer
 * exists on GitHub.
 *
 * Without this the catalog only ever grows: delete a repository, rename it, or
 * drop index7.html, and its screenshot sits in the cache forever and its entry
 * sits in the overrides forever. A dashboard that shows projects you no longer
 * have is worse than one that is a day out of date.
 *
 * Manual thumbnails referenced from catalog-overrides.json are never deleted,
 * whatever happens to the repository they belonged to.
 *
 * Deleting is only safe when the caller could actually see everything. A run
 * that cannot read private repositories has no evidence they are gone — it just
 * cannot see them — so `isAuthoritative: false` limits the sweep to files and
 * leaves the hand-written metadata alone. Getting this wrong once already cost
 * two entries in catalog-overrides.json.
 */
export function prune(repos, { dryRun = false, isAuthoritative = true } = {}) {
  const liveRepos = new Set(repos.map((r) => r.name));
  const livePages = new Set();
  for (const r of repos) {
    for (const entry of [...(r.versions || []), ...(r.pages || [])]) {
      livePages.add(`${r.name}/${entry.file}`);
    }
  }

  const removed = { repos: [], pages: 0, files: 0, overrides: [], refused: null };

  // A collapse in the repository count means the listing failed, not that you
  // deleted forty projects. Refuse rather than empty the cache.
  const cachedCount = Object.keys(readManifest()).length;
  if (cachedCount > 4 && repos.length < cachedCount * 0.6) {
    removed.refused = `saw ${repos.length} repositories but have ${cachedCount} cached — refusing to delete`;
    return removed;
  }

  // Files a human pointed at by hand are off limits.
  const overridesFile = readJson(OVERRIDES_FILE, null);
  const overrides = overridesFile?.projects ?? overridesFile ?? {};
  const protectedFiles = new Set(
    Object.values(overrides)
      .map((o) => o?.thumbnail)
      .filter((t) => t && !/^https?:\/\//i.test(t))
      .map((t) => path.basename(t)),
  );

  const unlink = (dir, file) => {
    if (!file || protectedFiles.has(path.basename(file))) return;
    const full = path.join(dir, file);
    if (!fs.existsSync(full)) return;
    if (!dryRun) fs.unlinkSync(full);
    removed.files += 1;
  };

  /* ---- project thumbnails ------------------------------------------------ */

  const manifest = readManifest();
  for (const [name, entry] of Object.entries(manifest)) {
    if (liveRepos.has(name)) continue;
    // Cannot see private repositories from here, so cannot claim they are gone.
    if (!isAuthoritative && String(entry.file || '').startsWith('private/')) continue;
    unlink(THUMB_DIR, entry.file);
    unlink(THUMB_DIR, entry.fileSm);
    delete manifest[name];
    removed.repos.push(name);
  }

  /* ---- version and page thumbnails --------------------------------------- */

  const pageManifest = readJson(PAGES_MANIFEST_FILE, {}) || {};
  for (const [id, entry] of Object.entries(pageManifest)) {
    if (livePages.has(id)) continue;
    if (!isAuthoritative && String(entry.file || '').startsWith('private/')) continue;
    unlink(PAGES_DIR, entry.file);
    delete pageManifest[id];
    removed.pages += 1;
  }

  /* ---- presentation metadata --------------------------------------------- */

  if (isAuthoritative) {
    for (const name of Object.keys(overrides)) {
      if (liveRepos.has(name)) continue;
      delete overrides[name];
      removed.overrides.push(name);
    }
  }

  if (!dryRun) {
    const privateNames = new Set(repos.filter((r) => r.private).map((r) => r.name));
    const pub = {};
    const priv = {};
    for (const [key, value] of Object.entries(manifest)) {
      (privateNames.has(key) ? priv : pub)[key] = value;
    }
    writeJson(MANIFEST_FILE, pub);
    if (Object.keys(priv).length || fs.existsSync(MANIFEST_PRIVATE_FILE)) {
      writeJson(MANIFEST_PRIVATE_FILE, priv);
    }
    writeJson(PAGES_MANIFEST_FILE, pageManifest);

    if (removed.overrides.length && overridesFile) {
      if (overridesFile.projects) overridesFile.projects = overrides;
      writeJson(OVERRIDES_FILE, overridesFile.projects ? overridesFile : overrides);
    }
  }

  return removed;
}

export function reportPrune(removed) {
  if (removed.refused) {
    log.warn(removed.refused);
    return;
  }
  const nothing =
    !removed.repos.length && !removed.pages && !removed.files && !removed.overrides.length;

  if (nothing) {
    log.dim('nothing to remove — every cached project still exists on GitHub');
    return;
  }
  if (removed.repos.length) {
    log.warn(`removed ${removed.repos.length} project(s) that no longer exist: ${removed.repos.join(', ')}`);
  }
  if (removed.overrides.length) {
    log.warn(`removed override entries: ${removed.overrides.join(', ')}`);
  }
  if (removed.pages) log.info(`removed ${removed.pages} stale version/page entries`);
  if (removed.files) log.info(`deleted ${removed.files} orphaned thumbnail files`);
}
