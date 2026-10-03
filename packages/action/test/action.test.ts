import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildArgs,
  buildSummary,
  COMMENT_MARKER,
  commentFile,
  GitHubCommentError,
  outFile,
  upsertComment,
  uploadNote,
} from '../src/index.js';
import type { Model } from '@getfurio/core';

describe('Furio action', () => {
  it('validates the current repo by default', () => {
    expect(buildArgs({})).toEqual(['validate', '.']);
  });

  it('passes paths, model and flags to validate', () => {
    expect(
      buildArgs({
        INPUT_PATH: 'a b',
        INPUT_MODEL: 'https://x.dev/model.json',
        INPUT_STRICT: 'true',
      }),
    ).toEqual(['validate', 'a', 'b', '--model', 'https://x.dev/model.json', '--strict']);
  });

  it('builds the owner of the repo by default', () => {
    expect(buildArgs({ INPUT_COMMAND: 'build', GITHUB_REPOSITORY_OWNER: 'acme' })).toEqual([
      'build',
      '--github',
      'acme',
      '--out',
      '_furio/model.json',
      '--site',
    ]);
    expect(
      buildArgs({ INPUT_COMMAND: 'build', INPUT_GITHUB: 'acme', INPUT_SITE: 'false' }),
    ).not.toContain('--site');
    expect(outFile({ INPUT_OUT: 'site/data.json' })).toBe('site/data.json');
  });

  it('lists private repos without a manifest only when asked', () => {
    const env = { INPUT_COMMAND: 'build', INPUT_GITHUB: 'acme' };
    expect(buildArgs(env)).not.toContain('--list-private');
    expect(buildArgs({ ...env, 'INPUT_LIST-PRIVATE': 'true' })).toContain('--list-private');
  });

  it('rejects unknown commands', () => {
    expect(() => buildArgs({ INPUT_COMMAND: 'deploy' })).toThrow(/Unknown command/);
  });

  it('summarizes a build for the job page', () => {
    const model = {
      workspace: { id: 'acme' },
      components: [{ ghost: false }, { ghost: true }],
      relations: [{}],
      diagrams: [],
      repos: [
        {
          id: 'acme/api',
          url: 'https://github.com/acme/api',
          project: 'shop',
          status: 'valid',
          errors: 0,
          warnings: 1,
        },
        { id: 'acme/old', status: 'skipped', skipReason: 'no-manifest', errors: 0, warnings: 0 },
      ],
      issues: [
        {
          repo: 'acme/api',
          severity: 'warning',
          code: 'unresolved-reference',
          message: 'm',
          file: 'f',
          line: 3,
        },
      ],
    } as unknown as Model;
    const summary = buildSummary(model);
    expect(summary).toContain('1 components, 1 relations, 0 diagrams, 1 ghost components.');
    expect(summary).toContain('| [acme/api](https://github.com/acme/api) | shop | valid | 0 | 1 |');
    expect(summary).toContain('skipped (no-manifest)');
    expect(summary).toContain('- **warning** `acme/api` f:3: m');
  });
});

describe('the committed map', () => {
  it('holds the built map and nothing else', () => {
    // The bundle is public: a model or any other local file must never ride along.
    const site = join(import.meta.dirname, '../site');
    expect(readdirSync(site).sort()).toEqual(['assets', 'favicon.svg', 'index.html']);
    const assets = readdirSync(join(site, 'assets'));
    expect(assets.filter((name) => !/^[\w.-]+\.(js|css|woff2)$/.test(name))).toEqual([]);
  });
});

describe('output: furio', () => {
  const push = {
    INPUT_OUTPUT: 'furio',
    GITHUB_EVENT_NAME: 'push',
    GITHUB_REF: 'refs/heads/main',
  };
  const event = { repository: { default_branch: 'main' } };

  it('uploads on a push to the default branch', () => {
    expect(buildArgs(push, event)).toEqual(['upload', '.']);
    expect(
      buildArgs(
        { ...push, INPUT_PATH: 'svc', 'INPUT_FURIO-URL': 'https://x.test', INPUT_PLAIN: 'true' },
        event,
      ),
    ).toEqual(['upload', 'svc', '--url', 'https://x.test', '--plain']);
  });

  it('previews pull requests for the architecture comment', () => {
    const pr = { ...push, GITHUB_EVENT_NAME: 'pull_request', RUNNER_TEMP: '/tmp/r' };
    expect(buildArgs(pr, event)).toEqual([
      'upload',
      '.',
      '--preview',
      '/tmp/r/furio-pr-comment.md',
    ]);
    expect(commentFile(pr)).toBe('/tmp/r/furio-pr-comment.md');
  });

  it('only validates other branches', () => {
    expect(buildArgs({ ...push, GITHUB_REF: 'refs/heads/feature' }, event)[0]).toBe('validate');
    expect(buildArgs(push, {})[0]).toBe('validate');
  });

  it('says why a run only validates', () => {
    const dev = { repository: { default_branch: 'dev' } };
    expect(uploadNote(push, dev)).toBe(
      'Push on `main`, not `dev`, the default branch: validation only, nothing uploaded. To upload, trigger the workflow on pushes to `dev`.',
    );
    expect(uploadNote({ ...push, GITHUB_EVENT_NAME: 'pull_request' }, dev)).toBe(
      'Pull request: checked, and compared with the map for an architecture comment (Furio Cloud Business). Furio Cloud receives the manifest on pushes to `dev`, the default branch.',
    );
    expect(uploadNote(push, event)).toBeUndefined();
    expect(uploadNote({ ...push, INPUT_OUTPUT: 'none' }, dev)).toBeUndefined();
  });

  it('uploads one repo at a time and knows its outputs', () => {
    expect(() => buildArgs({ ...push, INPUT_PATH: 'a b' }, event)).toThrow(/single path/);
    expect(() => buildArgs({ INPUT_OUTPUT: 'pages' })).toThrow(/Unknown output/);
  });
});

describe('pull request comment', () => {
  const target = { apiUrl: 'https://api.github.test', token: 't', repo: 'acme/a', number: 7 };
  const github = (
    comments: { id: number; body: string; user?: { login: string } }[],
    status = 200,
  ) => {
    const calls: { url: string; method: string; body?: string }[] = [];
    const impl = (async (url: string, init: RequestInit = {}) => {
      calls.push({
        url,
        method: init.method ?? 'GET',
        ...(init.body ? { body: init.body as string } : {}),
      });
      if (url.endsWith('/user')) return new Response('{}', { status: 403 });
      if (status !== 200) return new Response('{}', { status });
      return new Response(init.method ? '{}' : JSON.stringify(comments), { status: 200 });
    }) as typeof fetch;
    return { calls, impl };
  };

  it('creates the comment the first time', async () => {
    const { calls, impl } = github([{ id: 1, body: 'LGTM' }]);
    expect(await upsertComment(target, `${COMMENT_MARKER}\nhello`, impl)).toBe('created');
    expect(calls.at(-1)).toMatchObject({
      url: 'https://api.github.test/repos/acme/a/issues/7/comments',
      method: 'POST',
    });
  });

  it('updates its own comment on later pushes', async () => {
    const { calls, impl } = github([
      { id: 1, body: `${COMMENT_MARKER}\npasted by a person`, user: { login: 'mallory' } },
      { id: 42, body: `${COMMENT_MARKER}\nold`, user: { login: 'github-actions[bot]' } },
    ]);
    expect(await upsertComment(target, `${COMMENT_MARKER}\nnew`, impl)).toBe('updated');
    expect(calls.at(-1)).toMatchObject({
      url: 'https://api.github.test/repos/acme/a/issues/comments/42',
      method: 'PATCH',
    });
  });

  it('never takes over a comment a person wrote with the marker', async () => {
    const { calls, impl } = github([
      { id: 9, body: `${COMMENT_MARKER}\nhi`, user: { login: 'mallory' } },
    ]);
    expect(await upsertComment(target, `${COMMENT_MARKER}\nnew`, impl)).toBe('created');
    expect(calls.at(-1)?.method).toBe('POST');
  });

  it("does not touch another bot's comment either", async () => {
    const { calls, impl } = github([
      { id: 5, body: `${COMMENT_MARKER}\nx`, user: { login: 'some-app[bot]' } },
    ]);
    expect(await upsertComment(target, `${COMMENT_MARKER}\nnew`, impl)).toBe('created');
    expect(calls.at(-1)?.method).toBe('POST');
  });

  it('explains a missing permission', async () => {
    const { impl } = github([], 403);
    await expect(upsertComment(target, 'x', impl)).rejects.toThrow(/pull-requests: write/);
    await expect(upsertComment(target, 'x', impl)).rejects.toBeInstanceOf(GitHubCommentError);
  });
});
