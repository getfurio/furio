import { mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { collectFromGitHub, GitHubError } from '../src/index.js';

const API = 'https://api.github.test';
const b64 = (text: string) => Buffer.from(text).toString('base64');

/** A fake GitHub API with one repo with a manifest, one without, one empty and one archived. */
function fakeGitHub(overrides: Record<string, () => Response> = {}) {
  const calls: { url: string; auth?: string }[] = [];
  const json = (body: unknown, init: ResponseInit = {}) =>
    new Response(JSON.stringify(body), { status: 200, ...init });
  const repo = (name: string, extra: object = {}) => ({
    name,
    full_name: `acme/${name}`,
    html_url: `https://github.com/acme/${name}`,
    default_branch: 'main',
    archived: false,
    ...extra,
  });
  const routes: Record<string, () => Response> = {
    '/orgs/acme/repos?type=all&per_page=100': () =>
      json([repo('api'), repo('legacy')], {
        headers: { link: `<${API}/orgs/acme/repos?page=2>; rel="next"` },
      }),
    '/orgs/acme/repos?page=2': () => json([repo('empty'), repo('old', { archived: true })]),
    '/repos/acme/api/branches/main': () =>
      json({ commit: { sha: 'c1', commit: { tree: { sha: 'root-api' } } } }),
    '/repos/acme/legacy/branches/main': () =>
      json({ commit: { sha: 'c2', commit: { tree: { sha: 'root-legacy' } } } }),
    '/repos/acme/api/git/trees/root-api': () =>
      json({
        tree: [
          { path: 'src', type: 'tree', sha: 's' },
          { path: '.architecture', type: 'tree', sha: 'arch' },
        ],
      }),
    '/repos/acme/legacy/git/trees/root-legacy': () =>
      json({ tree: [{ path: 'src', type: 'tree', sha: 's' }] }),
    '/repos/acme/api/git/trees/arch?recursive=1': () =>
      json({
        truncated: false,
        tree: [
          { path: 'architecture.yaml', type: 'blob', sha: 'm', size: 40 },
          { path: 'diagrams', type: 'tree', sha: 'd' },
          { path: 'diagrams/flow.mmd', type: 'blob', sha: 'f', size: 10 },
          { path: 'logo.png', type: 'blob', sha: 'p', size: 10 },
        ],
      }),
    '/repos/acme/api/git/blobs/m': () =>
      json({ encoding: 'base64', content: b64('version: 1\nproject: shop\n') }),
    '/repos/acme/api/git/blobs/f': () =>
      json({ encoding: 'base64', content: b64('graph LR; a-->b') }),
    ...overrides,
  };
  const fetch = (async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    const headers = (init?.headers ?? {}) as Record<string, string>;
    calls.push({ url, ...(headers.authorization ? { auth: headers.authorization } : {}) });
    const route = routes[url.slice(API.length)];
    return route ? route() : new Response('{"message":"Not Found"}', { status: 404 });
  }) as typeof globalThis.fetch;
  return { fetch, calls };
}

describe('collectFromGitHub', () => {
  it('downloads only the .architecture folder of each repo, across pages', async () => {
    const { fetch, calls } = fakeGitHub();
    const outDir = mkdtempSync(join(tmpdir(), 'furio-collect-test-'));
    const result = await collectFromGitHub({
      owner: 'acme',
      token: 't0k',
      outDir,
      apiUrl: API,
      fetch,
    });

    expect(result.sources).toEqual([
      {
        id: 'acme/api',
        url: 'https://github.com/acme/api',
        dir: join(outDir, 'api'),
        commit: 'c1',
      },
    ]);
    expect(result.skipped).toEqual([
      { id: 'acme/empty', url: 'https://github.com/acme/empty', reason: 'empty' },
      { id: 'acme/legacy', url: 'https://github.com/acme/legacy', reason: 'no-manifest' },
      { id: 'acme/old', url: 'https://github.com/acme/old', reason: 'archived' },
    ]);
    expect(readFileSync(join(outDir, 'api/.architecture/architecture.yaml'), 'utf8')).toContain(
      'project: shop',
    );
    expect(readFileSync(join(outDir, 'api/.architecture/diagrams/flow.mmd'), 'utf8')).toBe(
      'graph LR; a-->b',
    );
    expect(calls.some((c) => c.url.includes('/blobs/p'))).toBe(false);
    expect(calls.every((c) => c.auth === 'Bearer t0k')).toBe(true);
  });

  it('falls back to a user account', async () => {
    const { fetch } = fakeGitHub({
      '/orgs/acme/repos?type=all&per_page=100': () => new Response('{}', { status: 404 }),
      '/users/acme/repos?type=owner&per_page=100': () => new Response('[]', { status: 200 }),
    });
    const outDir = mkdtempSync(join(tmpdir(), 'furio-collect-test-'));
    const result = await collectFromGitHub({ owner: 'acme', outDir, apiUrl: API, fetch });
    expect(result).toEqual({ sources: [], skipped: [], unlisted: 0 });
  });

  it('keeps the names of private repos without a manifest out of the result, unless asked', async () => {
    const repo = (name: string, extra: object) => ({
      name,
      full_name: `acme/${name}`,
      html_url: `https://github.com/acme/${name}`,
      default_branch: 'main',
      archived: false,
      ...extra,
    });
    const routes = {
      '/orgs/acme/repos?type=all&per_page=100': () =>
        new Response(
          JSON.stringify([
            repo('api', { private: true }),
            repo('legacy', { private: true }),
            repo('secret-deal', { private: true, archived: true }),
            repo('empty', {}),
          ]),
        ),
    };
    const collect = (listPrivate?: boolean) =>
      collectFromGitHub({
        owner: 'acme',
        outDir: mkdtempSync(join(tmpdir(), 'furio-collect-test-')),
        apiUrl: API,
        fetch: fakeGitHub(routes).fetch,
        ...(listPrivate ? { listPrivate } : {}),
      });

    const result = await collect();
    // A private repo with a manifest chose to be on the map; the others never did.
    expect(result.sources.map((s) => s.id)).toEqual(['acme/api']);
    expect(result.skipped.map((s) => s.id)).toEqual(['acme/empty']);
    expect(result.unlisted).toBe(2);

    const all = await collect(true);
    expect(all.skipped.map((s) => s.id)).toEqual(['acme/empty', 'acme/legacy', 'acme/secret-deal']);
    expect(all.unlisted).toBe(0);
  });

  it('downloads a limited number of files from one repo', async () => {
    const many = Array.from({ length: 400 }, (_, i) => ({
      path: `notes/n${String(i).padStart(3, '0')}.md`,
      type: 'blob',
      sha: 'f',
      size: 10,
    }));
    const { fetch, calls } = fakeGitHub({
      '/orgs/acme/repos?type=all&per_page=100': () =>
        new Response(
          JSON.stringify([
            {
              name: 'api',
              full_name: 'acme/api',
              html_url: 'https://github.com/acme/api',
              default_branch: 'main',
              archived: false,
            },
          ]),
        ),
      '/repos/acme/api/git/trees/arch?recursive=1': () =>
        new Response(
          JSON.stringify({
            truncated: false,
            tree: [...many, { path: 'architecture.yaml', type: 'blob', sha: 'm', size: 40 }],
          }),
        ),
    });
    const outDir = mkdtempSync(join(tmpdir(), 'furio-collect-test-'));
    await collectFromGitHub({ owner: 'acme', outDir, apiUrl: API, fetch });
    expect(calls.filter((c) => c.url.includes('/git/blobs/'))).toHaveLength(300);
    // The manifest comes first, whatever its place in the listing.
    expect(readFileSync(join(outDir, 'api/.architecture/architecture.yaml'), 'utf8')).toContain(
      'project: shop',
    );
  });

  it('follows pages on the host of the API only, where the token belongs', async () => {
    const { fetch, calls } = fakeGitHub({
      '/orgs/acme/repos?type=all&per_page=100': () =>
        new Response('[]', {
          headers: { link: '<https://elsewhere.test/orgs/acme/repos?page=2>; rel="next"' },
        }),
    });
    const outDir = mkdtempSync(join(tmpdir(), 'furio-collect-test-'));
    const promise = collectFromGitHub({ owner: 'acme', token: 't0k', outDir, apiUrl: API, fetch });
    await expect(promise).rejects.toThrow(GitHubError);
    await expect(promise).rejects.toThrow(/another host \(https:\/\/elsewhere\.test/);
    expect(calls.every((c) => c.url.startsWith(API))).toBe(true);
  });

  it('writes nothing outside the folder of a repo', async () => {
    const escape = (path: string) => ({ path, type: 'blob', sha: 'f', size: 10 });
    const { fetch, calls } = fakeGitHub({
      '/orgs/acme/repos?type=all&per_page=100': () =>
        new Response(
          JSON.stringify([
            {
              name: 'api',
              full_name: 'acme/api',
              html_url: 'https://github.com/acme/api',
              default_branch: 'main',
              archived: false,
            },
          ]),
        ),
      '/repos/acme/api/git/trees/arch?recursive=1': () =>
        new Response(
          JSON.stringify({
            truncated: false,
            tree: [
              { path: 'architecture.yaml', type: 'blob', sha: 'm', size: 40 },
              escape('../../outside.md'),
              escape('diagrams/../../../outside.md'),
              escape('..\\..\\outside.md'),
            ],
          }),
        ),
    });
    const outDir = mkdtempSync(join(tmpdir(), 'furio-collect-test-'));
    await collectFromGitHub({
      owner: 'acme',
      outDir: join(outDir, 'collected'),
      apiUrl: API,
      fetch,
    });
    expect(calls.filter((c) => c.url.includes('/git/blobs/')).map((c) => c.url)).toEqual([
      `${API}/repos/acme/api/git/blobs/m`,
    ]);
    expect(readdirSync(outDir)).toEqual(['collected']);
    expect(readdirSync(join(outDir, 'collected'))).toEqual(['api']);
  });

  it('refuses a repo name that is a path', async () => {
    const { fetch } = fakeGitHub({
      '/orgs/acme/repos?type=all&per_page=100': () =>
        new Response(
          JSON.stringify([
            {
              name: '../api',
              full_name: 'acme/api',
              html_url: 'https://github.com/acme/api',
              default_branch: 'main',
              archived: false,
            },
          ]),
        ),
    });
    const outDir = mkdtempSync(join(tmpdir(), 'furio-collect-test-'));
    const promise = collectFromGitHub({ owner: 'acme', outDir, apiUrl: API, fetch });
    await expect(promise).rejects.toThrow(/"\.\.\/api" is not a repo name/);
  });

  it('explains authentication failures', async () => {
    const { fetch } = fakeGitHub({
      '/orgs/acme/repos?type=all&per_page=100': () =>
        new Response('{"message":"Bad credentials"}', { status: 401 }),
    });
    const outDir = mkdtempSync(join(tmpdir(), 'furio-collect-test-'));
    const promise = collectFromGitHub({ owner: 'acme', token: 'x', outDir, apiUrl: API, fetch });
    await expect(promise).rejects.toThrow(GitHubError);
    await expect(promise).rejects.toThrow(/rejected the token.*Bad credentials/);
  });
});
