import { execFileSync } from 'node:child_process';
import { log } from './log.mjs';

const API = 'https://api.github.com';

/**
 * Token resolution, best first:
 *   1. GITHUB_TOKEN / GH_TOKEN environment variable (set by .env or CI)
 *   2. the GitHub CLI, if the user is already logged in locally
 *   3. none — public repositories only, 60 requests/hour
 *
 * The token never leaves Node. Nothing here runs in the browser.
 */
export function resolveToken() {
  const fromEnv = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  if (fromEnv && fromEnv.trim()) return { token: fromEnv.trim(), source: 'environment' };

  try {
    const token = execFileSync('gh', ['auth', 'token'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    if (token) return { token, source: 'gh cli' };
  } catch {
    /* gh not installed or not logged in */
  }

  return { token: null, source: 'anonymous' };
}

export class GitHub {
  constructor(token) {
    this.token = token;
    this.calls = 0;
    this.rateRemaining = null;
  }

  async request(pathOrUrl, { raw = false } = {}) {
    const url = pathOrUrl.startsWith('http') ? pathOrUrl : `${API}${pathOrUrl}`;
    const headers = {
      Accept: raw ? 'application/vnd.github.raw' : 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'sigovs-project-catalog',
    };
    if (this.token) headers.Authorization = `Bearer ${this.token}`;

    const res = await fetch(url, { headers });
    this.calls += 1;
    const remaining = res.headers.get('x-ratelimit-remaining');
    if (remaining !== null) this.rateRemaining = Number(remaining);

    if (res.status === 404) return { ok: false, status: 404, data: null, res };
    if (res.status === 403 && this.rateRemaining === 0) {
      const reset = Number(res.headers.get('x-ratelimit-reset') || 0) * 1000;
      throw new Error(
        `GitHub rate limit exhausted. Resets ${new Date(reset).toLocaleTimeString()}. ` +
        `Set GITHUB_TOKEN in .env (or run \`gh auth login\`) to raise the limit to 5000/hour.`,
      );
    }
    if (!res.ok) return { ok: false, status: res.status, data: null, res };

    return { ok: true, status: res.status, data: raw ? await res.text() : await res.json(), res };
  }

  /** Follows RFC-5988 `Link: rel="next"` until the collection is exhausted. */
  async paginate(path) {
    const out = [];
    let url = path;
    while (url) {
      const { ok, data, res } = await this.request(url);
      if (!ok || !Array.isArray(data)) break;
      out.push(...data);
      const link = res.headers.get('link') || '';
      const next = /<([^>]+)>;\s*rel="next"/.exec(link);
      url = next ? next[1] : null;
    }
    return out;
  }

  /**
   * Every repository the account owns. Uses /user/repos when authenticated so
   * private repositories are included; falls back to the public endpoint.
   */
  async listOwnedRepos(owner) {
    if (this.token) {
      const mine = await this.paginate('/user/repos?per_page=100&affiliation=owner&sort=updated');
      const filtered = mine.filter((r) => r.owner?.login?.toLowerCase() === owner.toLowerCase());
      if (filtered.length) return filtered;
    }
    return this.paginate(`/users/${owner}/repos?per_page=100&sort=updated`);
  }

  /** GitHub Pages deployment info, or null when Pages is not enabled. */
  async getPages(fullName) {
    const { ok, data } = await this.request(`/repos/${fullName}/pages`);
    if (!ok || !data) return null;
    return {
      url: data.cname ? `https://${data.cname}/` : data.html_url,
      status: data.status,
      branch: data.source?.branch ?? null,
    };
  }

  /** Flat file list for a ref. Returns [] when the tree is missing or huge. */
  async getTree(fullName, ref) {
    const { ok, data } = await this.request(`/repos/${fullName}/git/trees/${encodeURIComponent(ref)}?recursive=1`);
    if (!ok || !Array.isArray(data?.tree)) return [];
    return data.tree.filter((n) => n.type === 'blob');
  }

  async getReadme(fullName) {
    const { ok, data } = await this.request(`/repos/${fullName}/readme`, { raw: true });
    return ok ? data : null;
  }
}

export function reportRate(gh) {
  const limit = gh.token ? '5000' : '60';
  log.dim(`${gh.calls} GitHub API calls · ${gh.rateRemaining ?? '?'}/${limit} remaining this hour`);
}
