import './styles/tokens.css';
import './styles/base.css';
import './styles/chrome.css';
import './styles/card.css';
import './styles/drawer.css';

import { renderCard, watchImages } from './ui/card.js';
import { Drawer } from './ui/drawer.js';
import { relativeTime, escapeHtml } from './lib/format.js';

const CATALOG_URL = `${import.meta.env.BASE_URL}catalog.json`;
const ALL = 'All';

const dom = {
  grid: document.getElementById('grid'),
  state: document.querySelector('[data-state]'),
  search: document.getElementById('search'),
  sort: document.getElementById('sort'),
  filters: document.querySelector('[data-filters]'),
  count: document.querySelector('[data-count]'),
  statusCount: document.querySelector('[data-status-count]'),
  statusSync: document.querySelector('[data-status-sync]'),
  colophon: document.querySelector('[data-colophon]'),
  profile: document.querySelector('[data-github-profile]'),
  pinned: document.querySelector('[data-action="pinned"]'),
  refresh: document.querySelector('[data-action="refresh"]'),
  toast: document.querySelector('[data-toast]'),
  drawer: document.getElementById('drawer'),
  scrim: document.querySelector('[data-scrim]'),
};

const state = {
  catalog: null,
  query: '',
  category: ALL,
  sort: 'updated',
  view: 'grid',
  pinnedOnly: false,
};

const drawer = new Drawer({ el: dom.drawer, scrim: dom.scrim, onCopy: copy });

/* ── data ────────────────────────────────────────────────────────────────── */

async function load({ bust = false } = {}) {
  const url = bust ? `${CATALOG_URL}?t=${Date.now()}` : CATALOG_URL;
  const res = await fetch(url, { cache: bust ? 'reload' : 'default' });
  if (!res.ok) throw new Error(`Could not load catalog.json (HTTP ${res.status})`);
  return res.json();
}

/* ── filtering ───────────────────────────────────────────────────────────── */

const COLLATOR = new Intl.Collator('en', { sensitivity: 'base', numeric: true });

const SORTERS = {
  updated: (a, b) => Date.parse(b.pushedAt) - Date.parse(a.pushedAt),
  created: (a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt),
  az: (a, b) => COLLATOR.compare(a.title, b.title),
  za: (a, b) => COLLATOR.compare(b.title, a.title),
};

function visible() {
  const terms = state.query.toLowerCase().split(/\s+/).filter(Boolean);

  const matched = state.catalog.projects.filter((p) => {
    if (state.pinnedOnly && !p.pinned) return false;
    if (state.category !== ALL && p.category !== state.category) return false;
    return terms.every((term) => p.search.includes(term));
  });

  matched.sort(SORTERS[state.sort] || SORTERS.updated);

  // Pinned projects simply lead the grid. No separate "featured" section.
  if (!state.pinnedOnly) {
    matched.sort((a, b) => Number(b.pinned) - Number(a.pinned));
  }

  return matched;
}

/* ── rendering ───────────────────────────────────────────────────────────── */

function renderFilters() {
  const counts = new Map([[ALL, state.catalog.projects.length]]);
  for (const p of state.catalog.projects) {
    counts.set(p.category, (counts.get(p.category) || 0) + 1);
  }

  const categories = [ALL, ...state.catalog.categories];
  dom.filters.innerHTML = categories
    .map(
      (c) => `
      <button type="button" class="filter" role="tab"
              data-category="${escapeHtml(c)}"
              aria-selected="${c === state.category}">
        ${escapeHtml(c)}<span class="filter__n">${counts.get(c) || 0}</span>
      </button>`,
    )
    .join('');
}

function renderGrid() {
  const projects = visible();

  dom.grid.dataset.view = state.view;
  dom.grid.setAttribute('aria-busy', 'false');
  dom.grid.replaceChildren();

  dom.count.textContent = projects.length
    ? `${projects.length} / ${state.catalog.projects.length}`
    : '';

  if (!projects.length) {
    dom.grid.hidden = true;
    dom.state.hidden = false;
    dom.state.innerHTML = `
      <h2>Nothing matches</h2>
      <p>No project matches ${state.query ? `“${escapeHtml(state.query)}”` : 'these filters'}.
         Try a different term, or clear the filters.</p>`;
    return;
  }

  dom.grid.hidden = false;
  dom.state.hidden = true;

  const frag = document.createDocumentFragment();
  for (const p of projects) frag.append(renderCard(p));
  dom.grid.append(frag);
  watchImages(dom.grid);
}

function renderChrome() {
  const { counts, owner, ownerUrl, syncedAt } = state.catalog;

  dom.statusCount.textContent = `${counts.total} projects`;
  dom.statusSync.textContent = syncedAt ? `Synced with GitHub ${relativeTime(syncedAt)}` : 'Not yet synced';
  if (ownerUrl) dom.profile.href = ownerUrl;

  document.title = `${owner || 'SIGOVS'} — Project Catalog`;

  dom.colophon.textContent =
    `${counts.total} projects · ${counts.withPreview} live previews · ` +
    `${counts.withThumbnail} thumbnails · run \`npm run catalog:update\` to refresh`;
}

function renderEmpty(message) {
  dom.grid.hidden = true;
  dom.grid.setAttribute('aria-busy', 'false');
  dom.state.hidden = false;
  dom.state.innerHTML = `
    <h2>No catalog yet</h2>
    <p>${escapeHtml(message)}</p>
    <p style="margin-top:12px">Run <code>npm run catalog:update</code> to pull your repositories
       from GitHub and capture their thumbnails.</p>`;
}

function renderSkeleton() {
  dom.grid.replaceChildren();
  const frag = document.createDocumentFragment();
  for (let i = 0; i < 6; i += 1) {
    const el = document.createElement('article');
    el.className = 'card skeleton';
    el.innerHTML = '<div class="card__frame"></div><div class="card__line"></div><div class="card__line"></div>';
    frag.append(el);
  }
  dom.grid.append(frag);
}

/* ── URL state ───────────────────────────────────────────────────────────── */

function readUrl() {
  const params = new URLSearchParams(location.search);
  state.query = params.get('q') || '';
  state.category = params.get('category') || ALL;
  state.sort = SORTERS[params.get('sort')] ? params.get('sort') : 'updated';
  state.view = params.get('view') === 'compact' ? 'compact' : 'grid';
  state.pinnedOnly = params.get('pinned') === '1';

  dom.search.value = state.query;
  dom.sort.value = state.sort;
  dom.pinned.setAttribute('aria-pressed', String(state.pinnedOnly));
  for (const btn of document.querySelectorAll('[data-view]')) {
    btn.setAttribute('aria-pressed', String(btn.dataset.view === state.view));
  }
}

function writeUrl() {
  const params = new URLSearchParams();
  if (state.query) params.set('q', state.query);
  if (state.category !== ALL) params.set('category', state.category);
  if (state.sort !== 'updated') params.set('sort', state.sort);
  if (state.view !== 'grid') params.set('view', state.view);
  if (state.pinnedOnly) params.set('pinned', '1');

  const qs = params.toString();
  history.replaceState(null, '', qs ? `?${qs}` : location.pathname);
}

function update() {
  writeUrl();
  if (state.catalog) renderGrid();
}

/* ── events ──────────────────────────────────────────────────────────────── */

function wire() {
  let debounce;
  dom.search.addEventListener('input', () => {
    clearTimeout(debounce);
    debounce = setTimeout(() => {
      state.query = dom.search.value.trim();
      update();
    }, 90);
  });

  dom.search.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && dom.search.value) {
      event.stopPropagation();
      dom.search.value = '';
      state.query = '';
      update();
    }
  });

  dom.filters.addEventListener('click', (event) => {
    const btn = event.target.closest('[data-category]');
    if (!btn) return;
    state.category = btn.dataset.category;
    for (const b of dom.filters.children) {
      b.setAttribute('aria-selected', String(b === btn));
    }
    update();
  });

  dom.sort.addEventListener('change', () => {
    state.sort = dom.sort.value;
    update();
  });

  dom.pinned.addEventListener('click', () => {
    state.pinnedOnly = !state.pinnedOnly;
    dom.pinned.setAttribute('aria-pressed', String(state.pinnedOnly));
    update();
  });

  for (const btn of document.querySelectorAll('[data-view]')) {
    btn.addEventListener('click', () => {
      state.view = btn.dataset.view;
      for (const b of document.querySelectorAll('[data-view]')) {
        b.setAttribute('aria-pressed', String(b === btn));
      }
      update();
    });
  }

  dom.refresh.addEventListener('click', async () => {
    dom.refresh.dataset.busy = 'true';
    try {
      state.catalog = await load({ bust: true });
      renderChrome();
      renderFilters();
      renderGrid();
      toast('Catalog reloaded');
    } catch (err) {
      toast(err.message);
    } finally {
      dom.refresh.dataset.busy = 'false';
    }
  });

  dom.grid.addEventListener('click', (event) => {
    const clip = event.target.closest('[data-copy]');
    if (clip) {
      copy(clip.dataset.copy, clip.dataset.copyLabel || 'Copied');
      return;
    }
    const trigger = event.target.closest('[data-open-drawer]');
    if (!trigger) return;
    const id = trigger.closest('.card')?.dataset.id;
    const project = state.catalog.projects.find((p) => p.id === id);
    if (project) drawer.open(project, trigger);
  });

  document.addEventListener('keydown', (event) => {
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName);

    if (!typing && event.key === '/') {
      event.preventDefault();
      dom.search.focus();
      dom.search.select();
    }
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      dom.search.focus();
      dom.search.select();
    }
  });

  // Collapse the masthead once the grid is under way.
  const onScroll = () => {
    document.body.classList.toggle('is-scrolled', window.scrollY > 24);
  };
  addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  // Dev only: the Vite plugin pings when repos.json or the overrides change.
  if (import.meta.hot) {
    import.meta.hot.on('catalog:changed', async () => {
      state.catalog = await load({ bust: true });
      renderChrome();
      renderFilters();
      renderGrid();
      toast('Catalog updated');
    });
  }
}

/* ── small helpers ───────────────────────────────────────────────────────── */

let toastTimer;
function toast(message) {
  dom.toast.textContent = message;
  dom.toast.classList.add('is-shown');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => dom.toast.classList.remove('is-shown'), 2200);
}

async function copy(text, label) {
  try {
    await navigator.clipboard.writeText(text);
    toast(label);
  } catch {
    toast('Could not access the clipboard');
  }
}

/* ── boot ────────────────────────────────────────────────────────────────── */

(async function boot() {
  renderSkeleton();
  readUrl();
  wire();

  try {
    state.catalog = await load();
  } catch (err) {
    renderEmpty(err.message);
    return;
  }

  renderChrome();

  if (!state.catalog.projects.length) {
    renderEmpty('data/repos.json has no repositories in it yet.');
    return;
  }

  renderFilters();
  renderGrid();
})();
