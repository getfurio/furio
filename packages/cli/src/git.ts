import { execFileSync } from 'node:child_process';

/** Runs git in `cwd`; undefined when git is missing, the folder is not a repo, or git fails. */
function git(cwd: string, args: string[]): string | undefined {
  try {
    return execFileSync('git', ['-C', cwd, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return undefined;
  }
}

/** "owner/name" from a GitHub remote URL (https or ssh), or undefined. */
export function parseGitHubRemote(url: string): string | undefined {
  const match = /github\.com[:/]([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/.exec(url.trim());
  return match ? `${match[1]}/${match[2]}` : undefined;
}

/** The GitHub repo of the `origin` remote, e.g. "acme/shop-api". */
export function githubRepoOf(root: string): string | undefined {
  const url = git(root, ['remote', 'get-url', 'origin']);
  return url ? parseGitHubRemote(url) : undefined;
}

/** Whether git tracks the file; undefined outside a git repo. */
export function isTracked(root: string, file: string): boolean | undefined {
  if (git(root, ['rev-parse', '--is-inside-work-tree']) !== 'true') return undefined;
  return git(root, ['ls-files', '--error-unmatch', '--', file]) !== undefined;
}
