/**
 * How the catalog is being presented.
 *
 * The same build serves two audiences. Internally it is a project index, and
 * repository names, clone URLs and local paths are the useful part. In front of
 * a client none of that belongs on screen — they came to look at their own site,
 * not at how it is stored.
 */
export const view = {
  client: false,
  brand: null,
};

export function setMode(catalog) {
  view.client = catalog?.mode === 'client';
  view.brand = catalog?.brand || null;
  document.body.classList.toggle('is-client', view.client);
}
