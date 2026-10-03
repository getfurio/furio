import { appendFileSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Model } from '@getfurio/core';
import { commandData, run } from '@getfurio/cli';

/** Reads an action input the way the runner passes it: INPUT_<NAME>, upper case, spaces as _. */
export function input(env: NodeJS.ProcessEnv, name: string): string {
  return (env[`INPUT_${name.replace(/ /g, '_').toUpperCase()}`] ?? '').trim();
}

/** The part of the workflow event payload the action reads. */
export interface GitHubEvent {
  repository?: { default_branch?: string };
  pull_request?: { number?: number };
}

/** The Action finds and updates its own comment by this marker (Furio Cloud writes it). */
export const COMMENT_MARKER = '<!-- furio:pr-diff -->';

export function isPullRequest(env: NodeJS.ProcessEnv): boolean {
  return env.GITHUB_EVENT_NAME === 'pull_request';
}

/** Where the CLI writes the pull request comment before the Action posts it. */
export function commentFile(env: NodeJS.ProcessEnv): string {
  return join(env.RUNNER_TEMP || tmpdir(), 'furio-pr-comment.md');
}

export function readEvent(env: NodeJS.ProcessEnv): GitHubEvent {
  try {
    return env.GITHUB_EVENT_PATH
      ? (JSON.parse(readFileSync(env.GITHUB_EVENT_PATH, 'utf8')) as GitHubEvent)
      : {};
  } catch {
    return {};
  }
}

/**
 * The events that upload. A closed list: on others (a comment, a review, `workflow_run`) the ref
 * can be the default branch while the workflow checked out the code of a pull request.
 */
const UPLOAD_EVENTS = ['push', 'workflow_dispatch', 'schedule'];

/** Furio Cloud gets the manifest of the default branch only: pull requests are just checked. */
export function onDefaultBranch(env: NodeJS.ProcessEnv, event: GitHubEvent): boolean {
  const branch = event.repository?.default_branch;
  return (
    !!branch &&
    UPLOAD_EVENTS.includes(env.GITHUB_EVENT_NAME ?? '') &&
    env.GITHUB_REF === `refs/heads/${branch}`
  );
}

/** Why `output: furio` only validates this run; undefined when it uploads (or does not apply). */
export function uploadNote(env: NodeJS.ProcessEnv, event: GitHubEvent): string | undefined {
  if (input(env, 'output') !== 'furio' || (input(env, 'command') || 'validate') !== 'validate')
    return undefined;
  if (onDefaultBranch(env, event)) return undefined;
  const branch = event.repository?.default_branch;
  const target = branch ? `\`${branch}\`, the default branch` : 'the default branch';
  if (isPullRequest(env))
    return `Pull request: checked, and compared with the map for an architecture comment (Furio Cloud Business). Furio Cloud receives the manifest on pushes to ${target}.`;
  if (env.GITHUB_EVENT_NAME === 'pull_request_target')
    return `Pull request: validation only. Furio Cloud receives the manifest on pushes to ${target}.`;
  if (!UPLOAD_EVENTS.includes(env.GITHUB_EVENT_NAME ?? ''))
    return `Event ${env.GITHUB_EVENT_NAME ?? 'unknown'}: validation only, nothing uploaded. Furio Cloud receives the manifest on pushes to ${target}.`;
  const ref = env.GITHUB_REF?.replace(/^refs\/(heads|tags)\//, '') ?? 'unknown ref';
  return `${env.GITHUB_EVENT_NAME === 'push' ? 'Push' : `Event ${env.GITHUB_EVENT_NAME}`} on \`${ref}\`, not ${target}: validation only, nothing uploaded. To upload, trigger the workflow on pushes to ${branch ? `\`${branch}\`` : 'the default branch'}.`;
}

export function buildArgs(env: NodeJS.ProcessEnv, event: GitHubEvent = {}): string[] {
  const command = input(env, 'command') || 'validate';
  const strict = input(env, 'strict') === 'true';
  const plain = input(env, 'plain') === 'true';
  const flags = [...(strict ? ['--strict'] : []), ...(plain ? ['--plain'] : [])];
  const output = input(env, 'output') || 'none';
  if (output !== 'none' && output !== 'furio')
    throw new Error(`Unknown output "${output}": use none or furio.`);

  if (command === 'validate') {
    const model = input(env, 'model');
    const paths = input(env, 'path').split(/\s+/).filter(Boolean);
    if (output === 'furio' && onDefaultBranch(env, event)) {
      if (paths.length > 1) throw new Error('output: furio uploads one repo: set a single path.');
      const url = input(env, 'furio-url');
      // upload validates first, with the same messages, and never sends an invalid manifest.
      return ['upload', paths[0] ?? '.', ...(url ? ['--url', url] : []), ...flags];
    }
    if (output === 'furio' && isPullRequest(env)) {
      if (paths.length > 1) throw new Error('output: furio uploads one repo: set a single path.');
      const url = input(env, 'furio-url');
      return [
        'upload',
        paths[0] ?? '.',
        '--preview',
        commentFile(env),
        ...(url ? ['--url', url] : []),
        ...flags,
      ];
    }
    return [
      'validate',
      ...(paths.length ? paths : ['.']),
      ...(model ? ['--model', model] : []),
      ...flags,
    ];
  }
  if (command === 'build') {
    const owner = input(env, 'github') || env.GITHUB_REPOSITORY_OWNER || '';
    const workspace = input(env, 'workspace');
    const site = input(env, 'site') !== 'false';
    return [
      'build',
      '--github',
      owner,
      ...(workspace ? ['--workspace', workspace] : []),
      '--out',
      outFile(env),
      ...(site && !input(env, 'out').endsWith('.json') ? ['--site'] : []),
      ...(input(env, 'list-private') === 'true' ? ['--list-private'] : []),
      ...flags,
    ];
  }
  throw new Error(`Unknown command "${command}": use validate or build.`);
}

export function outFile(env: NodeJS.ProcessEnv): string {
  const out = input(env, 'out') || '_furio';
  return out.endsWith('.json') ? out : join(out, 'model.json');
}

/**
 * A value that comes from the repos (an id, a file name, a message) as plain text on the summary
 * page: Markdown or HTML in it must not become a link, an image or a table row of its own.
 */
function text(value: string): string {
  return value.replace(/\s+/g, ' ').replace(/[\\`*_[\]<>&|~$]/g, '\\$&');
}

/** The same as inline code, where nothing can be escaped: a backtick would end the span early. */
function code(value: string): string {
  return `\`${value.replace(/[`\s]+/g, ' ')}\``;
}

/** Linked only to a plain web address: anything else in it could close the link and go on. */
function link(label: string, url: string | undefined): string {
  return url && /^https?:\/\/[^\s<>()\\]+$/i.test(url) ? `[${text(label)}](${url})` : text(label);
}

/** Markdown for the job summary page of a build. */
export function buildSummary(model: Model): string {
  const declared = model.components.filter((c) => !c.ghost);
  const ghosts = model.components.filter((c) => c.ghost);
  const lines = [
    `## Furio: workspace ${code(model.workspace.id)}`,
    '',
    `${declared.length} components, ${model.relations.length} relations, ${model.diagrams.length} diagrams` +
      (ghosts.length ? `, ${ghosts.length} ghost components` : '') +
      '.',
    '',
    '| Repo | Project | Status | Errors | Warnings |',
    '| --- | --- | --- | --- | --- |',
    ...model.repos.map(
      (r) =>
        `| ${link(r.id, r.url)} | ${text(r.project ?? '')} | ${
          r.status === 'skipped' ? `skipped (${r.skipReason})` : r.status
        } | ${r.errors} | ${r.warnings} |`,
    ),
  ];
  if (model.issues.length) {
    lines.push('', '### Issues', '');
    for (const i of model.issues) {
      const where = text(i.line ? `${i.file}:${i.line}` : i.file);
      lines.push(
        `- **${i.severity}** ${code(i.repo)} ${where}: ${text(i.message)}${i.hint ? ` ${text(i.hint)}` : ''}`,
      );
    }
  }
  return lines.join('\n') + '\n';
}

export interface CommentTarget {
  apiUrl: string;
  token: string;
  /** "owner/name". */
  repo: string;
  number: number;
}

/**
 * Creates the Furio comment on the pull request, or updates it: one comment per pull request,
 * refreshed on every push. Returns what happened, for the log.
 */
export async function upsertComment(
  target: CommentTarget,
  body: string,
  fetchImpl: typeof fetch = fetch,
): Promise<'created' | 'updated'> {
  const headers = {
    authorization: `Bearer ${target.token}`,
    accept: 'application/vnd.github+json',
    'content-type': 'application/json',
    'user-agent': 'furio-action',
  };
  const api = target.apiUrl.replace(/\/+$/, '');
  const base = `${api}/repos/${target.repo}/issues`;
  // Who posts: a personal token can say; the workflow token cannot, and posts as the Actions bot.
  const me = await fetchImpl(`${api}/user`, { headers })
    .then(async (r) => (r.ok ? ((await r.json()) as { login?: string }).login : undefined))
    .catch(() => undefined);
  const author = me ?? 'github-actions[bot]';
  let existing: number | undefined;
  for (let page = 1; page <= 5 && existing === undefined; page++) {
    const response = await fetchImpl(
      `${base}/${target.number}/comments?per_page=100&page=${page}`,
      {
        headers,
      },
    );
    if (!response.ok) throw new GitHubCommentError(response.status);
    const comments = (await response.json()) as {
      id: number;
      body?: string;
      user?: { login?: string };
    }[];
    // Only a comment this token's author wrote: anyone else pasting the marker keeps theirs.
    existing = comments.find(
      (c) => c.user?.login === author && c.body?.startsWith(COMMENT_MARKER),
    )?.id;
    if (comments.length < 100) break;
  }
  const response = await fetchImpl(
    existing === undefined ? `${base}/${target.number}/comments` : `${base}/comments/${existing}`,
    { method: existing === undefined ? 'POST' : 'PATCH', headers, body: JSON.stringify({ body }) },
  );
  if (!response.ok) throw new GitHubCommentError(response.status);
  return existing === undefined ? 'created' : 'updated';
}

export class GitHubCommentError extends Error {
  constructor(readonly status: number) {
    super(
      status === 403 || status === 404
        ? `GitHub refused the comment (HTTP ${status}): add "pull-requests: write" to the workflow permissions.`
        : `GitHub answered HTTP ${status} to the comment.`,
    );
  }
}

async function main() {
  const env = process.env;
  const event = readEvent(env);
  const args = buildArgs(env, event);
  const note = uploadNote(env, event);
  if (note) process.stdout.write(`${note}\n`);
  const token = input(env, 'token');
  const uploadToken = input(env, 'upload-token');
  const preview = args.includes('--preview');
  if (args[0] === 'upload' && !uploadToken && !preview)
    throw new Error('output: furio needs upload-token (e.g. secrets.FURIO_UPLOAD_TOKEN).');
  if (preview) rmSync(commentFile(env), { force: true });
  const code = await run(args, {
    stdout: (text) => process.stdout.write(text),
    stderr: (text) => process.stderr.write(text),
    cwd: env.GITHUB_WORKSPACE || process.cwd(),
    env: {
      ...env,
      GITHUB_ACTIONS: 'true',
      ...(token ? { FURIO_TOKEN: token } : {}),
      ...(uploadToken ? { FURIO_UPLOAD_TOKEN: uploadToken } : {}),
    },
    isTTY: false,
  });

  const comment =
    preview && existsSync(commentFile(env)) ? readFileSync(commentFile(env), 'utf8') : '';
  const number = event.pull_request?.number;
  const githubToken = input(env, 'github-token');
  if (comment && number && githubToken && env.GITHUB_REPOSITORY) {
    try {
      const done = await upsertComment(
        {
          apiUrl: env.GITHUB_API_URL || 'https://api.github.com',
          token: githubToken,
          repo: env.GITHUB_REPOSITORY,
          number,
        },
        comment,
      );
      process.stdout.write(`Architecture comment ${done} on pull request #${number}.\n`);
    } catch (error) {
      // The comment is a courtesy: the check itself already passed or failed on its own.
      process.stdout.write(`::warning title=Furio::${commandData((error as Error).message)}\n`);
    }
  }

  if (args[0] === 'build') {
    const file = join(env.GITHUB_WORKSPACE || process.cwd(), outFile(env));
    if (existsSync(file)) {
      if (env.GITHUB_OUTPUT) appendFileSync(env.GITHUB_OUTPUT, `model=${file}\n`);
      if (env.GITHUB_STEP_SUMMARY) {
        appendFileSync(
          env.GITHUB_STEP_SUMMARY,
          buildSummary(JSON.parse(readFileSync(file, 'utf8')) as Model),
        );
      }
    }
  }
  process.exitCode = code;
}

if (process.env.GITHUB_ACTIONS === 'true' && !process.env.VITEST) {
  main().catch((error: unknown) => {
    // On one line: an error can quote a file name, and a new line in it would start a command.
    process.stdout.write(`::error title=Furio::${commandData((error as Error).message)}\n`);
    process.exitCode = 1;
  });
}
