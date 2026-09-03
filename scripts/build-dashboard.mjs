#!/usr/bin/env node
/**
 * Builds the openable dashboard.
 *
 * `vite build` alone produces a folder that needs a web server, because the app
 * fetches catalog.json and file:// blocks fetch. This step inlines that JSON
 * into the page as a script tag, so the result works three ways with no
 * difference in behaviour:
 *
 *   double-click dashboard/index.html   — straight off disk, no server
 *   any static host                     — GitHub Pages, Netlify, a USB stick
 *   npm run preview                     — locally served
 *
 * Images are plain relative paths, which file:// is perfectly happy with; it is
 * only fetch() that it refuses.
 *
 *   node scripts/build-dashboard.mjs [--out dashboard]
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { ROOT, readJson } from './lib/paths.mjs';
import { isMain } from './lib/is-main.mjs';
import { log } from './lib/log.mjs';

const args = process.argv.slice(2);
const val = (n, d) => {
  const i = args.indexOf(`--${n}`);
  return i !== -1 && args[i + 1] ? args[i + 1] : d;
};

const DIST = path.join(ROOT, 'dist');

const slugify = (t) =>
  String(t).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "preview";

function dirSize(dir) {
  let total = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    total += entry.isDirectory() ? dirSize(full) : fs.statSync(full).size;
  }
  return total;
}

export function buildDashboard({
  out = val('out', null),
  publicOnly = process.env.CATALOG_PUBLIC_ONLY === '1',
  only = (val('only', '') || '').split(',').map((s) => s.trim()).filter(Boolean),
  category = val('category', null),
  client = args.includes('--client'),
  title = val('title', null),
  subtitle = val('subtitle', null),
} = {}) {
  // A client build lands in its own folder so several can coexist.
  const folder =
    out || (client ? `share/${slugify(title || only[0] || category || 'preview')}` : 'dashboard');
  const target = path.isAbsolute(folder) ? folder : path.join(ROOT, folder);

  log.step(`Building the dashboard${publicOnly ? ' (public repositories only)' : ''}`);

  // The filter and the presentation ride in on the environment, because the
  // catalog is assembled inside the vite build, not out here.
  const env = { ...process.env };
  if (only.length) env.CATALOG_ONLY = only.join(',');
  if (category) env.CATALOG_CATEGORY = category;
  if (client) {
    env.CATALOG_MODE = 'client';
    if (title) env.CATALOG_TITLE = title;
    if (subtitle) env.CATALOG_SUBTITLE = subtitle;
    log.dim('client mode — repository names, clone URLs and GitHub links are left out');
  }

  execFileSync('npx', ['vite', 'build'], { cwd: ROOT, stdio: 'pipe', shell: true, env });

  const catalog = readJson(path.join(DIST, 'catalog.json'), null);
  if (!catalog?.projects?.length) throw new Error('The build produced an empty catalog.');

  const indexPath = path.join(DIST, 'index.html');
  let html = fs.readFileSync(indexPath, 'utf8');

  // file:// treats every file as its own opaque origin, so a linked stylesheet
  // or module script is refused by CORS before it is even parsed. Inlining both
  // sidesteps that entirely: an inline script fetches nothing. Images are
  // exempt from the same rule, so thumbnails stay as ordinary relative files.
  const inlined = [];

  html = html.replace(
    /<link[^>]+rel="stylesheet"[^>]+href="\.\/(assets\/[^"]+)"[^>]*>/g,
    (_, href) => {
      inlined.push(href);
      return `<style>\n${fs.readFileSync(path.join(DIST, href), 'utf8')}\n</style>`;
    },
  );

  html = html.replace(
    /<script[^>]*type="module"[^>]*src="\.\/(assets\/[^"]+)"[^>]*><\/script>/g,
    (_, src) => {
      inlined.push(src);
      return `<script type="module">\n${fs.readFileSync(path.join(DIST, src), 'utf8')}\n</script>`;
    },
  );

  // </script> inside JSON would close the tag early; escaping the slash is the
  // standard fix and stays valid JSON.
  const payload = JSON.stringify(catalog).replace(/<\//g, '<\\/');
  const tag = `<script id="catalog-data" type="application/json">${payload}</script>`;

  if (html.includes('id="catalog-data"')) {
    html = html.replace(/<script id="catalog-data"[\s\S]*?<\/script>/, tag);
  } else {
    html = html.replace('</body>', `${tag}\n</body>`);
  }

  // The profile link is static markup, so hiding it in CSS would still leave
  // the href sitting in the file a client can read.
  if (client) {
    html = html
      .replace(/<a class="icon-btn" data-github-profile[\s\S]*?<\/a>/, '')
      .replace(/<meta name="description"[^>]*>/, '');
  }

  fs.writeFileSync(indexPath, html, 'utf8');
  log.dim(`inlined ${inlined.length} asset(s) — the page loads nothing but images`);

  fs.rmSync(target, { recursive: true, force: true });
  fs.cpSync(DIST, target, { recursive: true });

  // The bundles now live inside index.html; shipping them twice is only weight.
  for (const asset of inlined) fs.rmSync(path.join(target, asset), { force: true });
  const assetsDir = path.join(target, 'assets');
  if (fs.existsSync(assetsDir) && !fs.readdirSync(assetsDir).length) fs.rmdirSync(assetsDir);

  // Vite copies the whole of public/, private thumbnails included. A public
  // build must not carry them, whatever the catalog JSON says.
  if (publicOnly || client) {
    for (const dir of ['thumbnails/private', 'thumbnails/pages/private']) {
      fs.rmSync(path.join(target, dir), { recursive: true, force: true });
    }
    log.dim('private thumbnails excluded from this build');
  }

  // vite copies every thumbnail in public/, which for a one-client build is
  // 44 other people's work sitting in a folder you are about to email.
  const referenced = new Set();
  for (const p of catalog.projects) {
    for (const src of [p.thumb?.sm, p.thumb?.lg]) if (src) referenced.add(src);
    for (const v of [...(p.versions || []), ...(p.pages || [])]) {
      if (v.thumb) referenced.add(v.thumb);
    }
  }

  let dropped = 0;
  const sweep = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        sweep(full);
        if (!fs.readdirSync(full).length) fs.rmdirSync(full);
        continue;
      }
      if (!/\.(webp|png|jpe?g|avif)$/i.test(entry.name)) continue;
      const rel = path.relative(target, full).split(path.sep).join('/');
      if (referenced.has(rel)) continue;
      fs.rmSync(full);
      dropped += 1;
    }
  };

  // The capture manifests list every repository in the catalog; they are build
  // cache, never read by the page.
  for (const stale of ['thumbnails/manifest.json', 'thumbnails/pages/manifest.json']) {
    fs.rmSync(path.join(target, stale), { force: true });
  }
  if (client) fs.rmSync(path.join(target, 'catalog.json'), { force: true });

  const thumbsDir = path.join(target, 'thumbnails');
  if (fs.existsSync(thumbsDir)) sweep(thumbsDir);
  if (dropped) log.dim(`dropped ${dropped} thumbnail(s) this build does not reference`);

  const size = dirSize(target);
  log.ok(`${path.relative(ROOT, target)}/ — ${catalog.projects.length} projects, ${(size / 1048576).toFixed(1)} MB`);
  log.dim(`open ${path.join(target, 'index.html')}`);

  return { target, catalog };
}

if (isMain(import.meta.url)) {
  try {
    buildDashboard();
  } catch (err) {
    log.err(err.message);
    process.exit(1);
  }
}
