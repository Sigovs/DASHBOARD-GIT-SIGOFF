import { shortAge, isRecent, seed, escapeHtml } from '../lib/format.js';

const BASE = import.meta.env.BASE_URL;

/** Placeholder mesh spacing, varied a little per project so 48 of them do not read as wallpaper. */
const MESH = [22, 26, 30, 34];

/**
 * One project card.
 *
 * Two links carry the primary action — the image and the title — so most of the
 * card opens the preview without any stretched-link trickery fighting the
 * action buttons for the click.
 */
export function renderCard(p) {
  const el = document.createElement('article');
  el.className = 'card';
  el.dataset.id = p.id;

  const href = p.previewUrl || p.githubUrl;
  const opensPreview = Boolean(p.previewUrl);
  const alt = p.previewUrl
    ? `Screenshot of ${p.title}${p.subtitle ? `, ${p.subtitle}` : ''}`
    : `${p.title} — no live preview available`;

  el.innerHTML = `
    <a class="card__frame"
       href="${escapeHtml(href)}"
       target="_blank"
       rel="noreferrer"
       aria-label="${escapeHtml(opensPreview ? `Open ${p.title} preview` : `Open ${p.title} on GitHub`)}">
      ${thumbHtml(p, alt)}
      ${marksHtml(p)}
      ${versionBadgeHtml(p)}
    </a>

    <div class="card__body">
      <div class="card__head">
        <a class="card__title" href="${escapeHtml(href)}" target="_blank" rel="noreferrer">${escapeHtml(p.title)}</a>
        <span class="card__updated" data-recent="${isRecent(p.pushedAt)}" title="Updated ${escapeHtml(p.pushedAt || '')}">
          ${escapeHtml(shortAge(p.pushedAt))}
        </span>
      </div>

      ${p.subtitle ? `<p class="card__sub">${escapeHtml(p.subtitle)}</p>` : ''}
      <p class="card__repo">${escapeHtml(p.repo)}</p>

      <div class="card__tags">${tagsHtml(p)}</div>

      <div class="card__actions">
        ${
          p.previewUrl
            ? `<a class="action" href="${escapeHtml(p.previewUrl)}" target="_blank" rel="noreferrer">
                 Preview <svg aria-hidden="true" width="11" height="11"><use href="#i-arrow"/></svg>
               </a>`
            : ''
        }
        <a class="action" href="${escapeHtml(p.githubUrl)}" target="_blank" rel="noreferrer">
          GitHub <svg aria-hidden="true" width="11" height="11"><use href="#i-arrow"/></svg>
        </a>
        <button type="button" class="action action--icon"
                data-copy="git clone ${escapeHtml(p.cloneUrl)}"
                data-copy-label="Clone command copied"
                aria-label="Copy clone command for ${escapeHtml(p.title)}">
          <svg aria-hidden="true" width="12" height="12"><use href="#i-copy"/></svg>
        </button>
        <button type="button" class="action action--cta" data-open-drawer
                aria-label="View details and all ${p.variantCount} versions of ${escapeHtml(p.title)}"
                aria-haspopup="dialog">
          View details
          ${p.versions.length > 1 ? `<span class="action__n">${p.versions.length}</span>` : ''}
        </button>
      </div>
    </div>
  `;

  return el;
}

function thumbHtml(p, alt) {
  if (!p.thumb) return placeholderHtml(p);

  const sm = resolve(p.thumb.sm);
  const lg = resolve(p.thumb.lg);

  return `
    ${placeholderHtml(p)}
    <img class="card__img"
         src="${escapeHtml(sm)}"
         srcset="${escapeHtml(sm)} 800w, ${escapeHtml(lg)} 1600w"
         sizes="(max-width: 639px) 92vw, (max-width: 1179px) 46vw, 31vw"
         alt="${escapeHtml(alt)}"
         width="800" height="500"
         loading="lazy" decoding="async"
         data-loaded="false">
  `;
}

/**
 * Always rendered underneath the image, so a thumbnail that fails to load
 * reveals the generated mark instead of a broken-image icon.
 */
function placeholderHtml(p) {
  const mesh = MESH[seed(p.id) % MESH.length];
  return `
    <div class="card__placeholder" style="--mesh:${mesh}px" aria-hidden="true">
      <span class="card__initials">${escapeHtml(p.initials)}</span>
      <span class="card__placeholder-name">${escapeHtml(p.repo)}</span>
    </div>
  `;
}

function marksHtml(p) {
  const marks = [];
  if (p.pinned) {
    marks.push(`<span class="mark mark--pin" title="Pinned"><svg aria-hidden="true" width="10" height="10"><use href="#i-pin"/></svg></span>`);
  }
  if (p.private) {
    marks.push(`<span class="mark mark--private" title="Private repository"><svg aria-hidden="true" width="10" height="10"><use href="#i-lock"/></svg></span>`);
  }
  return marks.length ? `<div class="card__marks">${marks.join('')}</div>` : '';
}

function versionBadgeHtml(p) {
  if (p.versions.length < 2) return '';
  return `
    <div class="card__marks card__marks--right">
      <span class="mark mark--versions">${p.versions.length} versions</span>
    </div>`;
}

function tagsHtml(p) {
  const parts = [];
  if (p.status) {
    parts.push(
      `<span class="status" style="--status-dot:var(--st-${escapeHtml(p.status)})">${escapeHtml(p.status)}</span>`,
    );
  }
  parts.push(escapeHtml(p.category));
  for (const tag of p.tags.slice(0, 2)) parts.push(escapeHtml(tag));

  return parts.join('<span class="sep" aria-hidden="true">·</span>');
}

export function resolve(src) {
  if (!src) return '';
  return /^https?:\/\//i.test(src) ? src : `${BASE}${src}`;
}

/** Fades a thumbnail in once decoded; falls back to the placeholder on error. */
export function watchImages(root) {
  for (const img of root.querySelectorAll('img[data-loaded="false"]')) {
    const settle = () => {
      img.dataset.loaded = 'true';
    };
    if (img.complete && img.naturalWidth) settle();
    else img.addEventListener('load', settle, { once: true });

    img.addEventListener('error', () => img.remove(), { once: true });
  }
}
