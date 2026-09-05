/**
 * The merge:  GitHub facts  +  your overrides  +  thumbnail cache  ->  catalog.json
 *
 * This is the single place the shape of a "project" is defined. Both the Vite
 * dev server and the production build call buildCatalog(), so what you see at
 * localhost is exactly what ships.
 */
import { titleFromRepoName, subtitleFromRepoName, initialsFromTitle } from './titles.mjs';
import { guessCategory, DEFAULT_CATEGORIES } from './categories.mjs';
import {
  REPOS_FILE,
  REPOS_PRIVATE_FILE,
  OVERRIDES_FILE,
  LOCAL_PATHS_FILE,
  PAGES_MANIFEST_FILE,
  readJson,
  readManifest,
} from './paths.mjs';

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
  const privateFile = readJson(REPOS_PRIVATE_FILE, null);
  if (repoFile && privateFile?.repos?.length) {
    repoFile.repos = [...repoFile.repos, ...privateFile.repos].sort(
      (a, b) => new Date(b.updatedAt) - new Date(a.updatedAt),
    );
  }
  const { projects: overrides, categories } = readOverrides();
  const localPaths = readJson(LOCAL_PATHS_FILE, {}) || {};
  const manifest = readManifest();
  const pageShots = readJson(PAGES_MANIFEST_FILE, {}) || {};

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

  // CATALOG_PUBLIC_ONLY=1 keeps private repositories out of a catalog that is
  // going to be deployed. Their names, dates and thumbnails are private too,
  // and a public GitHub Pages build would otherwise publish all three.
  const publicOnly = process.env.CATALOG_PUBLIC_ONLY === '1';

  // A client build is the same catalog narrowed to one audience.
  const only = (process.env.CATALOG_ONLY || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const onlyCategory = process.env.CATALOG_CATEGORY || null;
  const mode = process.env.CATALOG_MODE === 'client' ? 'client' : 'full';

  const eligible = repoFile.repos
    .filter((repo) => !(publicOnly && repo.private))
    .filter((repo) => !only.length || only.includes(repo.name));

  // A container repository becomes one card in the main grid plus a portal page
  // of its own. Its subfolders never join the main grid — that is the point of
  // the split, and it is what keeps the gallery stable however much the
  // container grows.
  const portals = {};

  const projects = eligible
    .flatMap((repo) => {
      const o = overrides[repo.name] || {};

      if (!repo.subsites?.length) {
        return toProject(repo, o, localPaths[repo.name], manifest[repo.name], pageShots);
      }

      const children = repo.subsites.map((site) =>
        toSubsiteProject(repo, site, overrides, manifest, pageShots),
      );
      const card = toContainerCard(repo, o, children, manifest);
      if (card.hidden) return [];

      portals[card.portalSlug] = {
        slug: card.portalSlug,
        repo: repo.name,
        title: card.title,
        subtitle: card.subtitle,
        githubUrl: repo.htmlUrl,
        projects: children.filter((c) => !c.hidden).map((c) => (mode === 'client' ? forClient(c) : c)),
      };

      return card;
    })
    .filter((p) => !p.hidden)
    .filter((p) => !onlyCategory || p.category === onlyCategory)
    .map((p) => (mode === 'client' ? forClient(p) : p));

  // Only offer categories that something actually lives in.
  const used = new Set(projects.map((p) => p.category));
  const activeCategories = categories.filter((c) => used.has(c));

  return {
    generatedAt: new Date().toISOString(),
    syncedAt: repoFile.generatedAt,
    owner: mode === 'client' ? null : repoFile.owner,
    ownerName: mode === 'client' ? null : repoFile.ownerName,
    ownerUrl: mode === 'client' ? null : repoFile.ownerUrl,
    avatarUrl: mode === 'client' ? null : repoFile.avatarUrl,
    categories: activeCategories,
    mode,
    brand: mode === 'client'
      ? {
          title: process.env.CATALOG_TITLE || projects[0]?.title || 'Project preview',
          subtitle: process.env.CATALOG_SUBTITLE || 'Design preview',
        }
      : null,
    counts: {
      total: projects.length,
      withPreview: projects.filter((p) => p.previewUrl).length,
      withThumbnail: projects.filter((p) => p.thumb).length,
      pinned: projects.filter((p) => p.pinned).length,
      variants: projects.reduce((n, p) => n + p.variantCount, 0),
      containers: Object.keys(portals).length,
    },
    projects,
    portals,
  };
}

/**
 * Strips a project down to what a client is being shown.
 *
 * The UI hides these fields anyway, but hiding is not removing: anyone can open
 * the page source. A client build should not carry the repository name, the
 * clone URL or a path on someone's laptop in the first place.
 */
function forClient(p) {
  const { repo, githubUrl, cloneUrl, sshUrl, localPath, defaultBranch, sizeKb, stars, private: _p, ...rest } = p;
  return {
    ...rest,
    repo: null,
    search: [p.title, p.subtitle, p.description, p.category].filter(Boolean).join(' ').toLowerCase(),
  };
}

function toProject(repo, o, localPath, thumbEntry, pageShots) {
  const versions = decorate(repo.name, repo.versions || [], pageShots);
  const pages = decorate(repo.name, repo.pages || [], pageShots);

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
    versions,
    pages,
    variantCount: versions.length + pages.length,

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

/** Attaches the captured screenshot to each version, where one exists. */
function decorate(repoName, entries, pageShots) {
  return entries.map((entry) => {
    const shot = pageShots[`${repoName}/${entry.file}`];
    return {
      file: entry.file,
      label: entry.label,
      url: entry.url,
      variant: entry.variant,
      thumb: shot?.file && !shot.error ? `thumbnails/pages/${shot.file}` : null,
    };
  });
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

/**
 * One subfolder of a container repository, presented as an ordinary project.
 *
 * It is overridable exactly like a repository is, under the key
 * "repo/folder" — so a folder can be retitled, pinned or hidden by hand
 * without the container needing to know anything about it.
 */
function toSubsiteProject(repo, site, overrides, manifest, pageShots) {
  const id = `${repo.name}/${site.dir}`;
  const o = overrides[id] || {};

  const title = o.title || titleFromRepoName(site.dir);
  const subtitle = o.subtitle ?? subtitleFromRepoName(site.dir);
  const versions = promoteMain(decorate(id, site.versions || [], pageShots), o.mainFile);
  const pages = decorate(id, site.pages || [], pageShots);
  const tags = dedupe([...(o.tags || []), repo.language]);

  // Some folders use index.html as a contact sheet listing the real builds. The
  // card should open the work, not its table of contents.
  const mainUrl = mainFileUrl(site.url, o.mainFile) || site.url;

  return {
    id,
    repo: repo.name,
    folder: site.dir,
    parentRepo: repo.name,
    title,
    subtitle: subtitle || null,
    initials: initialsFromTitle(title, site.dir),
    description: o.description ?? null,
    category: o.category || '3D / Experimental',
    tags,
    status: STATUSES.has(o.status) ? o.status : null,
    pinned: Boolean(o.pinned),
    hidden: Boolean(o.hidden),

    thumb: resolveThumb(o.thumbnail, manifest[id]),
    versions,
    pages,
    variantCount: versions.length + pages.length,

    previewUrl: o.previewUrl ?? mainUrl,
    previewSource: o.previewUrl ? 'override' : 'subfolder',
    githubUrl: `${repo.htmlUrl}/tree/${repo.defaultBranch}/${site.dir.split('/').map(encodeURIComponent).join('/')}`,
    cloneUrl: repo.cloneUrl,
    sshUrl: repo.sshUrl,
    localPath: o.localPath ?? null,

    defaultBranch: repo.defaultBranch,
    language: repo.language,
    sizeKb: 0,
    stars: 0,
    private: repo.private,
    archived: repo.archived,
    createdAt: repo.createdAt,
    updatedAt: repo.updatedAt,
    pushedAt: repo.pushedAt,

    search: [title, subtitle, site.dir, repo.name, ...tags].filter(Boolean).join(' ').toLowerCase(),
  };
}

/**
 * The single card a container repository shows in the main grid.
 *
 * It borrows the newest child's screenshot, because a shelf has no picture of
 * its own and an empty placeholder would say less about what is inside than
 * any one of the things inside it.
 */
function toContainerCard(repo, o, children, manifest) {
  const title = o.title || titleFromRepoName(repo.name);
  const subtitle = o.subtitle ?? `${children.length} projects`;
  const withThumb = children.find((c) => c.thumb);

  return {
    id: repo.name,
    repo: repo.name,
    title,
    subtitle,
    initials: initialsFromTitle(title, repo.name),
    description: o.description ?? repo.description,
    category: o.category || guessCategory(repo),
    tags: dedupe([...(o.tags || []), ...(repo.topics || []), repo.language]),
    status: STATUSES.has(o.status) ? o.status : null,
    pinned: Boolean(o.pinned),
    hidden: Boolean(o.hidden),

    thumb: resolveThumb(o.thumbnail, manifest[repo.name]) || withThumb?.thumb || null,

    // A container opens its own page instead of a live site: its root is a
    // shelf, and on GitHub Pages a shelf is a 404.
    isContainer: true,
    portalSlug: slugify(repo.name),
    childCount: children.length,
    childTitles: children.slice(0, 4).map((c) => c.title),

    versions: [],
    pages: [],
    variantCount: children.reduce((n, c) => n + c.variantCount, 0),

    previewUrl: null,
    previewSource: null,
    githubUrl: repo.htmlUrl,
    cloneUrl: repo.cloneUrl,
    sshUrl: repo.sshUrl,
    localPath: o.localPath ?? null,

    defaultBranch: repo.defaultBranch,
    language: repo.language,
    sizeKb: repo.sizeKb,
    stars: repo.stars,
    private: repo.private,
    archived: repo.archived,
    createdAt: repo.createdAt,
    updatedAt: repo.updatedAt,
    pushedAt: repo.pushedAt,

    search: [title, subtitle, repo.name, ...children.map((c) => c.title)]
      .filter(Boolean)
      .join(' ')
      .toLowerCase(),
  };
}

function slugify(name) {
  return (
    String(name)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'portal'
  );
}

/**
 * The URL of a hand-named main file inside a site folder.
 *
 * Several of these folders keep a generated contact sheet at index.html and the
 * actual build at index1.html. Without this the card screenshots the list of
 * links instead of the work, which is how a project can be present in the
 * catalog and still look like it has gone missing.
 */
function mainFileUrl(baseUrl, mainFile) {
  if (!mainFile || !baseUrl) return null;
  const base = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  return `${base}${encodeURIComponent(mainFile)}`;
}

/** Moves the declared main file to the front and relabels it. */
function promoteMain(versions, mainFile) {
  if (!mainFile) return versions;
  const i = versions.findIndex((v) => v.file.toLowerCase() === String(mainFile).toLowerCase());
  if (i === -1) return versions;

  const main = { ...versions[i], label: 'Main' };
  const rest = versions.filter((_, n) => n !== i).map((v) => (v.label === 'Main' ? { ...v, label: 'Index page' } : v));
  return [main, ...rest];
}
