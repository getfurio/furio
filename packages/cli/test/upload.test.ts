import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, cpSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { run, type Io } from '../src/main.js';
import { collectArchitectureFiles } from '../src/upload.js';

const ROOT = join(import.meta.dirname, '../../..');
const EXAMPLE = 'examples/demo/shop-api';
const TOKEN = 'furio_up_test';

interface Call {
  url: string;
  headers: Record<string, string>;
  body: { repo: string; commit?: string; files: Record<string, string> };
}

function fakeFetch(status: number, response: unknown, calls: Call[]): typeof fetch {
  return (async (url: string, init: RequestInit) => {
    calls.push({
      url,
      headers: init.headers as Record<string, string>,
      body: JSON.parse(init.body as string),
    });
    return new Response(JSON.stringify(response), { status });
  }) as typeof fetch;
}

async function cli(args: string[], env: Record<string, string>, fetchImpl?: typeof fetch) {
  let stdout = '';
  let stderr = '';
  const io: Io = {
    stdout: (t) => void (stdout += t),
    stderr: (t) => void (stderr += t),
    cwd: ROOT,
    env,
    isTTY: false,
    ...(fetchImpl ? { fetch: fetchImpl } : {}),
  };
  const code = await run(args, io);
  return { code, stdout, stderr };
}

describe('furio upload', () => {
  it('sends only the .architecture/ folder, with the token in a header', async () => {
    const calls: Call[] = [];
    const ok = { status: 'accepted', workspace: 'acme', map: '/w/acme/' };
    const { code, stdout } = await cli(
      ['upload', EXAMPLE, '--repo', 'acme/shop-api', '--commit', 'abc1234'],
      { FURIO_UPLOAD_TOKEN: TOKEN, FURIO_URL: 'https://cloud.test/' },
      fakeFetch(200, ok, calls),
    );
    expect(code).toBe(0);
    expect(stdout).toContain('Uploaded acme/shop-api');
    expect(stdout).toContain('https://cloud.test/w/acme/');
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe('https://cloud.test/api/v1/upload');
    expect(calls[0]!.headers.authorization).toBe(`Bearer ${TOKEN}`);
    expect(calls[0]!.body.repo).toBe('acme/shop-api');
    expect(calls[0]!.body.commit).toBe('abc1234');
    const paths = Object.keys(calls[0]!.body.files);
    expect(paths).toContain('.architecture/architecture.yaml');
    for (const path of paths) expect(path.startsWith('.architecture/')).toBe(true);
  });

  it('reads repo and commit from GitHub Actions', async () => {
    const calls: Call[] = [];
    await cli(
      ['upload', EXAMPLE],
      { FURIO_UPLOAD_TOKEN: TOKEN, GITHUB_REPOSITORY: 'acme/api', GITHUB_SHA: 'deadbeef' },
      fakeFetch(200, { workspace: 'acme', map: '/w/acme/' }, calls),
    );
    expect(calls[0]!.url).toBe('https://getfurio.com/api/v1/upload');
    expect(calls[0]!.body).toMatchObject({ repo: 'acme/api', commit: 'deadbeef' });
  });

  it('never uploads an invalid manifest', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'furio-upload-'));
    cpSync(join(ROOT, EXAMPLE, '.architecture'), join(dir, '.architecture'), { recursive: true });
    writeFileSync(join(dir, '.architecture/architecture.yaml'), 'version: 1\ncomponents: 3\n');
    const calls: Call[] = [];
    const { code, stderr } = await cli(
      ['upload', dir, '--repo', 'acme/a'],
      { FURIO_UPLOAD_TOKEN: TOKEN },
      fakeFetch(200, {}, calls),
    );
    expect(code).toBe(1);
    expect(calls).toHaveLength(0);
    expect(stderr).toContain('Not uploaded');
  });

  it('shows what the server refused, with its code and field', async () => {
    const { code, stderr } = await cli(
      ['upload', EXAMPLE, '--repo', 'acme/a'],
      { FURIO_UPLOAD_TOKEN: TOKEN },
      fakeFetch(403, { error: 'public-repos-only', message: 'Repo "acme/a" is private.' }, []),
    );
    expect(code).toBe(1);
    expect(stderr).toContain('[public-repos-only]: Repo "acme/a" is private.');
  });

  it('reports server-side diagnostics against the local files', async () => {
    const diagnostics = [
      {
        severity: 'error',
        code: 'duplicate-component',
        message: 'Component "shop/shop-api" is also declared by acme/other.',
        file: '.architecture/architecture.yaml',
        line: 7,
      },
    ];
    const { code, stdout } = await cli(
      ['upload', EXAMPLE, '--repo', 'acme/a'],
      { FURIO_UPLOAD_TOKEN: TOKEN },
      fakeFetch(422, { error: 'invalid-manifest', message: 'errors', diagnostics }, []),
    );
    expect(code).toBe(1);
    expect(stdout).toContain(`${EXAMPLE}/.architecture/architecture.yaml:7:1`);
    expect(stdout).toContain('also declared by acme/other');
  });

  it('exits 2 when the server is down or unreachable', async () => {
    const down = await cli(
      ['upload', EXAMPLE, '--repo', 'acme/a'],
      { FURIO_UPLOAD_TOKEN: TOKEN },
      fakeFetch(503, { error: 'github-unavailable', message: 'Retry later.' }, []),
    );
    expect(down.code).toBe(2);
    const unreachable = await cli(
      ['upload', EXAMPLE, '--repo', 'acme/a'],
      { FURIO_UPLOAD_TOKEN: TOKEN },
      (async () => {
        throw new Error('ECONNREFUSED');
      }) as typeof fetch,
    );
    expect(unreachable.code).toBe(2);
    expect(unreachable.stderr).toContain('ECONNREFUSED');
  });

  it('sends the token over https only, or to this machine', async () => {
    const calls: Call[] = [];
    const args = ['upload', EXAMPLE, '--repo', 'acme/a'];
    const env = { FURIO_UPLOAD_TOKEN: TOKEN };
    const flag = await cli([...args, '--url', 'http://cloud.test'], env, fakeFetch(200, {}, calls));
    expect(flag.code).toBe(2);
    expect(flag.stderr).toContain('--url (or FURIO_URL) must be an https address');
    const fromEnv = await cli(
      args,
      { ...env, FURIO_URL: 'http://cloud.test' },
      fakeFetch(200, {}, calls),
    );
    expect(fromEnv.code).toBe(2);
    expect(calls).toHaveLength(0);

    await cli([...args, '--url', 'http://localhost:8787'], env, fakeFetch(200, {}, calls));
    expect(calls[0]?.url).toBe('http://localhost:8787/api/v1/upload');
  });

  it('needs a token from the environment and a repo', async () => {
    const noToken = await cli(['upload', EXAMPLE, '--repo', 'acme/a'], {});
    expect(noToken.code).toBe(2);
    expect(noToken.stderr).toContain('FURIO_UPLOAD_TOKEN');
    const noRepo = await cli(['upload', copyOfExample()], { FURIO_UPLOAD_TOKEN: TOKEN });
    expect(noRepo.code).toBe(2);
    expect(noRepo.stderr).toContain('--repo');
  });

  it('falls back to the GitHub origin remote for the repo', async () => {
    const calls: Call[] = [];
    const dir = copyOfExample();
    execFileSync('git', ['init', '-q'], { cwd: dir });
    execFileSync('git', ['remote', 'add', 'origin', 'git@github.com:acme/shop-api.git'], {
      cwd: dir,
    });
    await cli(['upload', dir], { FURIO_UPLOAD_TOKEN: TOKEN }, fakeFetch(200, {}, calls));
    expect(calls[0]?.body.repo).toBe('acme/shop-api');
  });
});

describe('furio upload --dry-run', () => {
  it('asks Furio Cloud whether it would accept the upload, and sends nothing to store', async () => {
    const calls: Call[] = [];
    const answer = {
      workspace: 'acme',
      plan: 'free',
      project: 'shop',
      newRepo: true,
      map: '/w/acme/',
    };
    const { code, stdout } = await cli(
      ['upload', EXAMPLE, '--dry-run', '--repo', 'acme/shop-api'],
      { FURIO_UPLOAD_TOKEN: TOKEN },
      fakeFetch(200, answer, calls),
    );
    expect(code).toBe(0);
    expect(calls.map((c) => c.url)).toEqual(['https://getfurio.com/api/v1/check']);
    expect(stdout).toContain('.architecture/architecture.yaml (');
    expect(stdout).toContain('Token accepted: workspace acme (free plan)');
    expect(stdout).toContain('would add acme/shop-api in project shop');
    expect(stdout).toContain('Dry run: nothing was uploaded.');
  });

  it('reports a refused token as the server says it', async () => {
    const { code, stderr } = await cli(
      ['upload', EXAMPLE, '--dry-run', '--repo', 'acme/a'],
      { FURIO_UPLOAD_TOKEN: TOKEN },
      fakeFetch(401, { error: 'invalid-token', message: 'Missing or unknown upload token.' }, []),
    );
    expect(code).toBe(1);
    expect(stderr).toContain('would refuse the upload [invalid-token]');
  });

  it('checks locally and lists the files when there is no token', async () => {
    const calls: Call[] = [];
    const { code, stdout } = await cli(
      ['upload', EXAMPLE, '--dry-run', '--repo', 'acme/a'],
      {},
      fakeFetch(200, {}, calls),
    );
    expect(code).toBe(0);
    expect(calls).toHaveLength(0);
    expect(stdout).toContain('Would send');
    expect(stdout).toContain('FURIO_UPLOAD_TOKEN is not set');
  });

  it('says so when the server has no dry-run endpoint', async () => {
    const { code, stderr } = await cli(
      ['upload', EXAMPLE, '--dry-run', '--repo', 'acme/a'],
      { FURIO_UPLOAD_TOKEN: TOKEN },
      fakeFetch(404, {}, []),
    );
    expect(code).toBe(2);
    expect(stderr).toContain('does not support dry runs');
  });
});

describe('furio upload --preview (pull requests)', () => {
  const out = () => join(mkdtempSync(join(tmpdir(), 'furio-preview-')), 'comment.md');

  it('writes the comment Furio Cloud returns, without uploading', async () => {
    const calls: Call[] = [];
    const file = out();
    const { code, stdout } = await cli(
      ['upload', EXAMPLE, '--repo', 'acme/a', '--preview', file],
      { FURIO_UPLOAD_TOKEN: TOKEN },
      fakeFetch(200, { comment: '<!-- furio:pr-diff -->\n### Furio' }, calls),
    );
    expect(code).toBe(0);
    expect(calls[0]!.url).toBe('https://getfurio.com/api/v1/preview');
    expect(readFileSync(file, 'utf8')).toContain('furio:pr-diff');
    expect(stdout).toContain('Architecture comment for acme/a written to');
  });

  it('notes a plan without comments or an unreachable server, and passes', async () => {
    const file = out();
    const plan = await cli(
      ['upload', EXAMPLE, '--repo', 'acme/a', '--preview', file],
      { FURIO_UPLOAD_TOKEN: TOKEN },
      fakeFetch(402, { error: 'plan-required', message: 'Comes with Business.' }, []),
    );
    expect(plan.code).toBe(0);
    expect(plan.stdout).toContain('No architecture comment: Comes with Business.');
    expect(existsSync(file)).toBe(false);
    const down = await cli(
      ['upload', EXAMPLE, '--repo', 'acme/a', '--preview', file],
      { FURIO_UPLOAD_TOKEN: TOKEN },
      (async () => {
        throw new Error('ECONNREFUSED');
      }) as typeof fetch,
    );
    expect(down.code).toBe(0);
  });

  it('only validates without a token, as on pull requests from forks', async () => {
    const { code, stdout } = await cli(['upload', EXAMPLE, '--preview', out()], {});
    expect(code).toBe(0);
    expect(stdout).toContain('pull requests from forks get no secrets');
    expect(stdout).toContain('All tidy');
  });

  it('still fails on an invalid manifest', async () => {
    const dir = copyOfExample();
    writeFileSync(join(dir, '.architecture/architecture.yaml'), 'version: 1\ncomponents: 3\n');
    const { code } = await cli(
      ['upload', dir, '--repo', 'acme/a', '--preview', out()],
      { FURIO_UPLOAD_TOKEN: TOKEN },
      fakeFetch(200, {}, []),
    );
    expect(code).toBe(1);
  });
});

function copyOfExample(): string {
  const dir = mkdtempSync(join(tmpdir(), 'furio-upload-'));
  cpSync(join(ROOT, EXAMPLE, '.architecture'), join(dir, '.architecture'), { recursive: true });
  return dir;
}

it('collectArchitectureFiles never follows symbolic links, to files or to folders', () => {
  const dir = copyOfExample();
  const outside = mkdtempSync(join(tmpdir(), 'furio-outside-'));
  writeFileSync(join(outside, 'prod.yaml'), 'API_KEY: not-for-the-cloud');
  symlinkSync(join(outside, 'prod.yaml'), join(dir, '.architecture/linked.yaml'));
  symlinkSync(outside, join(dir, '.architecture/linked'));
  writeFileSync(join(dir, '.architecture/huge.md'), 'x'.repeat(1024 * 1024 + 1));
  const files = collectArchitectureFiles(join(dir, '.architecture'), dir);
  expect(JSON.stringify(files)).not.toContain('not-for-the-cloud');
  expect(Object.keys(files).sort()).toEqual(
    Object.keys(
      collectArchitectureFiles(join(ROOT, EXAMPLE, '.architecture'), join(ROOT, EXAMPLE)),
    ).sort(),
  );
});

it('collectArchitectureFiles skips files the server would refuse', () => {
  const dir = mkdtempSync(join(tmpdir(), 'furio-collect-'));
  cpSync(join(ROOT, EXAMPLE, '.architecture'), join(dir, '.architecture'), { recursive: true });
  writeFileSync(join(dir, '.architecture/.DS_Store'), 'x');
  const files = collectArchitectureFiles(join(dir, '.architecture'), dir);
  expect(Object.keys(files).every((p) => /\.(ya?ml|mmd|md)$/.test(p))).toBe(true);
});
