/**
 * Version and page discovery.
 *
 * These repositories are design explorations, not products: a single project
 * routinely carries index.html through index10.html, plus srp/vdp/inventory
 * variants numbered the same way. Those alternatives are the actual work, and a
 * catalogue that only ever shows index.html hides most of it.
 *
 * This module turns a flat list of HTML files at the site root into two things:
 *
 *   versions — alternatives of the same page (index, index2, index_3, hero-v2)
 *   pages    — the other pages of the site (about, contact, design-system)
 */
import { titleFromRepoName } from './titles.mjs';

const HTML = /\.html?$/i;

/** "index_10" -> { base: "index", variant: 10 };  "about" -> { base: "about", variant: 1 } */
function splitVariant(stem) {
  const m = /^(.*?)[ _\-.]?v?(\d+)$/i.exec(stem);
  if (!m || !m[1]) return { base: stem.toLowerCase(), variant: 1 };
  return { base: m[1].toLowerCase(), variant: Number(m[2]) };
}

const KNOWN_LABELS = new Map(Object.entries({
  index: 'Main',
  ds: 'Design system',
  'design-system': 'Design system',
  design: 'Design system',
  srp: 'Search results',
  vdp: 'Vehicle detail',
  inventory: 'Inventory',
  about: 'About',
  contact: 'Contact',
  '404': 'Not found',
}));

function labelFor(base, variant, stem) {
  const known = KNOWN_LABELS.get(base);
  const name = known || titleFromRepoName(base);
  if (variant <= 1) return name;
  return base === 'index' ? `Version ${variant}` : `${name} ${variant}`;
}

/**
 * @param {string[]} files   html filenames at the site root, e.g. ["index.html", "index2.html"]
 * @param {string}   baseUrl the live site root, ending in "/"
 */
export function classifyPages(files, baseUrl) {
  const entries = files
    .filter((f) => HTML.test(f))
    .map((file) => {
      const stem = file.replace(HTML, '');
      const { base, variant } = splitVariant(stem);
      return {
        file,
        stem,
        base,
        variant,
        label: labelFor(base, variant, stem),
        url: `${baseUrl}${file}`,
      };
    });

  // Anything sharing a stem with a sibling is a variant of it, not a page of
  // its own — that is what makes srp.html / srp4.html read as one thing.
  const groups = new Map();
  for (const e of entries) {
    if (!groups.has(e.base)) groups.set(e.base, []);
    groups.get(e.base).push(e);
  }

  const byVariant = (a, b) => a.variant - b.variant;

  const versions = (groups.get('index') || []).sort(byVariant);

  const pages = [];
  for (const [base, group] of groups) {
    if (base === 'index') continue;
    pages.push(...group.sort(byVariant));
  }
  pages.sort((a, b) => a.base.localeCompare(b.base) || a.variant - b.variant);

  return { versions, pages };
}

/**
 * The folder inside the repository that the live site is served from.
 * Empty string when the site is at the repository root.
 */
export function siteRootPath(pagesBaseUrl, resolvedUrl) {
  if (!pagesBaseUrl || !resolvedUrl) return '';
  if (!resolvedUrl.startsWith(pagesBaseUrl)) return '';
  return resolvedUrl.slice(pagesBaseUrl.length).replace(/^\/+|\/+$/g, '');
}

/**
 * Sites living in subfolders of one repository.
 *
 * A repository whose root has no index.html but whose subfolders each have one
 * is not a project — it is a shelf holding several. Treating it as a single
 * card shows an empty placeholder and hides everything real inside it, so the
 * catalog splits it into one project per subfolder instead.
 *
 * The evidence has to be unambiguous: a root index.html means the repository is
 * a site in its own right, and its subfolders are parts of it, not siblings.
 *
 * @param {Array<{path:string,type:string}>} tree  recursive tree of the deployed branch
 * @param {string} baseUrl                         the site root, ending in "/"
 */
export function findSubsites(tree, baseUrl) {
  const files = tree.filter((n) => n.type === 'blob').map((n) => n.path);

  const hasRootIndex = files.some((f) => /^index\.html?$/i.test(f));
  if (hasRootIndex) return [];

  // Directories that hold an index of their own, one level down.
  const dirs = new Set();
  for (const f of files) {
    const m = /^([^/]+)\/index\.html?$/i.exec(f);
    if (m) dirs.add(m[1]);
  }
  // Two is the threshold. One subfolder with an index is a project whose build
  // simply lives one level down — the subpath probe already resolves that, and
  // splitting it would turn design_dna into a shelf holding one thing.
  if (dirs.size < 2) return [];

  return [...dirs].sort((a, b) => a.localeCompare(b)).map((dir) => {
    const inside = files
      .filter((f) => f.startsWith(`${dir}/`) && !f.slice(dir.length + 1).includes('/'))
      .map((f) => f.slice(dir.length + 1));

    const url = `${baseUrl}${dir.split('/').map(encodeURIComponent).join('/')}/`;
    const { versions, pages } = classifyPages(inside, url);

    return { dir, url, versions, pages };
  });
}

/**
 * Everything in a repository that deserves its own screenshot.
 *
 * A normal repository yields one target. A container yields one per subfolder
 * and none for itself, because its root is an empty shelf — screenshotting it
 * would capture a 404 page.
 *
 * The id is what the thumbnail manifests key on, so it has to be stable across
 * runs and unique across the account: "repo" or "repo/folder".
 */
export function captureTargets(repo) {
  if (repo.subsites?.length) {
    return repo.subsites.map((s) => ({
      id: `${repo.name}/${s.dir}`,
      repo,
      dir: s.dir,
      url: s.url,
      versions: s.versions,
      pages: s.pages,
      isSubsite: true,
    }));
  }

  return [
    {
      id: repo.name,
      repo,
      dir: null,
      url: repo.previewUrl,
      versions: repo.versions || [],
      pages: repo.pages || [],
      isSubsite: false,
    },
  ];
}
