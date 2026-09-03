import {
  relativeTime,
  absoluteDate,
  repoSize,
  prettyUrl,
  escapeHtml,
  previewSourceLabel,
  thumbSourceLabel,
} from '../lib/format.js';
import { resolve } from './card.js';

const FOCUSABLE = 'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])';

export class Drawer {
  constructor({ el, scrim, onCopy }) {
    this.el = el;
    this.scrim = scrim;
    this.onCopy = onCopy;
    this.returnFocus = null;

    scrim.addEventListener('click', () => this.close());

    el.addEventListener('click', (event) => {
      if (event.target.closest('[data-close]')) this.close();
      const copy = event.target.closest('[data-copy]');
      if (copy) this.onCopy(copy.dataset.copy, copy.dataset.copyLabel || 'Copied');
    });

    document.addEventListener('keydown', (event) => {
      if (!this.isOpen) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        this.close();
      }
      if (event.key === 'Tab') this.trap(event);
    });
  }

  get isOpen() {
    return this.el.classList.contains('is-open');
  }

  open(project, returnFocus) {
    this.returnFocus = returnFocus || null;
    this.el.innerHTML = template(project);
    this.el.hidden = false;
    this.scrim.hidden = false;

    // One frame so the transition has a start state to animate from.
    requestAnimationFrame(() => {
      this.el.classList.add('is-open');
      this.scrim.classList.add('is-open');
      document.body.classList.add('is-locked');
      this.el.querySelector('[data-close]')?.focus();
    });
  }

  close() {
    if (!this.isOpen) return;
    this.el.classList.remove('is-open');
    this.scrim.classList.remove('is-open');
    document.body.classList.remove('is-locked');

    const done = () => {
      this.el.hidden = true;
      this.scrim.hidden = true;
      this.el.innerHTML = '';
    };

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced) done();
    else this.el.addEventListener('transitionend', done, { once: true });

    this.returnFocus?.focus();
    this.returnFocus = null;
  }

  trap(event) {
    const nodes = [...this.el.querySelectorAll(FOCUSABLE)].filter((n) => n.offsetParent !== null);
    if (!nodes.length) return;
    const first = nodes[0];
    const last = nodes[nodes.length - 1];

    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }
}

function template(p) {
  const hero = p.thumb
    ? `<img src="${escapeHtml(resolve(p.thumb.lg))}" alt="Screenshot of ${escapeHtml(p.title)}" width="1600" height="1000">`
    : `<div class="card__placeholder" style="--mesh:28px" aria-hidden="true">
         <span class="card__initials">${escapeHtml(p.initials)}</span>
         <span class="card__placeholder-name">${escapeHtml(p.repo)}</span>
       </div>`;

  return `
    <div class="dw__hero">
      ${hero}
      <button type="button" class="dw__close" data-close aria-label="Close details">
        <svg aria-hidden="true" width="14" height="14"><use href="#i-close"/></svg>
      </button>
    </div>

    <div class="dw__body">
      <p class="dw__eyebrow">
        <span>${escapeHtml(p.category)}</span>
        ${p.status ? `<span class="dot"></span><span class="status" style="--status-dot:var(--st-${escapeHtml(p.status)})">${escapeHtml(p.status)}</span>` : ''}
        ${p.private ? '<span class="dot"></span><span>Private</span>' : ''}
      </p>

      <h2 class="dw__title" id="drawer-title">${escapeHtml(p.title)}</h2>
      ${p.subtitle ? `<p class="dw__sub">${escapeHtml(p.subtitle)}</p>` : ''}
      <p class="dw__repo"><svg aria-hidden="true" width="12" height="12"><use href="#i-github"/></svg>${escapeHtml(p.repo)}</p>

      ${p.description ? `<p class="dw__desc">${escapeHtml(p.description)}</p>` : ''}

      ${p.tags.length ? `<div class="dw__tags">${p.tags.map((t) => `<span class="chip">${escapeHtml(t)}</span>`).join('')}</div>` : ''}

      <div class="dw__actions">
        ${
          p.previewUrl
            ? `<a class="btn btn--primary" href="${escapeHtml(p.previewUrl)}" target="_blank" rel="noreferrer">
                 Open preview <svg aria-hidden="true" width="12" height="12"><use href="#i-arrow"/></svg>
               </a>`
            : `<span class="btn" aria-disabled="true">No live preview</span>`
        }
        <a class="btn" href="${escapeHtml(p.githubUrl)}" target="_blank" rel="noreferrer">
          GitHub <svg aria-hidden="true" width="12" height="12"><use href="#i-arrow"/></svg>
        </a>
        ${
          p.localPath
            ? `<a class="btn" href="vscode://file/${encodeURI(p.localPath.replace(/\\/g, '/'))}">
                 <svg aria-hidden="true" width="12" height="12"><use href="#i-code"/></svg> VS Code
               </a>`
            : ''
        }
      </div>

      <div class="dw__clone">
        <code>git clone ${escapeHtml(p.cloneUrl)}</code>
        <button type="button" class="dw__copy" data-copy="git clone ${escapeHtml(p.cloneUrl)}"
                data-copy-label="Clone command copied" aria-label="Copy clone command">
          <svg aria-hidden="true" width="13" height="13"><use href="#i-copy"/></svg>
        </button>
      </div>

      <dl class="dw__spec">
        ${row('Live preview', p.previewUrl
          ? `<a href="${escapeHtml(p.previewUrl)}" target="_blank" rel="noreferrer">${escapeHtml(prettyUrl(p.previewUrl))}</a>`
          : 'none detected')}
        ${row('Preview from', escapeHtml(previewSourceLabel(p.previewSource)))}
        ${row('Thumbnail', escapeHtml(thumbSourceLabel(p.thumb?.source)))}
        ${row('Updated', `${escapeHtml(relativeTime(p.pushedAt))} <span style="color:var(--ink-4)">· ${escapeHtml(absoluteDate(p.pushedAt))}</span>`)}
        ${row('Created', escapeHtml(absoluteDate(p.createdAt)))}
        ${row('Branch', escapeHtml(p.defaultBranch))}
        ${row('Language', escapeHtml(p.language || '—'))}
        ${row('Size', escapeHtml(repoSize(p.sizeKb)))}
        ${p.localPath ? row('Local path', escapeHtml(p.localPath)) : ''}
      </dl>
    </div>
  `;
}

const row = (label, value) => `<div class="dw__row"><dt>${label}</dt><dd>${value}</dd></div>`;
