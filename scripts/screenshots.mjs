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
import { THUMB_DIR, MANIFEST_FILE, REPOS_FILE, OVERRIDES_FILE, loadEnv, readJson, writeJson } from './lib/paths.mjs';
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

/** Decide where this project's picture should come from. */
function chooseSource(repo, override) {
  if (override?.thumbnail) return { kind: 'override' };

  if (repo.repoImage && repo.repoImageKind === 'explicit') {
    return { kind: 'repo-image', ref: repo.repoImage };
  }

  const url = override?.previewUrl || repo.previewUrl;
  if (url && repo.previewSource !== 'pages-errored') {
    return { kind: 'screenshot', ref: url };
  }
  if (repo.repoImage) {
    return { kind: 'repo-image', ref: repo.repoImage };
  }
  if (url) {
    // Pages exists but its last build errored. Still worth one attempt.
    return { kind: 'screenshot', ref: url };
  }
  if (flag('opengraph')) {
    return { kind: 'opengraph', ref: `https://opengraph.githubassets.com/1/${repo.fullName}` };
  }
  return { kind: 'none' };
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
  const repoFile = readJson(REPOS_FILE, null);
  if (!repoFile?.repos?.length) {
    throw new Error('data/repos.json is missing or empty. Run `npm run sync` first.');
  }

  const overrides = readOverrides();
  const manifest = readJson(MANIFEST_FILE, {}) || {};
  fs.mkdirSync(THUMB_DIR, { recursive: true });

  const wanted = only ? new Set(only.split(',').map((s) => s.trim())) : null;
  let repos = repoFile.repos.filter((r) => !overrides[r.name]?.hidden);
  if (wanted) repos = repos.filter((r) => wanted.has(r.name));

  // Work out what actually needs doing before opening a browser.
  const jobs = [];
  const stats = { skipped: 0, none: 0 };

  for (const repo of repos) {
    const source = chooseSource(repo, overrides[repo.name]);

    if (source.kind === 'override' || source.kind === 'none') {
      stats[source.kind === 'override' ? 'skipped' : 'none'] += 1;
      continue;
    }

    const key = hash(`${source.kind}|${source.ref}|${repo.pushedAt}`);
    const prev = manifest[repo.name];
    const filesExist = Boolean(prev?.file) && fs.existsSync(path.join(THUMB_DIR, prev.file));
    const stale =
      maxAgeDays && prev?.capturedAt
        ? Date.now() - Date.parse(prev.capturedAt) > maxAgeDays * 86400000
        : false;

    if (!force && filesExist && prev.sourceKey === key && !stale) {
      stats.skipped += 1;
      continue;
    }

    jobs.push({ repo, source, key, prev });
  }

  log.step('Thumbnails');
  log.dim(
    `${jobs.length} to capture · ${stats.skipped} already current · ` +
      `${stats.none} with no image source (placeholder)`,
  );

  if (limit) jobs.splice(limit);
  if (!jobs.length) {
    writeJson(MANIFEST_FILE, manifest);
    return manifest;
  }

  const { token } = resolveToken();
  const gh = new GitHub(token);
  const needsBrowser = jobs.some((j) => j.source.kind === 'screenshot');

  const run = async (browser) => {
    let done = 0;
    await mapLimit(jobs, concurrency, async ({ repo, source, key, prev }) => {
      const label = repo.name.padEnd(34);
      try {
        const input = await fetchSource(source, repo, gh, browser);
        const written = await writeThumbnails(input, THUMB_DIR, slug(repo.name), {
          position: source.kind === 'screenshot' ? 'top' : 'attention',
        });

        manifest[repo.name] = {
          source: source.kind,
          ref: source.ref,
          sourceKey: key,
          capturedAt: new Date().toISOString(),
          pushedAt: repo.pushedAt,
          ...written,
          error: null,
        };
        done += 1;
        log.ok(`${label} ${source.kind.padEnd(11)} ${(written.bytes / 1024).toFixed(0)} KB`);
      } catch (err) {
        const message = String(err?.message || err).split('\n')[0].slice(0, 120);
        manifest[repo.name] = {
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

  writeJson(MANIFEST_FILE, manifest);
  const failed = jobs.length - done;
  log.ok(`${done} captured${failed ? `, ${failed} failed` : ''} → public/thumbnails/`);
  return manifest;
}

async function fetchSource(source, repo, gh, browser) {
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
