import { chromium, devices } from 'playwright';

export const VIEWPORT = { width: 1440, height: 900 };

/**
 * Screenshot one live site.
 *
 * Notes on the choices here, because they are the difference between a
 * catalogue of hero shots and a catalogue of half-faded loading states:
 *
 * - Viewport-only, never fullPage. The grid wants the first screenful.
 * - We do not scroll. Most of these builds are pinned/scroll-driven; scrolling
 *   would advance a timeline and capture the middle of an animation.
 * - `reducedMotion: 'reduce'` makes well-behaved GSAP/CSS builds settle into
 *   their end state instead of being caught mid-transition.
 * - A settle delay after networkidle, because heavy 3D scenes finish compiling
 *   shaders well after the last request lands.
 */
export async function withBrowser(fn) {
  const browser = await chromium.launch({ args: ['--hide-scrollbars', '--force-color-profile=srgb'] });
  try {
    return await fn(browser);
  } finally {
    await browser.close();
  }
}

export async function capture(browser, url, { settleMs = 2600, timeoutMs = 45000, reducedMotion = true } = {}) {
  const context = await browser.newContext({
    ...devices['Desktop Chrome'],
    viewport: VIEWPORT,
    deviceScaleFactor: 2,
    colorScheme: 'dark',
    reducedMotion: reducedMotion ? 'reduce' : 'no-preference',
    ignoreHTTPSErrors: true,
  });

  const page = await context.newPage();
  page.setDefaultTimeout(timeoutMs);

  try {
    const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
    const status = response?.status() ?? 0;
    if (status >= 400) throw new Error(`HTTP ${status}`);

    await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
    await page.evaluate(() => document.fonts?.ready).catch(() => {});

    // Kill anything that would burn a hole in the thumbnail.
    await page.addStyleTag({
      content: `
        *, *::before, *::after { animation-play-state: paused !important; }
        ::-webkit-scrollbar { width: 0 !important; height: 0 !important; }
        html, body { scrollbar-width: none !important; }
      `,
    }).catch(() => {});

    await page.waitForTimeout(settleMs);

    // networkidle says requests stopped, not that pixels arrived. A 1600px hero
    // can still be decoding, and the shot then catches alt text where the image
    // should be — which reads as a broken page rather than a slow one.
    await page
      .waitForFunction(
        () =>
          [...document.images]
            .filter((img) => {
              const r = img.getBoundingClientRect();
              return r.top < innerHeight && r.bottom > 0 && r.width > 0;
            })
            .every((img) => img.complete && img.naturalWidth > 0),
        null,
        { timeout: 8000 },
      )
      .catch(() => {
        /* something above the fold never loads; capture what there is */
      });

    const buffer = await page.screenshot({ type: 'png', fullPage: false, animations: 'disabled' });
    const title = await page.title().catch(() => null);
    return { buffer, status, title };
  } finally {
    await context.close();
  }
}
