import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import {
  buildModel,
  closest,
  collectFromGitHub,
  GitHubError,
  validateRepo,
  type Model,
  type RepoSource,
  type SkippedRepo,
} from '@getfurio/core';
import {
  formatBuild,
  formatGithubAnnotations,
  formatJson,
  formatPretty,
  type Format,
} from './report.js';

export { commandData } from './report.js';
import { githubRepoOf } from './git.js';
import { initRepo } from './init.js';
import { DEFAULT_FURIO_URL, upload } from './upload.js';
import { VERSION } from './version.js';

export interface Io {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  cwd: string;
  env: Record<string, string | undefined>;
  isTTY: boolean;
  fetch?: typeof fetch;
}

const COMMANDS = ['init', 'validate', 'build', 'upload', 'help', 'version'];

const HELP = `furio ${VERSION}: Furio likes things tidy.

Usage
  furio init [path]                 Start a manifest and teach coding agents to keep it updated
  furio validate [path...]          Check the .architecture/ manifest of one or more repos
  furio build [path...]             Merge the manifests of many repos into one model.json
  furio build --github <owner>      Same, collecting the manifests from a GitHub org or user
  furio upload [path]               Validate, then send the .architecture/ folder to Furio Cloud
  furio upload --dry-run [path]     Validate, check the token, list what would be sent

Validate options
  --model <file|url>             A published model.json: checks references to other repos
  --format <pretty|json|github>  Output format (default: pretty, github inside GitHub Actions)
  --strict                       Fail on warnings too

Init options
  --project <id>                 Project id (default: the folder name)
  --no-agents                    Skip the skill for Claude Code, Codex and AGENTS.md

Build options
  --site                         Also write the map (static site) next to model.json
  --workspace <id>               Workspace id (default: the --github owner)
  --github <owner>               Collect from GitHub; token from FURIO_TOKEN or GITHUB_TOKEN
  --list-private                 With --github: also list the private repos that have no
                                 manifest (by default their names stay out of the model)
  --out <path>                   Output file or folder (default: furio-model.json)
  --strict                       Fail if any repo is invalid

Upload options
  --repo <owner/name>            The repo on GitHub (default: GITHUB_REPOSITORY, else the
                                 origin remote)
  --commit <sha>                 The commit uploaded (default: GITHUB_SHA)
  --url <url>                    Furio Cloud, over https (default: FURIO_URL or
                                 ${DEFAULT_FURIO_URL})
  --dry-run                      Send nothing: validate, ask Furio Cloud whether it would
                                 accept the upload, and list the files
  --preview <file>               Pull requests: write to <file> the Markdown comment with what
                                 the manifest would change on the map (Business plan)
                                 The workspace upload token is read from FURIO_UPLOAD_TOKEN.

Common options
  --plain                        No personality, no colors
  -h, --help                     Show this help
  -v, --version                  Show the version

GitHub Action
  uses: getfurio/furio@<commit>  Validates the manifest on every pull request and push
                                 (pin a release commit; @v0 follows the latest 0.x).
  with: output: furio            Also uploads to Furio Cloud on pushes to the default branch,
        upload-token: ...        with the workspace token (a repository secret).

[path] is a repo root, its .architecture/ folder or the manifest file (default: current directory).
Docs: https://getfurio.com/docs/ (manifest, GitHub Action, Furio Cloud, coding agents)
`;

/** Runs the CLI and returns the process exit code: 0 ok, 1 invalid, 2 usage or runtime error. */
export async function run(argv: string[], io: Io): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        format: { type: 'string' },
        model: { type: 'string' },
        workspace: { type: 'string' },
        github: { type: 'string' },
        out: { type: 'string' },
        project: { type: 'string' },
        repo: { type: 'string' },
        commit: { type: 'string' },
        url: { type: 'string' },
        site: { type: 'boolean', default: false },
        'list-private': { type: 'boolean', default: false },
        'dry-run': { type: 'boolean', default: false },
        preview: { type: 'string' },
        'no-agents': { type: 'boolean', default: false },
        plain: { type: 'boolean', default: false },
        strict: { type: 'boolean', default: false },
        help: { type: 'boolean', short: 'h', default: false },
        version: { type: 'boolean', short: 'v', default: false },
      },
    });
  } catch (error) {
    io.stderr(`${(error as Error).message}\nRun "furio --help" for usage.\n`);
    return 2;
  }
  const { values, positionals } = parsed;
  const [command, ...rest] = positionals;

  if (values.version || command === 'version') {
    io.stdout(`${VERSION}\n`);
    return 0;
  }
  if (values.help || !command || command === 'help') {
    io.stdout(HELP);
    return 0;
  }
  try {
    if (command === 'init') return init(rest, values, io);
    if (command === 'validate') return await validate(rest, values, io);
    if (command === 'build') return await build(rest, values, io);
    if (command === 'upload') return await uploadCommand(rest, values, io);
  } catch (error) {
    if (error instanceof GitHubError || error instanceof UsageError) {
      io.stderr(`${error.message}\n`);
      return 2;
    }
    throw error;
  }
  const suggestion = closest(command, COMMANDS);
  io.stderr(
    `Unknown command "${command}".${suggestion ? ` Did you mean "furio ${suggestion}"?` : ''}\nRun "furio --help" for usage.\n`,
  );
  return 2;
}

class UsageError extends Error {}

interface Values {
  format?: string;
  model?: string;
  workspace?: string;
  github?: string;
  out?: string;
  project?: string;
  repo?: string;
  commit?: string;
  url?: string;
  site: boolean;
  'list-private': boolean;
  'dry-run': boolean;
  preview?: string;
  'no-agents': boolean;
  plain: boolean;
  strict: boolean;
}

async function validate(paths: string[], values: Values, io: Io): Promise<number> {
  const format = (values.format ??
    (io.env.GITHUB_ACTIONS === 'true' ? 'github' : 'pretty')) as Format;
  if (!['pretty', 'json', 'github'].includes(format)) {
    throw new UsageError(`Unknown format "${values.format}". Use pretty, json or github.`);
  }

  let knownComponents: string[] | undefined;
  if (values.model) {
    const model = await loadModel(values.model, io);
    knownComponents = model?.components.filter((c) => !c.ghost).map((c) => c.key);
  }

  const targets = paths.length ? paths : ['.'];
  const results = targets.map((target) =>
    validateRepo(resolve(io.cwd, target), knownComponents ? { knownComponents } : {}),
  );

  const color = !values.plain && io.isTTY && !io.env.NO_COLOR && format !== 'json';
  if (format === 'json') {
    io.stdout(formatJson(results, io.cwd));
  } else {
    if (format === 'github') io.stdout(formatGithubAnnotations(results, io.cwd));
    io.stdout(formatPretty(results, { plain: values.plain, color, cwd: io.cwd }));
  }

  const errors = results.some((r) => !r.valid);
  const warnings = results.some((r) => r.warnings > 0);
  return errors || (values.strict && warnings) ? 1 : 0;
}

/** A published model is a convenience for better messages: if it cannot be read, carry on. */
async function loadModel(location: string, io: Io): Promise<Model | undefined> {
  try {
    let text: string;
    if (/^https?:\/\//.test(location)) {
      const response = await (io.fetch ?? fetch)(location, { signal: AbortSignal.timeout(10_000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      text = await response.text();
    } else {
      text = readFileSync(resolve(io.cwd, location), 'utf8');
    }
    const model = JSON.parse(text) as Model;
    if (model.modelVersion !== 1 || !Array.isArray(model.components)) {
      throw new Error('not a Furio model (version 1)');
    }
    return model;
  } catch (error) {
    io.stderr(
      `warning: could not read the model at ${location} (${(error as Error).message}); references to other repos are not checked.\n`,
    );
    return undefined;
  }
}

async function build(paths: string[], values: Values, io: Io): Promise<number> {
  if (values.github && paths.length) {
    throw new UsageError('Use either --github <owner> or local paths, not both.');
  }
  const workspace = values.workspace ?? values.github;
  if (!workspace) throw new UsageError('furio build needs --workspace <id> (or --github <owner>).');

  let sources: RepoSource[];
  let skipped: SkippedRepo[] = [];
  let unlisted = 0;
  let checkout: string | undefined;
  // The collected manifests, of private repos too, never stay behind: not even on a failure.
  try {
    if (values.github) {
      checkout = mkdtempSync(join(tmpdir(), 'furio-collect-'));
      const token = io.env.FURIO_TOKEN || io.env.GITHUB_TOKEN || undefined;
      const collected = await collectFromGitHub({
        owner: values.github,
        outDir: checkout,
        listPrivate: values['list-private'],
        ...(token ? { token } : {}),
        ...(io.fetch ? { fetch: io.fetch } : {}),
        ...(io.env.GITHUB_API_URL ? { apiUrl: io.env.GITHUB_API_URL } : {}),
      });
      sources = collected.sources;
      skipped = collected.skipped;
      unlisted = collected.unlisted;
    } else {
      const dirs = paths.length ? paths : ['.'];
      sources = dirs.map((dir) => {
        const full = resolve(io.cwd, dir);
        return { id: `${workspace}/${basename(full)}`, dir: full };
      });
    }

    const { model } = buildModel(sources, { workspace, generatorVersion: VERSION, skipped });
    const out = resolve(io.cwd, values.out ?? 'furio-model.json');
    const file = out.endsWith('.json') ? out : join(out, 'model.json');
    mkdirSync(dirname(file), { recursive: true });
    if (values.site) copySite(dirname(file));
    writeFileSync(file, JSON.stringify(model, null, 2) + '\n');

    const color = !values.plain && io.isTTY && !io.env.NO_COLOR;
    io.stdout(
      formatBuild(model, { plain: values.plain, color, cwd: io.cwd, output: file, unlisted }),
    );
    const invalid = model.repos.some((r) => r.status === 'invalid');
    return values.strict && invalid ? 1 : 0;
  } finally {
    if (checkout) rmSync(checkout, { recursive: true, force: true });
  }
}

async function uploadCommand(paths: string[], values: Values, io: Io): Promise<number> {
  if (paths.length > 1) throw new UsageError('furio upload takes one path.');
  const dryRun = values['dry-run'];
  // Never a flag: a token on the command line ends up in shell history and process lists.
  const token = io.env.FURIO_UPLOAD_TOKEN;
  if (!token && !dryRun) {
    // A pull request from a fork gets no secrets: nothing to compare, nothing to fail.
    if (values.preview) {
      io.stdout(
        'No architecture comment: FURIO_UPLOAD_TOKEN is not set (pull requests from forks get no secrets).\n',
      );
      return validate(paths, { ...values, preview: undefined }, io);
    }
    throw new UsageError(
      'FURIO_UPLOAD_TOKEN is not set. Put the workspace upload token there (in GitHub Actions: a repository secret).',
    );
  }
  const root = resolve(io.cwd, paths[0] ?? '.');
  const repo = values.repo ?? io.env.GITHUB_REPOSITORY ?? githubRepoOf(root);
  if (!repo || !/^[^/\s]+\/[^/\s]+$/.test(repo)) {
    throw new UsageError(
      'furio upload needs --repo <owner/name> (or GITHUB_REPOSITORY, or a GitHub origin remote).',
    );
  }
  const commit = values.commit ?? io.env.GITHUB_SHA;
  return upload({
    root,
    repo,
    ...(commit ? { commit } : {}),
    url: furioUrl(values.url ?? io.env.FURIO_URL ?? DEFAULT_FURIO_URL),
    ...(token ? { token } : {}),
    dryRun,
    ...(values.preview ? { previewOut: resolve(io.cwd, values.preview) } : {}),
    plain: values.plain,
    color: !values.plain && io.isTTY && !io.env.NO_COLOR,
    github: io.env.GITHUB_ACTIONS === 'true',
    cwd: io.cwd,
    fetch: io.fetch ?? fetch,
    stdout: io.stdout,
    stderr: io.stderr,
  });
}

/** The upload token goes to this address: https only, plain http just for this machine. */
function furioUrl(value: string): string {
  const url = URL.canParse(value) ? new URL(value) : undefined;
  const local = /^(localhost|.+\.localhost|127\.0\.0\.1|\[::1\])$/.test(url?.hostname ?? '');
  if (url?.protocol === 'https:' || (url?.protocol === 'http:' && local)) return value;
  throw new UsageError(
    `--url (or FURIO_URL) must be an https address, got "${value}": the upload token would travel unencrypted. Plain http is accepted for localhost only.`,
  );
}

function init(paths: string[], values: Values, io: Io): number {
  if (paths.length > 1) throw new UsageError('furio init takes one path.');
  const root = resolve(io.cwd, paths[0] ?? '.');
  const result = initRepo({
    root,
    agents: !values['no-agents'],
    ...(values.project ? { project: values.project } : {}),
  });
  for (const file of result.created) io.stdout(`created   ${file}\n`);
  for (const file of result.updated) io.stdout(`updated   ${file}\n`);
  for (const file of result.unchanged) io.stdout(`unchanged ${file}\n`);
  if (result.notes.length) io.stdout('\n');
  for (const note of result.notes) io.stdout(`note: ${note}\n`);
  io.stdout(
    values.plain
      ? 'Done. Describe your components in .architecture/architecture.yaml, then run furio validate.\n'
      : '\nFurio set up the drawer. Now put your components in it (.architecture/architecture.yaml) and run furio validate.\n',
  );
  return 0;
}

/** The prebuilt map ships next to the CLI bundle (dist/../site). */
export function siteDir(): string {
  return fileURLToPath(new URL('../site/', import.meta.url));
}

function copySite(target: string) {
  const source = siteDir();
  if (!existsSync(join(source, 'index.html'))) {
    throw new UsageError(`The map is not bundled with this build of furio (looked in ${source}).`);
  }
  cpSync(source, target, { recursive: true, filter: (path) => !path.endsWith('model.json') });
}
