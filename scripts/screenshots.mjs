#!/usr/bin/env node
/**
 * Thumbnail capture.
 *
 * Resolves one image per project by walking the source hierarchy, then writes
 * two optimised WebP files into public/thumbnails/ and records what it did in
 * public/thumbnails/manifest.json.
 *
 * Source hierarchy (highest wins):
 *   1. `thumbnail` in catalog-overrides.json ....... skipped here, used as-is
 *   2. an explicit preview image committed at the repo root
 *   3. a live screenshot of the preview URL
 *   4. GitHub's open-graph card ..................... opt-in, --opengraph
 *   5. a representative image found inside the repo
 *   6. nothing -> the UI draws a generated placeholder
 *
 * Nothing is recaptured unless the repository has been pushed to since last
 * time. A capture that fails leaves the previous thumbnail in place.
 *
 *   node scripts/screenshots.mjs
 *   node scripts/screenshots.mjs --force
 *   node scripts/screenshots.mjs --only Midwest-cobras,KERBECK
 *   node scripts/screenshots.mjs --max-age 30 --concurrency 4 --opengraph
 */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { GitHub, resolveToken } from './lib/github.mjs';
import { withBrowser, capture } from './lib/capture.mjs';
import { writeThumbnails, slug } from './lib/image.mjs';
import { mapLimit } from './lib/concurrency.mjs';
import { captureTargets } from './lib/pages.mjs';
import { serveFolder } from './lib/serve.mjs';
import {
  THUMB_DIR,
  THUMB_PRIVATE_DIR,
  OVERRIDES_FILE,
  LOCAL_SOURCES_FILE,
  loadEnv,
  readJson,
  readAllRepos,
  readManifest,
  writeManifest,
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

const hash = (s) => createHash('sha1').update(String(s)).digest('hex').slice(0, 12);

/** Private repositories keep their imagery in a git-ignored subfolder. */
const dirFor = (repo) => (repo.private ? THUMB_PRIVATE_DIR : THUMB_DIR);
const prefixFor = (repo) => (repo.private ? 'private/' : '');

/**
 * Decide where this project's picture should come from.
 *
 * The live site outranks anything committed to the repository. A screenshot is
 * what the project looks like today; a checked-in preview.png is what it looked
 * like whenever somebody last remembered to update it. Pass --prefer-repo-image
 * to invert that.
 */
function chooseSource(repo, override) {
  if (override?.thumbnail) return { kind: 'override' };

  const url = override?.previewUrl || repo.previewUrl;
  const live = url ? { kind: 'screenshot', ref: url } : null;
  const committed = repo.repoImage ? { kind: 'repo-image', ref: repo.repoImage } : null;

  const explicitFirst = flag('prefer-repo-image') && repo.repoImageKind === 'explicit';
  if (explicitFirst && committed) return committed;

  if (live) return live;
  if (committed) return committed;

  if (flag('opengraph')) {
    return { kind: 'opengraph', ref: `https://opengraph.githubassets.com/1/${repo.fullName}` };
  }
  return { kind: 'none' };
}

/**
 * Folders on this machine to capture instead of the web. Git-ignored, because
 * the paths exist only here and the work often is not published yet.
 */
function readLocalSources() {
  const file = readJson(LOCAL_SOURCES_FILE, {}) || {};
  return file.sources || {};
}

/**
 * A local folder has no pushedAt to key the cache on, so use the newest file in
 * it. Editing the page recaptures it; running the update twice does not.
 */
function folderStamp(dir) {
  let newest = 0;
  const walk = (d, depth) => {
    if (depth > 3) return;
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) walk(full, depth + 1);
      else newest = Math.max(newest, fs.statSync(full).mtimeMs);
    }
  };
  try {
    walk(dir, 0);
  } catch {
    /* unreadable folder — fall through to 0 and capture every run */
  }
  return Math.round(newest);
}

function readOverrides() {
  const file = readJson(OVERRIDES_FILE, {}) || {};
  if (file.projects) return file.projects;
  const { _readme, categories, ...flat } = file;
  return flat;
}

export async function captureThumbnails({
  force = flag('force'),
  only = val('only', null),
  limit = Number(val('limit', 0)) || null,
  concurrency = Number(val('concurrency', 3)),
  maxAgeDays = Number(val('max-age', 0)) || null,
} = {}) {
  const repoFile = readAllRepos();
  if (!repoFile?.repos?.length) {
    throw new Error('data/repos.json is missing or empty. Run `npm run sync` first.');
  }

  const overrides = readOverrides();
  const localSources = readLocalSources();
  const manifest = readManifest();
  fs.mkdirSync(THUMB_DIR, { recursive: true });

  const privateNames = new Set(repoFile.repos.filter((r) => r.private).map((r) => r.name));
  const isPrivate = (id) => privateNames.has(String(id).split('/')[0]);

  const wanted = only ? new Set(only.split(',').map((s) => s.trim())) : null;
  let repos = repoFile.repos.filter((r) => !overrides[r.name]?.hidden);
  if (wanted) repos = repos.filter((r) => wanted.has(r.name));

  // Work out what actually needs doing before opening a browser.
  const jobs = [];
  const stats = { skipped: 0, none: 0 };

  // A container repository contributes one target per subfolder and none for
  // itself; everything else contributes exactly one, as before.
  const targets = repos.flatMap((repo) => captureTargets(repo));

  for (const target of targets) {
    const { repo } = target;
    const localFolder = localSources[target.id];

    // A local folder outranks everything: it is named by hand, one entry at a
    // time, and the only reason to name one is that the deployed copy is absent
    // or wrong.
    const o = overrides[target.id] || {};

    // index.html is sometimes a generated contact sheet and the real build sits
    // elsewhere — index1.html, or site/index.html once a Vite app has to be
    // built to run at all. Encoded per segment: encoding the whole string turns
    // "site/index.html" into "site%2Findex.html", which is a different URL.
    const main = o.mainFile
      ? `${target.url}${String(o.mainFile).split('/').map(encodeURIComponent).join('/')}`
      : target.url;

    const source = localFolder
      ? { kind: 'local', ref: localFolder, page: o.mainFile || null }
      : target.isSubsite
        ? { kind: 'screenshot', ref: main }
        : chooseSource(repo, overrides[repo.name]);

    if (source.kind === 'override' || source.kind === 'none') {
      stats[source.kind === 'override' ? 'skipped' : 'none'] += 1;
      continue;
    }

    const stamp = source.kind === 'local' ? folderStamp(source.ref) : repo.pushedAt;
    const key = hash(`${source.kind}|${source.ref}|${stamp}`);
    const prev = manifest[target.id];
    const filesExist = Boolean(prev?.file) && fs.existsSync(path.join(THUMB_DIR, prev.file));
    const stale =
      maxAgeDays && prev?.capturedAt
        ? Date.now() - Date.parse(prev.capturedAt) > maxAgeDays * 86400000
        : false;

    if (!force && filesExist && prev.sourceKey === key && !stale) {
      stats.skipped += 1;
      continue;
    }

    jobs.push({ repo, target, source, key, prev });
  }

  log.step('Thumbnails');
  log.dim(
    `${jobs.length} to capture · ${stats.skipped} already current · ` +
      `${stats.none} with no image source (placeholder)`,
  );

  if (limit) jobs.splice(limit);
  if (!jobs.length) {
    writeManifest(manifest, isPrivate);
    return manifest;
  }

  const { token } = resolveToken();
  const gh = new GitHub(token);
  const needsBrowser = jobs.some((j) => j.source.kind === 'screenshot' || j.source.kind === 'local');

  const run = async (browser) => {
    let done = 0;
    await mapLimit(jobs, concurrency, async ({ repo, target, source, key, prev }) => {
      const label = target.id.slice(-34).padEnd(34);
      try {
        const input = await fetchSource(source, repo, gh, browser);
        const written = await writeThumbnails(input, dirFor(repo), slug(target.id), {
          position: source.kind === 'screenshot' ? 'top' : 'attention',
        });

        manifest[target.id] = {
          source: source.kind,
          ref: source.ref,
          sourceKey: key,
          capturedAt: new Date().toISOString(),
          pushedAt: repo.pushedAt,
          ...written,
          file: `${prefixFor(repo)}${written.file}`,
          fileSm: `${prefixFor(repo)}${written.fileSm}`,
          error: null,
        };
        done += 1;
        log.ok(`${label} ${source.kind.padEnd(11)} ${(written.bytes / 1024).toFixed(0)} KB`);
      } catch (err) {
        const message = String(err?.message || err).split('\n')[0].slice(0, 120);
        manifest[target.id] = {
          ...(prev || {}),
          source: prev?.source ?? source.kind,
          error: message,
          errorAt: new Date().toISOString(),
        };
        if (prev?.file) log.warn(`${label} ${message} — kept previous thumbnail`);
        else log.err(`${label} ${message}`);
      }
    });
    return done;
  };

  const done = needsBrowser ? await withBrowser(run) : await run(null);

  writeManifest(manifest, isPrivate);
  const failed = jobs.length - done;
  log.ok(`${done} captured${failed ? `, ${failed} failed` : ''} → public/thumbnails/`);
  return manifest;
}

async function fetchSource(source, repo, gh, browser) {
  // Served over http rather than opened from file://, because a module script
  // on file:// is refused as cross-origin before it is even parsed — which is
  // the whole reason these pages cannot be captured off disk directly.
  if (source.kind === 'local') {
    const server = await serveFolder(source.ref);
    try {
      const url = source.page ? `${server.url}${encodeURIComponent(source.page)}` : server.url;
      const { buffer } = await capture(browser, url);
      return buffer;
    } finally {
      await server.close();
    }
  }

  if (source.kind === 'screenshot') {
    const { buffer } = await capture(browser, source.ref);
    return buffer;
  }

  if (source.kind === 'repo-image') {
    // Contents API rather than raw.githubusercontent, so private repos work too.
    const encoded = source.ref.split('/').map(encodeURIComponent).join('/');
    const res = await gh.request(
      `/repos/${repo.fullName}/contents/${encoded}?ref=${encodeURIComponent(repo.defaultBranch)}`,
    );
    if (!res.ok) throw new Error(`could not read ${source.ref} (HTTP ${res.status})`);
    if (res.data?.content && res.data.encoding === 'base64') {
      return Buffer.from(res.data.content, 'base64');
    }
    if (res.data?.download_url) {
      const dl = await fetch(res.data.download_url);
      if (!dl.ok) throw new Error(`download failed (HTTP ${dl.status})`);
      return Buffer.from(await dl.arrayBuffer());
    }
    throw new Error(`no downloadable content at ${source.ref}`);
  }

  const res = await fetch(source.ref);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

if (isMain(import.meta.url)) {
  captureThumbnails().catch((err) => {
    log.err(err.message);
    process.exit(1);
  });
}
