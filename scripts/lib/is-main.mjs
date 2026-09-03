import { pathToFileURL } from 'node:url';

/** True when the module at `metaUrl` is the script node was launched with. */
export function isMain(metaUrl) {
  const entry = process.argv[1];
  if (!entry) return false;
  return metaUrl === pathToFileURL(entry).href;
}
