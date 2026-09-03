/**
 * The merge:  GitHub facts  +  your overrides  +  thumbnail cache  ->  catalog.json
 *
 * This is the single place the shape of a "project" is defined. Both the Vite
 * dev server and the production build call buildCatalog(), so what you see at
 * localhost is exactly what ships.
 */
import { titleFromRepoName, subtitleFromRepoName, initialsFromTitle } from './titles.mjs';
import { guessCategory, DEFAULT_CATEGORIES } from './categories.mjs';
import { REPOS_FILE, OVERRIDES_FILE, LOCAL_PATHS_FILE, MANIFEST_FILE, readJson } from './paths.mjs';

const STATUSES = new Set(['active', 'concept', 'development', 'complete', 'archived']);

/** Supports both the structured file and the flat { "repo": {...} } shape. */
function readOverrides() {
  const file = readJson(OVERRIDES_FILE, {}) || {};
  if (file.projects && typeof file.projects === 'object') {
    return { projects: file.projects, categories: file.categories || DEFAULT_CATEGORIES };
  }
  const { _readme, categories, ...flat } = file;
  return { projects: flat, categories: categories || DEFAULT_CATEGORIES };
}

export function buildCatalog() {
  const repoFile = readJson(REPOS_FILE, null);
  const { projects: overrides, categories } = readOverrides();
  const localPaths = readJson(LOCAL_PATHS_FILE, {}) || {};
  const manifest = readJson(MANIFEST_FILE, {}) || {};

  if (!repoFile?.repos?.length) {
    return {
      generatedAt: new Date().toISOString(),
      syncedAt: null,
      owner: null,
      categories,
      projects: [],
      empty: true,
    };
  }

  const projects = repoFile.repos
    .map((repo) => toProject(repo, overrides[repo.name] || {}, localPaths[repo.name], manifest[repo.name]))
    .filter((p) => !p.hidden);

  // Only offer categories that something actually lives in.
  const used = new Set(projects.map((p) => p.category));
  const activeCategories = categories.filter((c) => used.has(c));

  return {
    generatedAt: new Date().toISOString(),
    syncedAt: repoFile.generatedAt,
    owner: repoFile.owner,
    ownerName: repoFile.ownerName,
    ownerUrl: repoFile.ownerUrl,
    avatarUrl: repoFile.avatarUrl,
    categories: activeCategories,
    counts: {
      total: projects.length,
      withPreview: projects.filter((p) => p.previewUrl).length,
      withThumbnail: projects.filter((p) => p.thumb).length,
      pinned: projects.filter((p) => p.pinned).length,
    },
    projects,
  };
}

function toProject(repo, o, localPath, thumbEntry) {
  const title = o.title || titleFromRepoName(repo.name);
  const subtitle = o.subtitle ?? subtitleFromRepoName(repo.name);

  const previewUrl = o.previewUrl ?? repo.previewUrl;
  const previewSource = o.previewUrl ? 'override' : repo.previewSource;

  const category = o.category || guessCategory(repo);
  const status = STATUSES.has(o.status) ? o.status : repo.archived ? 'archived' : null;

  const tags = dedupe([
    ...(o.tags || []),
    ...(repo.topics || []),
    repo.language,
  ]);

  return {
    id: repo.name,
    repo: repo.name,
    title,
    subtitle: subtitle || null,
    initials: initialsFromTitle(title, repo.name),
    description: o.description ?? repo.description,
    category,
    tags,
    status,
    pinned: Boolean(o.pinned),
    hidden: Boolean(o.hidden),

    thumb: resolveThumb(o.thumbnail, thumbEntry),

    previewUrl,
    previewSource,
    githubUrl: repo.htmlUrl,
    cloneUrl: repo.cloneUrl,
    sshUrl: repo.sshUrl,
    localPath: o.localPath ?? localPath ?? null,

    defaultBranch: repo.defaultBranch,
    language: repo.language,
    sizeKb: repo.sizeKb,
    stars: repo.stars,
    private: repo.private,
    archived: repo.archived,
    createdAt: repo.createdAt,
    updatedAt: repo.updatedAt,
    pushedAt: repo.pushedAt,

    // Lowercased haystack so search never has to build one at keystroke time.
    search: [title, subtitle, repo.name, repo.description, category, ...tags]
      .filter(Boolean)
      .join(' ')
      .toLowerCase(),
  };
}

/**
 * Thumbnail hierarchy, resolved at merge time so the browser never guesses:
 *   1. a manual `thumbnail` in catalog-overrides.json
 *   2/3/4/5. whatever the capture pipeline last wrote to the cache
 *   6. null -> the UI draws a generated placeholder. Never a broken image.
 */
function resolveThumb(manual, entry) {
  if (manual) {
    const src = /^https?:\/\//i.test(manual) ? manual : manual.replace(/^\/+/, '');
    return { sm: src, lg: src, source: 'override' };
  }
  if (entry?.file) {
    return {
      sm: `thumbnails/${entry.fileSm || entry.file}`,
      lg: `thumbnails/${entry.file}`,
      source: entry.source,
      capturedAt: entry.capturedAt || null,
    };
  }
  return null;
}

function dedupe(list) {
  const seen = new Set();
  const out = [];
  for (const item of list) {
    if (!item) continue;
    const key = String(item).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(String(item));
  }
  return out;
}
