import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

export const ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
export const DATA_DIR = path.join(ROOT, 'data');
export const PUBLIC_DIR = path.join(ROOT, 'public');
export const THUMB_DIR = path.join(PUBLIC_DIR, 'thumbnails');

export const REPOS_FILE = path.join(DATA_DIR, 'repos.json');
// Private repositories are kept in a separate, git-ignored pair of locations so
// that committing this project to a public repository cannot leak their names,
// dates or screenshots.
export const REPOS_PRIVATE_FILE = path.join(DATA_DIR, 'repos.private.json');
export const OVERRIDES_FILE = path.join(DATA_DIR, 'catalog-overrides.json');
export const LOCAL_PATHS_FILE = path.join(DATA_DIR, 'local-paths.json');
export const THUMB_PRIVATE_DIR = path.join(THUMB_DIR, 'private');
export const MANIFEST_FILE = path.join(THUMB_DIR, 'manifest.json');
export const MANIFEST_PRIVATE_FILE = path.join(THUMB_PRIVATE_DIR, 'manifest.json');
export const PAGES_MANIFEST_FILE = path.join(THUMB_DIR, 'pages', 'manifest.json');

export function readJson(file, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

export function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n', 'utf8');
}

/** Loads .env into process.env without clobbering variables already set. */
export function loadEnv() {
  const file = path.join(ROOT, '.env');
  if (!fs.existsSync(file)) return;
  for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (/^(".*"|'.*')$/s.test(value)) value = value.slice(1, -1);
    if (!(key in process.env)) process.env[key] = value;
  }
}

/**
 * Every repository, public and private, newest first.
 *
 * Private repositories live in a separate git-ignored file so this project can
 * be committed to a public repository safely, but every local tool still wants
 * to see all of them.
 */
export function readAllRepos() {
  const pub = readJson(REPOS_FILE, null);
  if (!pub?.repos) return null;
  const priv = readJson(REPOS_PRIVATE_FILE, null);
  const repos = priv?.repos?.length ? [...pub.repos, ...priv.repos] : pub.repos;
  return {
    ...pub,
    count: repos.length,
    repos: repos.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt)),
  };
}

/** Thumbnail manifest, public entries plus the git-ignored private ones. */
export function readManifest() {
  return { ...(readJson(MANIFEST_FILE, {}) || {}), ...(readJson(MANIFEST_PRIVATE_FILE, {}) || {}) };
}

/** Splits a manifest back into its committed and git-ignored halves. */
export function writeManifest(manifest, isPrivate) {
  const pub = {};
  const priv = {};
  for (const [key, value] of Object.entries(manifest)) {
    (isPrivate(key) ? priv : pub)[key] = value;
  }
  writeJson(MANIFEST_FILE, pub);
  if (Object.keys(priv).length) writeJson(MANIFEST_PRIVATE_FILE, priv);
}

export const LOCAL_SOURCES_FILE = path.join(DATA_DIR, 'local-sources.json');
