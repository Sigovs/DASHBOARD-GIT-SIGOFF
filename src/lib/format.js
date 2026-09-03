const RTF = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });

const UNITS = [
  ['year', 31536000],
  ['month', 2592000],
  ['week', 604800],
  ['day', 86400],
  ['hour', 3600],
  ['minute', 60],
];

/** "2 days ago" — compact enough for a metadata line. */
export function relativeTime(iso) {
  if (!iso) return '—';
  const seconds = (Date.parse(iso) - Date.now()) / 1000;
  const abs = Math.abs(seconds);
  if (abs < 60) return 'just now';
  for (const [unit, size] of UNITS) {
    if (abs >= size) return RTF.format(Math.round(seconds / size), unit);
  }
  return 'just now';
}

/** "2d", "3w" — for the tight card metadata row. */
export function shortAge(iso) {
  if (!iso) return '—';
  const days = Math.floor((Date.now() - Date.parse(iso)) / 86400000);
  if (days < 1) return 'today';
  if (days === 1) return '1d';
  if (days < 7) return `${days}d`;
  if (days < 31) return `${Math.floor(days / 7)}w`;
  if (days < 365) return `${Math.floor(days / 30)}mo`;
  return `${Math.floor(days / 365)}y`;
}

export function isRecent(iso, days = 7) {
  return Boolean(iso) && Date.now() - Date.parse(iso) < days * 86400000;
}

export function absoluteDate(iso) {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).format(
    new Date(iso),
  );
}

/** GitHub reports repository size in kilobytes. */
export function repoSize(kb) {
  if (!kb) return '—';
  if (kb < 1024) return `${kb} KB`;
  if (kb < 1048576) return `${(kb / 1024).toFixed(kb / 1024 < 10 ? 1 : 0)} MB`;
  return `${(kb / 1048576).toFixed(2)} GB`;
}

export function prettyUrl(url) {
  if (!url) return '—';
  return url.replace(/^https?:\/\//, '').replace(/\/$/, '');
}

/** Deterministic small integer from a string, for placeholder variation. */
export function seed(text) {
  let h = 0;
  for (let i = 0; i < text.length; i += 1) h = (h * 31 + text.charCodeAt(i)) | 0;
  return Math.abs(h);
}

export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const PREVIEW_SOURCE_LABEL = {
  homepage: 'Repository homepage',
  pages: 'GitHub Pages',
  'pages-errored': 'GitHub Pages (last build failed)',
  readme: 'Link found in README',
  override: 'Set in catalog-overrides.json',
};

/** A "-subpath" suffix means the root 404'd and the site was found one folder down. */
export const previewSourceLabel = (key) => {
  if (!key) return '—';
  const recovered = key.endsWith('-subpath');
  const base = recovered ? key.slice(0, -'-subpath'.length) : key;
  const label = PREVIEW_SOURCE_LABEL[base] || '—';
  return recovered ? `${label} — found in a subfolder` : label;
};

const THUMB_SOURCE_LABEL = {
  screenshot: 'Captured from the live site',
  'repo-image': 'Image found in the repository',
  opengraph: 'GitHub open-graph card',
  override: 'Set in catalog-overrides.json',
};

export const thumbSourceLabel = (key) => THUMB_SOURCE_LABEL[key] || 'Generated placeholder';
