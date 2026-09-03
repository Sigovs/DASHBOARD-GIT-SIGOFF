#!/usr/bin/env node
/**
 * GitHub  ->  data/repos.json
 *
 * Retrieves every repository the account owns, discovers a live preview URL and
 * an in-repo preview image for each, and writes a normalised catalogue file.
 * The browser app never talks to GitHub; it reads the output of this script.
 *
 *   node scripts/sync-github.mjs [--owner Sigovs] [--no-seed] [--quiet]
 */
import { GitHub, resolveToken, reportRate } from './lib/github.mjs';
import { mapLimit } from './lib/concurrency.mjs';
import { pickRootPreviewImage, pickRepresentativeImage, findReadmeUrl, resolvePreviewUrl } from './lib/discover.mjs';
import { titleFromRepoName } from './lib/titles.mjs';
import { guessCategory } from './lib/categories.mjs';
import { REPOS_FILE, OVERRIDES_FILE, loadEnv, readJson, writeJson } from './lib/paths.mjs';
import { log } from './lib/log.mjs';
import { isMain } from './lib/is-main.mjs';

loadEnv();

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const value = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i !== -1 && args[i + 1] ? args[i + 1] : fallback;
};

const OWNER = value('owner', process.env.CATALOG_OWNER || 'Sigovs');

export async function sync({ owner = OWNER, seed = !flag('no-seed') } = {}) {
  const { token, source } = resolveToken();
  const gh = new GitHub(token);

  log.step(`Syncing repositories for @${owner}`);
  log.dim(`auth: ${source}${token ? '' : ' (public repositories only, 60 req/hour)'}`);

  const raw = await gh.listOwnedRepos(owner);
  if (!raw.length) throw new Error(`No repositories found for @${owner}.`);
  log.ok(`${raw.length} repositories`);

  log.step('Discovering preview URLs and images');

  const repos = await mapLimit(raw, 6, async (r) => {
    const fullName = r.full_name;

    const pages = r.has_pages ? await gh.getPages(fullName).catch(() => null) : null;

    let readmeUrl = null;
    if (!r.homepage && !pages?.url) {
      readmeUrl = findReadmeUrl(await gh.getReadme(fullName).catch(() => null));
    }

    const preview = resolvePreviewUrl({ homepage: r.homepage, pages, readmeUrl });

    // One cheap non-recursive call: is there an explicit preview image committed?
    let repoImage = null;
    let repoImageKind = null;
    const rootTree = await gh
      .request(`/repos/${fullName}/git/trees/${encodeURIComponent(r.default_branch)}`)
      .then((res) => (res.ok && Array.isArray(res.data?.tree) ? res.data.tree.filter((n) => n.type === 'blob') : []))
      .catch(() => []);
    repoImage = pickRootPreviewImage(rootTree);
    if (repoImage) repoImageKind = 'explicit';

    // Only walk the whole tree when there is nothing else to show.
    if (!repoImage && !preview.url) {
      const blobs = await gh.getTree(fullName, r.default_branch).catch(() => []);
      repoImage = pickRepresentativeImage(blobs);
      if (repoImage) repoImageKind = 'representative';
    }

    return {
      name: r.name,
      fullName,
      description: r.description || null,
      private: Boolean(r.private),
      fork: Boolean(r.fork),
      archived: Boolean(r.archived),
      visibility: r.visibility || (r.private ? 'private' : 'public'),
      htmlUrl: r.html_url,
      cloneUrl: r.clone_url,
      sshUrl: r.ssh_url,
      defaultBranch: r.default_branch,
      language: r.language || null,
      topics: r.topics || [],
      sizeKb: r.size || 0,
      stars: r.stargazers_count || 0,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      pushedAt: r.pushed_at,
      homepage: r.homepage || null,
      hasPages: Boolean(r.has_pages),
      pagesStatus: pages?.status ?? null,
      previewUrl: preview.url,
      previewSource: preview.source,
      repoImage,
      repoImageKind,
    };
  });

  const withPreview = repos.filter((r) => r.previewUrl).length;
  const withImage = repos.filter((r) => r.repoImage).length;
  log.ok(`${withPreview} live preview URLs · ${withImage} in-repo preview images`);

  const owned = await gh.request(`/users/${owner}`).then((r) => r.data).catch(() => null);

  writeJson(REPOS_FILE, {
    generatedAt: new Date().toISOString(),
    owner,
    ownerUrl: owned?.html_url || `https://github.com/${owner}`,
    ownerName: owned?.name || owner,
    avatarUrl: owned?.avatar_url || null,
    count: repos.length,
    repos: repos.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt)),
  });
  log.ok(`data/repos.json — ${repos.length} projects`);

  if (seed) seedOverrides(repos);
  reportRate(gh);

  return repos;
}

/**
 * Adds a stub for any repository that has no entry yet, so a new project is
 * immediately editable by hand. Existing entries are never touched — this is
 * the file the designer owns.
 */
function seedOverrides(repos) {
  const file = readJson(OVERRIDES_FILE, null);
  if (!file) return;

  const projects = file.projects ?? file;
  const added = [];

  for (const repo of repos) {
    if (projects[repo.name]) continue;
    projects[repo.name] = {
      title: titleFromRepoName(repo.name),
      category: guessCategory(repo),
    };
    added.push(repo.name);
  }

  if (!added.length) {
    log.dim('catalog-overrides.json — no new repositories');
    return;
  }

  if (file.projects) file.projects = sortKeys(projects);
  writeJson(OVERRIDES_FILE, file.projects ? file : sortKeys(projects));
  log.ok(`catalog-overrides.json — seeded ${added.length} new: ${added.join(', ')}`);
}

function sortKeys(obj) {
  return Object.fromEntries(Object.entries(obj).sort(([a], [b]) => a.localeCompare(b, 'en', { sensitivity: 'base' })));
}

if (isMain(import.meta.url)) {
  sync().catch((err) => {
    log.err(err.message);
    process.exit(1);
  });
}
