/**
 * Preview-URL and preview-image discovery.
 *
 * Rule of thumb: only claim a URL we have positive evidence for. A repository
 * with no Pages deployment, no homepage field and no explicitly labelled demo
 * link in its README gets `previewUrl: null` and an elegant placeholder in the
 * UI — that is a better outcome than a card that opens a 404.
 */

const IMAGE_EXT = /\.(png|jpe?g|webp|avif)$/i;

const ROOT_PREVIEW_NAMES = [
  'preview', 'thumbnail', 'thumb', 'screenshot', 'social-preview', 'og', 'og-image', 'cover', 'banner',
];

/** Looser second pass: "patton-live-full.png" is obviously a preview shot. */
const ROOT_PREVIEW_HINT = /(preview|screenshot|thumb|cover|banner|hero|og[-_]?image|live|full|desktop|home)/i;

/**
 * An explicit preview image committed at the repository root.
 *
 * Exact conventional names win. Failing that, a root-level image whose name
 * hints at a screenshot is accepted — a repo root is not where people keep
 * incidental pictures, so the false-positive risk is low.
 */
export function pickRootPreviewImage(rootEntries) {
  const candidates = rootEntries.filter((e) => IMAGE_EXT.test(e.path));
  if (!candidates.length) return null;

  const baseOf = (e) => e.path.split('/').pop().replace(IMAGE_EXT, '').toLowerCase();

  for (const wanted of ROOT_PREVIEW_NAMES) {
    const hit = candidates.find((e) => baseOf(e) === wanted);
    if (hit) return hit.path;
  }

  const hinted = candidates
    .filter((e) => ROOT_PREVIEW_HINT.test(baseOf(e)) && e.size > 20_000)
    .sort((a, b) => b.size - a.size)[0];

  return hinted ? hinted.path : null;
}

const REPRESENTATIVE = /(hero|cover|preview|screenshot|banner|main|home|intro|poster)/i;
const REJECT = /(node_modules|\.git\/|favicon|sprite|icon|logo|placeholder|avatar|spinner|loader|pattern|texture|noise|\/fonts?\/)/i;
const ASSET_DIR = /^(img|images|assets|public|static|media|src|docs)\//i;

/**
 * Best-effort "a picture from inside the repo". Used only when there is no
 * live URL to screenshot. Deliberately conservative about size so we never
 * pull a 40 MB hero video frame or a 2 KB tracking pixel.
 */
export function pickRepresentativeImage(treeBlobs) {
  const usable = treeBlobs.filter(
    (b) => IMAGE_EXT.test(b.path) && !REJECT.test(b.path) && b.size > 20_000 && b.size < 8_000_000,
  );
  if (!usable.length) return null;

  const score = (b) => {
    let s = 0;
    if (REPRESENTATIVE.test(b.path)) s += 1000;
    if (ASSET_DIR.test(b.path)) s += 200;
    s -= b.path.split('/').length * 10; // shallower wins
    s += Math.min(b.size / 50_000, 100); // bigger wins, with a ceiling
    return s;
  };

  return usable.sort((a, b) => score(b) - score(a))[0].path;
}

const LABELLED_LINK = /\[[^\]]*\b(live|demo|preview|website|site|view)\b[^\]]*\]\((https?:\/\/[^)\s]+)\)/i;
const BARE_PAGES_LINK = /https?:\/\/[a-z0-9-]+\.github\.io\/[^\s)>"']*/i;

/** A demo link from the README, but only when the README says it is one. */
export function findReadmeUrl(readme) {
  if (!readme) return null;
  const labelled = LABELLED_LINK.exec(readme);
  if (labelled) return normalise(labelled[2]);
  const pages = BARE_PAGES_LINK.exec(readme);
  if (pages) return normalise(pages[0]);
  return null;
}

function normalise(url) {
  try {
    const u = new URL(url);
    if (u.hostname === 'github.com') return null; // that is the repo, not a preview
    if (/\.(png|jpe?g|svg|gif|webp)$/i.test(u.pathname)) return null; // a badge
    return u.toString();
  } catch {
    return null;
  }
}

/**
 * Resolve one preview URL from all available evidence, strongest first.
 * Returns { url, source } or { url: null, source: null }.
 */
export function resolvePreviewUrl({ homepage, pages, readmeUrl }) {
  if (homepage && /^https?:\/\//i.test(homepage)) {
    return { url: homepage, source: 'homepage' };
  }
  if (pages?.url && pages.status !== 'errored') {
    return { url: pages.url, source: 'pages' };
  }
  if (pages?.url && pages.status === 'errored') {
    // Pages exists but the last build failed. Still the right URL, flagged.
    return { url: pages.url, source: 'pages-errored' };
  }
  if (readmeUrl) {
    return { url: readmeUrl, source: 'readme' };
  }
  return { url: null, source: null };
}

/* ── live verification ───────────────────────────────────────────────────── */

/**
 * Where a site ends up when the repository root has no index.html. Ordered by
 * how likely each is to be the deployed site rather than source.
 */
const SUBPATH_CANDIDATES = [
  'dist/', 'build/', 'public/', 'site/', 'docs/', 'mockup/', 'www/', 'app/', 'web/', 'src/',
];

async function status(url, timeoutMs) {
  const signal = AbortSignal.timeout(timeoutMs);
  try {
    const res = await fetch(url, { method: 'GET', redirect: 'follow', signal });
    res.body?.cancel?.();
    return res.status;
  } catch {
    return 0;
  }
}

/**
 * Confirms a discovered preview URL actually serves a page, and recovers the
 * common case where Pages is enabled but the site lives one folder down
 * (PATTON deploys from `/` while its build sits in `mockup/`).
 *
 * Returns the URL that works, or the original one with the failing status so
 * the catalog can say honestly that the preview is broken.
 */
export async function verifyPreviewUrl(url, { timeoutMs = 12000, probeSubpaths = true } = {}) {
  if (!url) return { url: null, status: null, recovered: false };

  const first = await status(url, timeoutMs);
  if (first >= 200 && first < 400) return { url, status: first, recovered: false };
  if (!probeSubpaths || first !== 404) return { url, status: first, recovered: false };

  const base = url.endsWith('/') ? url : `${url}/`;
  for (const suffix of SUBPATH_CANDIDATES) {
    const candidate = `${base}${suffix}`;
    if ((await status(candidate, timeoutMs)) === 200) {
      return { url: candidate, status: 200, recovered: true };
    }
  }

  return { url, status: first, recovered: false };
}
