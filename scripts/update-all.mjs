#!/usr/bin/env node
/**
 * The button.
 *
 * One press does the whole round trip:
 *
 *   GitHub  ->  data  ->  screenshots  ->  dashboard/  ->  git  ->  Pages
 *
 * Everything it runs is also available as a separate npm script; this only
 * removes the need to remember the order.
 *
 *   node scripts/update-all.mjs
 *   node scripts/update-all.mjs --no-push     local only, touch nothing remote
 *   node scripts/update-all.mjs --no-open     do not open the dashboard at the end
 *   node scripts/update-all.mjs --force       recapture every screenshot
 */
import { execFileSync, execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { sync } from './sync-github.mjs';
import { scanLocal } from './scan-local.mjs';
import { captureThumbnails } from './screenshots.mjs';
import { capturePageThumbnails } from './page-shots.mjs';
import { buildDashboard } from './build-dashboard.mjs';
import { buildCatalog } from './lib/catalog.mjs';
import { prune, reportPrune } from './lib/prune.mjs';
import { ROOT } from './lib/paths.mjs';
import { log } from './lib/log.mjs';

const args = process.argv.slice(2);
const flag = (n) => args.includes(`--${n}`);

const git = (cmd, { quiet = true } = {}) =>
  execSync(`git ${cmd}`, { cwd: ROOT, encoding: 'utf8', stdio: quiet ? 'pipe' : 'inherit' }).trim();

/** The Action only ever rewrites these; a clash here is not a real conflict. */
const GENERATED = [/^data\//, /^public\/thumbnails\//];

function hasRemote() {
  try {
    return Boolean(git('remote get-url origin'));
  } catch {
    return false;
  }
}

/**
 * Brings the local branch up to date with whatever the scheduled Action
 * committed. Both sides only ever touch generated files, and the local copy was
 * just regenerated, so local wins — but only for files we know are generated. A
 * clash anywhere else stops the run rather than silently discarding work.
 */
function rebaseOntoRemote() {
  git('fetch origin main');

  const behind = git('rev-list --count HEAD..origin/main');
  if (behind === '0') return true;

  log.dim(`${behind} commit(s) from the scheduled run — rebasing`);

  try {
    git('rebase origin/main');
    return true;
  } catch {
    const conflicted = git('diff --name-only --diff-filter=U')
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);

    const unexpected = conflicted.filter((f) => !GENERATED.some((re) => re.test(f)));
    if (unexpected.length) {
      git('rebase --abort');
      log.err(`conflict in files this script will not resolve: ${unexpected.join(', ')}`);
      log.info('resolve it by hand, then run the update again');
      return false;
    }

    for (const file of conflicted) {
      // "theirs" during a rebase is the commit being replayed: the local one.
      try {
        git(`checkout --theirs "${file}"`);
      } catch {
        /* deleted on one side; staging the removal is enough */
      }
      git(`add "${file}"`);
    }
    execSync('git -c core.editor=true rebase --continue', { cwd: ROOT, stdio: 'pipe' });
    log.dim(`resolved ${conflicted.length} generated file(s) in favour of this machine`);
    return true;
  }
}

function commitLocal(summary) {
  git('add -A');

  const staged = git('diff --staged --name-only');
  if (!staged) {
    log.dim('nothing changed locally');
    return false;
  }

  const count = staged.split('\n').filter(Boolean).length;
  execFileSync('git', ['commit', '-q', '-m', `chore: refresh catalog — ${summary}`], {
    cwd: ROOT,
    stdio: 'pipe',
  });
  log.ok(`committed ${count} changed file(s)`);
  return true;
}

function push(committed) {
  const ahead = git('rev-list --count origin/main..HEAD');
  if (ahead === '0') {
    if (!committed) log.dim('already up to date with GitHub');
    return false;
  }

  git('push origin main');
  log.ok(`pushed ${ahead} commit(s) to GitHub`);
  return true;
}

function triggerDeploy() {
  try {
    execFileSync('gh', ['workflow', 'run', 'catalog.yml'], { cwd: ROOT, stdio: 'pipe' });
    log.ok('deploy started — the live dashboard updates in about two minutes');
  } catch {
    log.warn('could not start the deploy (is the GitHub CLI signed in?)');
    log.dim('the scheduled daily run will pick it up regardless');
  }
}

/* ── run ─────────────────────────────────────────────────────────────────── */

const started = Date.now();

try {
  const repos = await sync();

  log.step('Removing what is gone');
  reportPrune(prune(repos, { isAuthoritative: true }));

  scanLocal();
  await captureThumbnails({ force: flag('force') });
  await capturePageThumbnails({ force: flag('force') });

  const { catalog } = buildDashboard();
  const { total, withPreview, variants } = catalog.counts;
  const summary = `${total} projects, ${variants} versions`;

  if (!flag('no-push')) {
    log.step('Publishing');
    if (!hasRemote()) {
      log.warn('no git remote — skipping publish');
    } else {
      // Commit before rebasing: git refuses to rebase over a dirty tree, and
      // this run has just regenerated half the repository.
      const committed = commitLocal(summary);
      if (rebaseOntoRemote() && push(committed)) triggerDeploy();
    }
  }

  log.step('Done');
  log.info(`${total} projects · ${withPreview} live previews · ${variants} versions`);
  log.info(`open  ${path.join(ROOT, 'dashboard', 'index.html')}`);
  if (!flag('no-push')) log.info('live  https://sigovs.github.io/DASHBOARD-GIT-SIGOFF/');

  if (!flag('no-open')) {
    const page = path.join(ROOT, 'dashboard', 'index.html');
    if (fs.existsSync(page)) {
      try {
        execSync(`start "" "${page}"`, { cwd: ROOT, shell: 'cmd.exe', stdio: 'ignore' });
      } catch {
        /* not Windows, or no shell association — the path is printed above */
      }
    }
  }

  log.done(`Finished in ${((Date.now() - started) / 1000).toFixed(0)}s`);
} catch (err) {
  log.err(err.message);
  process.exit(1);
}
