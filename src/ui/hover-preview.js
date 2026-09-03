import { resolve } from './card.js';
import { escapeHtml } from '../lib/format.js';

/**
 * What a card does when you rest on it.
 *
 * Two modes, because they answer different questions:
 *
 *   versions  cycles through the project's alternative indexes. Instant, since
 *             the screenshots are already cached, and it surfaces the ten
 *             designs that are otherwise buried behind a click.
 *
 *   live      loads the real site in a scaled-down iframe. Truthful, but these
 *             are heavy GSAP and 3D builds — expect a second of nothing before
 *             the hero paints. Opt-in for that reason.
 *
 * Only ever one preview is alive at a time, and it is torn down the moment the
 * pointer leaves. Nothing runs on touch devices or under reduced motion.
 */

const HOLD_MS = 480; // rest this long before anything happens
const STEP_MS = 1100; // per version
const MAX_FRAMES = 6;
const LIVE_VIEWPORT = 1440;

export class HoverPreview {
  constructor({ grid, getProject, mode = 'versions' }) {
    this.grid = grid;
    this.getProject = getProject;
    this.mode = mode;
    this.active = null;

    this.enabled =
      window.matchMedia('(hover: hover) and (pointer: fine)').matches &&
      !window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (!this.enabled) return;

    grid.addEventListener('pointerover', (e) => this.onEnter(e));
    grid.addEventListener('pointerout', (e) => this.onLeave(e));
    // A card can be removed by a filter change while it is playing.
    grid.addEventListener('catalog:rerender', () => this.stop());
  }

  setMode(mode) {
    this.mode = mode;
    this.stop();
  }

  onEnter(event) {
    const frame = event.target.closest?.('.card__frame');
    if (!frame || frame === this.active?.frame) return;
    if (frame.contains(event.relatedTarget)) return;

    this.stop();

    const project = this.getProject(frame.closest('.card')?.dataset.id);
    if (!project) return;

    const canFlip = this.mode === 'versions' && project.versions?.filter((v) => v.thumb).length > 1;
    const canLive = this.mode === 'live' && Boolean(project.previewUrl);
    if (!canFlip && !canLive) return;

    const timer = setTimeout(() => {
      if (this.mode === 'live') this.startLive(frame, project);
      else this.startFlip(frame, project);
    }, HOLD_MS);

    this.active = { frame, timer, layer: null, interval: null };
  }

  onLeave(event) {
    const frame = event.target.closest?.('.card__frame');
    if (!frame || frame !== this.active?.frame) return;
    if (frame.contains(event.relatedTarget)) return;
    this.stop();
  }

  stop() {
    if (!this.active) return;
    clearTimeout(this.active.timer);
    clearInterval(this.active.interval);
    this.active.layer?.remove();
    this.active = null;
  }

  /* ── cycling the alternative indexes ───────────────────────────────────── */

  startFlip(frame, project) {
    const shots = project.versions.filter((v) => v.thumb).slice(0, MAX_FRAMES);
    if (shots.length < 2) return;

    const layer = document.createElement('div');
    layer.className = 'hp hp--flip';
    layer.setAttribute('aria-hidden', 'true');
    layer.innerHTML = `
      <img class="hp__img" alt="">
      <div class="hp__bar">
        <span class="hp__label"></span>
        <span class="hp__dots">${shots.map(() => '<i></i>').join('')}</span>
      </div>`;

    frame.append(layer);
    this.active.layer = layer;

    const img = layer.querySelector('.hp__img');
    const label = layer.querySelector('.hp__label');
    const dots = [...layer.querySelectorAll('.hp__dots i')];

    // Warm every frame first, so the cycle never stutters on a cold cache.
    shots.forEach((v) => {
      const pre = new Image();
      pre.src = resolve(v.thumb);
    });

    let i = 0;
    const show = () => {
      const v = shots[i];
      img.src = resolve(v.thumb);
      label.textContent = v.label;
      dots.forEach((d, n) => d.classList.toggle('is-on', n === i));
      i = (i + 1) % shots.length;
    };

    show();
    requestAnimationFrame(() => layer.classList.add('is-in'));
    this.active.interval = setInterval(show, STEP_MS);
  }

  /* ── the real site, scaled down ────────────────────────────────────────── */

  startLive(frame, project) {
    const layer = document.createElement('div');
    layer.className = 'hp hp--live';
    layer.setAttribute('aria-hidden', 'true');

    const scale = frame.clientWidth / LIVE_VIEWPORT;
    layer.innerHTML = `
      <iframe
        src="${escapeHtml(project.previewUrl)}"
        title=""
        tabindex="-1"
        scrolling="no"
        referrerpolicy="no-referrer"
        sandbox="allow-scripts allow-same-origin"
        style="width:${LIVE_VIEWPORT}px;height:${Math.round(LIVE_VIEWPORT * 0.625)}px;transform:scale(${scale})"
      ></iframe>
      <span class="hp__live-chip">Live</span>`;

    frame.append(layer);
    this.active.layer = layer;

    const iframe = layer.querySelector('iframe');
    iframe.addEventListener('load', () => layer.classList.add('is-in'), { once: true });
    // If the site never fires load, do not sit on a blank panel forever.
    setTimeout(() => layer.classList.add('is-in'), 4000);
  }
}
