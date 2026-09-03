#!/usr/bin/env node
/**
 * Finds local clones of your repositories so the catalog can offer
 * "Open in VS Code".
 *
 * It never guesses a path from a repository name — folder names on disk rarely
 * match ("CHICAGO MOTOR CARS" is AAN_PPREVIEW_CHICAGOMOTORCARS). Instead it
 * reads each folder's `.git/config` and matches the actual `origin` remote, so
 * a recorded path is always a real clone of that exact repository.
 *
 *   node scripts/scan-local.mjs [--root "C:\path"] [--depth 2]
 */
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, LOCAL_PATHS_FILE, loadEnv, readJson, writeJson, readAllRepos } from './lib/paths.mjs';
import { isMain } from './lib/is-main.mjs';
import { log } from './lib/log.mjs';

loadEnv();

const args = process.argv.slice(2);
const argValue = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i !== -1 && args[i + 1] ? args[i + 1] : fallback;
};

const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', '.git', 'vendor', '.next', '.cache']);

function defaultRoots() {
  const fromEnv = (process.env.CATALOG_LOCAL_ROOTS || '')
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean);
  if (fromEnv.length) return fromEnv;
  return [path.dirname(ROOT)];
}

/** owner/name out of any of the URL shapes git accepts. */
function parseRemote(url) {
  const m = /github\.com[:/]+([^/]+)\/([^/\s]+?)(?:\.git)?\/?$/i.exec(url);
  return m ? { owner: m[1], name: m[2] } : null;
}

function originOf(dir) {
  const config = path.join(dir, '.git', 'config');
  if (!fs.existsSync(config)) return null;
  const text = fs.readFileSync(config, 'utf8');
  const section = /\[remote "origin"\]([\s\S]*?)(?=\n\[|$)/.exec(text);
  if (!section) return null;
  const url = /^\s*url\s*=\s*(.+)$/m.exec(section[1]);
  return url ? parseRemote(url[1].trim()) : null;
}

function walk(dir, depth, found) {
  if (depth < 0) return;
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }

  const origin = originOf(dir);
  if (origin) {
    found.push({ dir, origin });
    return; // a repository root — do not descend into it
  }

  for (const entry of entries) {
    if (!entry.isDirectory() || SKIP_DIRS.has(entry.name)) continue;
    walk(path.join(dir, entry.name), depth - 1, found);
  }
}

export function scanLocal({ roots = defaultRoots(), depth = Number(argValue('depth', 2)) } = {}) {
  const known = readAllRepos();
  const byName = new Map((known?.repos || []).map((r) => [r.name.toLowerCase(), r.name]));

  log.step('Scanning for local clones');
  const found = [];
  for (const root of roots) {
    if (!fs.existsSync(root)) {
      log.warn(`${root} — not found, skipped`);
      continue;
    }
    log.dim(root);
    walk(root, depth, found);
  }

  const map = {};
  let matched = 0;
  for (const { dir, origin } of found) {
    const canonical = byName.get(origin.name.toLowerCase());
    if (!canonical) continue; // a clone of something not in this catalog
    if (map[canonical]) continue; // first match wins
    map[canonical] = dir;
    matched += 1;
  }

  writeJson(LOCAL_PATHS_FILE, map);
  log.ok(`${found.length} git repositories on disk · ${matched} matched to the catalog`);
  return map;
}

if (isMain(import.meta.url)) {
  const rootArg = argValue('root', null);
  scanLocal(rootArg ? { roots: [rootArg] } : {});
}
