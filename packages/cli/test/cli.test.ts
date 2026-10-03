import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { run, type Io } from '../src/main.js';
import { formatBuild } from '../src/report.js';

const ROOT = join(import.meta.dirname, '../../..');
const EXAMPLE = 'examples/demo/shop-api';

async function cli(args: string[], env: Record<string, string> = {}) {
  let stdout = '';
  let stderr = '';
  const io: Io = {
    stdout: (t) => void (stdout += t),
    stderr: (t) => void (stderr += t),
    cwd: ROOT,
    env,
    isTTY: false,
  };
  const code = await run(args, io);
  return { code, stdout, stderr };
}

describe('furio CLI', async () => {
  it('approves a valid repo', async () => {
    const { code, stdout } = await cli(['validate', EXAMPLE]);
    expect(code).toBe(0);
    expect(stdout).toContain('All tidy. Furio approves.');
    expect(stdout).toContain('examples/demo/shop-api/.architecture/architecture.yaml');
  });

  it('validates several repos at once', async () => {
    const { code, stdout } = await cli([
      'validate',
      EXAMPLE,
      'examples/demo/shop-web',
      'examples/demo/platform',
    ]);
    expect(code).toBe(0);
    expect(stdout).toContain('furio.yaml');
  });

  it('fails with exit code 1 on an invalid repo', async () => {
    const { code, stdout } = await cli(['validate', 'packages']);
    expect(code).toBe(1);
    expect(stdout).toContain('manifest-not-found');
    expect(stdout).toContain('Furio is not happy: 1 error, 0 warnings.');
  });

  it('drops the personality with --plain', async () => {
    expect((await cli(['validate', EXAMPLE, '--plain'])).stdout).toContain('Valid.');
    expect((await cli(['validate', 'packages', '--plain'])).stdout).toContain(
      'Invalid: 1 error, 0 warnings.',
    );
  });

  it('prints machine-readable JSON', async () => {
    const { code, stdout } = await cli(['validate', 'packages', '--format', 'json']);
    expect(code).toBe(1);
    const report = JSON.parse(stdout) as {
      summary: { valid: boolean; errors: number };
      results: { diagnostics: { code: string; file: string }[] }[];
    };
    expect(report.summary).toMatchObject({ valid: false, errors: 1 });
    expect(report.results[0]?.diagnostics[0]).toMatchObject({
      code: 'manifest-not-found',
      file: 'packages/.architecture',
    });
  });

  it('emits GitHub annotations inside GitHub Actions', async () => {
    const { stdout } = await cli(['validate', 'packages'], { GITHUB_ACTIONS: 'true' });
    expect(stdout).toMatch(
      /^::error file=packages\/\.architecture,title=Furio%3A manifest-not-found::/m,
    );
  });

  it('never lets a manifest or a file name write commands or escapes in the log', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'furio-inject-'));
    mkdirSync(join(dir, '.architecture'));
    writeFileSync(
      join(dir, '.architecture/architecture.yaml'),
      'version: 1\nproject: shop\nowner: t\ncomponents:\n  - id: api\n    type: "x\\n::error file=README.md::Injected\\n::set-output name=model::/etc/passwd\\e[2K"\n',
    );
    // A file name is as free as a value: new lines and all.
    writeFileSync(join(dir, '.architecture/a\n::warning::From a file name\n.mmd'), 'graph LR');
    for (const env of [{ GITHUB_ACTIONS: 'true' }, {}] as Record<string, string>[]) {
      const { code, stdout } = await cli(['validate', dir], env);
      expect(code).toBe(1);
      // Only Furio's own annotations start a line with "::".
      const commands = stdout.split('\n').filter((line) => line.trimStart().startsWith('::'));
      expect(commands.every((line) => /^::(error|warning) file=/.test(line))).toBe(true);
      expect(commands).toHaveLength(env.GITHUB_ACTIONS ? 2 : 0);
      expect(stdout).not.toContain('\u001b');
      expect(stdout).toContain('"x\\n::error file=README.md::Injected');
    }
  });

  it('suggests the right command on a typo', async () => {
    const { code, stderr } = await cli(['validte']);
    expect(code).toBe(2);
    expect(stderr).toContain('Did you mean "furio validate"?');
  });

  it('rejects unknown options and formats', async () => {
    expect((await cli(['validate', '--nope'])).code).toBe(2);
    expect((await cli(['validate', '--format', 'xml'])).code).toBe(2);
  });

  it('prints help and version', async () => {
    const help = (await cli([])).stdout;
    expect(help).toContain('Usage');
    expect(help).toContain('--dry-run');
    expect(help).toContain('output: furio');
    expect(help).toContain('https://getfurio.com/docs/');
    expect((await cli(['--version'])).stdout).toMatch(/^\d+\.\d+\.\d+\n$/);
  });
});

describe('furio build', () => {
  const out = () => join(mkdtempSync(join(tmpdir(), 'furio-build-test-')), 'model.json');
  const demo = ['examples/demo/shop-api', 'examples/demo/shop-web', 'examples/demo/platform'];

  it('writes the model of local repos', async () => {
    const file = out();
    const { code, stdout } = await cli(['build', '--workspace', 'acme', '--out', file, ...demo]);
    expect(code).toBe(0);
    expect(stdout).toContain('Workspace acme: 3 repos on the map, 2 projects, 9 components');
    const model = JSON.parse(readFileSync(file, 'utf8')) as { repos: { id: string }[] };
    expect(model.repos.map((r) => r.id)).toEqual([
      'acme/platform',
      'acme/shop-api',
      'acme/shop-web',
    ]);
  });

  it('says how many private repos it left out of the model', () => {
    const model: Parameters<typeof formatBuild>[0] = {
      modelVersion: 1,
      generatedAt: '2026-01-01T00:00:00.000Z',
      generator: { name: 'furio', version: 'test' },
      workspace: { id: 'acme' },
      projects: [],
      repos: [],
      components: [],
      relations: [],
      diagrams: [],
      issues: [],
    };
    const options = { plain: true, color: false, cwd: ROOT, output: join(ROOT, 'model.json') };
    expect(formatBuild(model, { ...options, unlisted: 2 })).toContain(
      'Not listed: 2 private repos without a manifest (--list-private puts their names on the map).',
    );
    expect(formatBuild(model, options)).not.toContain('Not listed');
  });

  it('needs a workspace', async () => {
    const { code, stderr } = await cli(['build', ...demo]);
    expect(code).toBe(2);
    expect(stderr).toContain('--workspace');
  });

  it('feeds a published model to validate', async () => {
    const file = out();
    await cli(['build', '--workspace', 'acme', '--out', file, ...demo]);
    const repo = mkdtempSync(join(tmpdir(), 'furio-repo-test-'));
    mkdirSync(join(repo, '.architecture'));
    writeFileSync(
      join(repo, '.architecture/architecture.yaml'),
      'version: 1\nproject: billing\nowner: t\ncomponents:\n  - id: api\n    type: service\nrelations:\n  - from: api\n    to: platform/user-api\n    type: calls\n',
    );
    const { code, stdout } = await cli(['validate', repo, '--model', file]);
    expect(code).toBe(0);
    expect(stdout).toContain('Did you mean "platform/users-api"?');
    // Outside the current folder, paths are absolute rather than a ladder of ../
    expect(stdout).toContain(`${join(repo, '.architecture/architecture.yaml')}:9:9`);
    expect(stdout).not.toContain('../');
  });

  it('carries on when the model cannot be read', async () => {
    const { code, stderr } = await cli(['validate', EXAMPLE, '--model', 'nope.json']);
    expect(code).toBe(0);
    expect(stderr).toContain('could not read the model');
  });
});
