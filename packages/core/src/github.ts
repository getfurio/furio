import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { ARCHITECTURE_DIR } from '@getfurio/schema';
import type { RepoSource } from './build.js';
import { MAX_FILE_SIZE } from './files.js';

export interface CollectOptions {
  /** GitHub organization or user. */
  owner: string;
  /** Needs read access to the contents of the repos; public repos work without it. */
  token?: string;
  /** Where the `.architecture/` folders are written, one subfolder per repo. */
  outDir: string;
  apiUrl?: string;
  fetch?: typeof fetch;
  concurrency?: number;
  /**
   * Also list the private repos that have no manifest (or are empty or archived). Off by
   * default: the model is often published where anyone can read it, and those repos never
   * asked to be on it; not even their names should leak.
   */
  listPrivate?: boolean;
}

export interface SkippedRepo {
  id: string;
  url: string;
  reason: 'no-manifest' | 'empty' | 'archived';
}

export interface CollectResult {
  sources: RepoSource[];
  skipped: SkippedRepo[];
  /** Private repos without a manifest that were left out of `skipped` (see `listPrivate`). */
  unlisted: number;
}

interface ApiRepo {
  name: string;
  full_name: string;
  html_url: string;
  default_branch: string;
  archived: boolean;
  disabled?: boolean;
  private?: boolean;
}

interface TreeEntry {
  path: string;
  type: 'blob' | 'tree' | 'commit';
  sha: string;
  size?: number;
}

const COLLECTED_EXTENSIONS = /\.(ya?ml|mmd|md)$/i;
/** Each file is one API request: a folder stuffed with files must not use up the rate limit. */
const MAX_FILES_PER_REPO = 300;

export class GitHubError extends Error {}

/**
 * Downloads the `.architecture/` folder of every repo of a GitHub owner, from the default branch.
 * Only that folder is read: Furio never needs the code.
 */
export async function collectFromGitHub(options: CollectOptions): Promise<CollectResult> {
  const api = new GitHubApi(options);
  const repos = await api.listRepos(options.owner);
  const sources: RepoSource[] = [];
  const skipped: SkippedRepo[] = [];
  let unlisted = 0;

  await mapLimit(repos, options.concurrency ?? 6, async (repo) => {
    const base = { id: repo.full_name, url: repo.html_url };
    const skip = (reason: SkippedRepo['reason']) => {
      if (repo.private && !options.listPrivate) unlisted++;
      else skipped.push({ ...base, reason });
    };
    if (repo.archived || repo.disabled) return skip('archived');
    // Not repo.size: GitHub updates it lazily, a freshly pushed repo still reports 0.
    const branch = await api.get<{ commit: { sha: string; commit: { tree: { sha: string } } } }>(
      `/repos/${repo.full_name}/branches/${encodeURIComponent(repo.default_branch)}`,
      { allow404: true, allow409: true },
    );
    if (!branch) return skip('empty');

    const root = await api.get<{ tree: TreeEntry[] }>(
      `/repos/${repo.full_name}/git/trees/${branch.commit.commit.tree.sha}`,
    );
    const folder = root!.tree.find((e) => e.path === ARCHITECTURE_DIR && e.type === 'tree');
    if (!folder) return skip('no-manifest');

    const tree = await api.get<{ tree: TreeEntry[]; truncated: boolean }>(
      `/repos/${repo.full_name}/git/trees/${folder.sha}?recursive=1`,
    );
    const depth = (path: string) => path.split('/').length;
    const files = tree!.tree
      .filter(
        (e) =>
          e.type === 'blob' && COLLECTED_EXTENSIONS.test(e.path) && (e.size ?? 0) <= MAX_FILE_SIZE,
      )
      // The manifest and what sits next to it first, if the folder has more files than the limit.
      .sort((a, b) => depth(a.path) - depth(b.path) || a.path.localeCompare(b.path))
      .slice(0, MAX_FILES_PER_REPO);
    const dir = join(options.outDir, repo.name);
    for (const file of files) {
      const blob = await api.get<{ content: string; encoding: string }>(
        `/repos/${repo.full_name}/git/blobs/${file.sha}`,
      );
      const target = join(dir, ARCHITECTURE_DIR, file.path);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, Buffer.from(blob!.content, blob!.encoding as BufferEncoding));
    }
    sources.push({ ...base, dir, commit: branch.commit.sha });
  });

  sources.sort((a, b) => a.id.localeCompare(b.id));
  skipped.sort((a, b) => a.id.localeCompare(b.id));
  return { sources, skipped, unlisted };
}

class GitHubApi {
  private readonly base: string;
  private readonly fetch: typeof fetch;

  constructor(private readonly options: CollectOptions) {
    this.base = (options.apiUrl ?? 'https://api.github.com').replace(/\/$/, '');
    this.fetch = options.fetch ?? fetch;
  }

  async listRepos(owner: string): Promise<ApiRepo[]> {
    const org = await this.getAll<ApiRepo>(`/orgs/${owner}/repos?type=all&per_page=100`, true);
    return (
      org ?? (await this.getAll<ApiRepo>(`/users/${owner}/repos?type=owner&per_page=100`, false))!
    );
  }

  private async getAll<T>(path: string, allow404: boolean): Promise<T[] | undefined> {
    const out: T[] = [];
    let url: string | undefined = this.base + path;
    while (url) {
      const response = await this.request(url);
      if (response.status === 404 && allow404) return undefined;
      await this.ensureOk(response, url);
      out.push(...((await response.json()) as T[]));
      url = /<([^>]+)>;\s*rel="next"/.exec(response.headers.get('link') ?? '')?.[1];
    }
    return out;
  }

  async get<T>(
    path: string,
    allow: { allow404?: boolean; allow409?: boolean } = {},
  ): Promise<T | undefined> {
    const url = this.base + path;
    const response = await this.request(url);
    if (
      (response.status === 404 && allow.allow404) ||
      (response.status === 409 && allow.allow409)
    ) {
      return undefined;
    }
    await this.ensureOk(response, url);
    return (await response.json()) as T;
  }

  private request(url: string) {
    const headers: Record<string, string> = {
      accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
      'user-agent': 'furio',
    };
    if (this.options.token) headers.authorization = `Bearer ${this.options.token}`;
    return this.fetch(url, { headers });
  }

  private async ensureOk(response: Response, url: string) {
    if (response.ok) return;
    const body = await response.text().catch(() => '');
    const detail = /"message"\s*:\s*"([^"]+)"/.exec(body)?.[1] ?? response.statusText;
    const path = url.slice(this.base.length);
    if (response.status === 401) {
      throw new GitHubError(
        `GitHub rejected the token (401 on ${path}): ${detail}. Check that it exists and has not expired.`,
      );
    }
    if (response.status === 403 || response.status === 429) {
      throw new GitHubError(
        `GitHub refused ${path} (${response.status}): ${detail}. The token may lack "Contents: read" on this repo, or the rate limit was hit.`,
      );
    }
    throw new GitHubError(`GitHub API error ${response.status} on ${path}: ${detail}`);
  }
}

async function mapLimit<T>(items: T[], limit: number, fn: (item: T) => Promise<void>) {
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) await fn(items[next++]!);
  });
  await Promise.all(workers);
}
