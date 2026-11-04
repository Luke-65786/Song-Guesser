import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const cwd = fileURLToPath(new URL('../', import.meta.url));
const git = (...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();

try {
  if (git('status', '--porcelain', '--', 'public')) throw new Error('Commit all public/ changes before publishing.');
  const source = git('rev-parse', '--verify', 'HEAD');
  const tree = git('rev-parse', '--verify', 'HEAD:public');
  const remote = git('ls-remote', 'origin', 'refs/heads/gh-pages');
  const parents = [];
  if (remote) {
    git('fetch', '--no-tags', 'origin', 'gh-pages');
    const parent = git('rev-parse', '--verify', 'FETCH_HEAD^{commit}');
    if (git('rev-parse', `${parent}^{tree}`) === tree) { console.log('GitHub Pages already contains the current public/ files.'); process.exit(0); }
    parents.push('-p', parent);
  }
  const commit = git('commit-tree', tree, ...parents, '-m', `Publish Offbeat from ${source.slice(0, 7)}`);
  // A normal push preserves existing publishing history and rejects concurrent updates.
  execFileSync('git', ['push', 'origin', `${commit}:refs/heads/gh-pages`], { cwd, stdio: 'inherit' });
  console.log('Published static files to gh-pages. Enable that branch in repository Settings → Pages if needed.');
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
