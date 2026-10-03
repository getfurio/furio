import { readdirSync, writeFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import {
  printable,
  readInside,
  validateRepo,
  type Diagnostic,
  type ValidationResult,
} from '@getfurio/core';
import { formatGithubAnnotations, formatPretty } from './report.js';

export const DEFAULT_FURIO_URL = 'https://getfurio.com';
const UPLOAD_EXTENSIONS = ['.yaml', '.yml', '.mmd', '.md'];

export interface UploadOptions {
  root: string;
  /** "owner/name". */
  repo: string;
  commit?: string;
  url: string;
  /** Required to upload; a dry run without it checks only locally. */
  token?: string;
  /** Validate and ask Furio Cloud whether it would accept the upload, without sending it. */
  dryRun?: boolean;
  /**
   * Pull requests: ask Furio Cloud what this manifest would change on the map and write its
   * Markdown comment to this file. Nothing is stored. A plan without it, or an unreachable
   * server, is a note, not a failure.
   */
  previewOut?: string;
  plain: boolean;
  color: boolean;
  github: boolean;
  cwd: string;
  fetch: typeof fetch;
  stdout: (text: string) => void;
  stderr: (text: string) => void;
}

/**
 * The files Furio Cloud receives: the `.architecture/` folder only, never the rest of the repo.
 * Paths are relative to the repo root, with forward slashes. Symbolic links are not followed
 * (they could lead anywhere on this machine) and files over 1 MB are left out.
 */
export function collectArchitectureFiles(architectureDir: string, root: string) {
  const files: Record<string, string> = {};
  const walk = (dir: string) => {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries.sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const path = join(dir, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) walk(path);
      else if (
        entry.isFile() &&
        UPLOAD_EXTENSIONS.some((ext) => entry.name.toLowerCase().endsWith(ext))
      ) {
        const read = readInside(architectureDir, relative(architectureDir, path));
        if ('text' in read) files[relative(root, path).split(sep).join('/')] = read.text;
      }
    }
  };
  walk(architectureDir);
  return files;
}

interface ErrorBody {
  error?: string;
  message?: string;
  field?: string;
  diagnostics?: (Omit<Diagnostic, 'file'> & { file: string })[];
}

interface CheckBody {
  workspace?: string;
  plan?: string;
  project?: string;
  newRepo?: boolean;
  map?: string;
}

/**
 * Validates the repo locally, then sends its `.architecture/` folder to Furio Cloud. Returns the
 * exit code: 0 uploaded (or, in a dry run, would be accepted), 1 rejected (invalid manifest, plan
 * limits, bad token), 2 usage or network error.
 */
export async function upload(options: UploadOptions): Promise<number> {
  const report = (results: ValidationResult[]) => {
    if (options.github) options.stdout(formatGithubAnnotations(results, options.cwd));
    options.stdout(formatPretty(results, options));
  };

  // Checking first saves a round trip and gives the same messages as `furio validate`.
  const local = validateRepo(resolve(options.root));
  if (!local.valid) {
    report([local]);
    options.stderr(
      `Not ${options.dryRun ? 'checked with Furio Cloud' : 'uploaded'}: fix the errors above first.\n`,
    );
    return 1;
  }

  const files = collectArchitectureFiles(local.architectureDir, local.root);
  if (options.dryRun && !options.token) {
    report([local]);
    listFiles(options, files);
    options.stdout(
      'FURIO_UPLOAD_TOKEN is not set: the token, the plan and the workspace were not checked.\nDry run: nothing was sent.\n',
    );
    return 0;
  }

  const base = options.url.replace(/\/+$/, '');
  const action = options.previewOut ? 'preview' : options.dryRun ? 'check' : 'upload';
  const endpoint = `${base}/api/v1/${action}`;
  let response: Response;
  try {
    response = await options.fetch(endpoint, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${options.token}`,
        'content-type': 'application/json',
        'user-agent': 'furio-cli',
      },
      body: JSON.stringify({
        repo: options.repo,
        ...(options.commit ? { commit: options.commit } : {}),
        files,
      }),
      signal: AbortSignal.timeout(30_000),
    });
  } catch (error) {
    options.stderr(`Could not reach ${endpoint}: ${(error as Error).message}\n`);
    if (options.previewOut) {
      report([local]);
      options.stdout('No architecture comment this time: Furio Cloud did not answer.\n');
      return 0;
    }
    return 2;
  }

  const body = (await response.json().catch(() => ({}))) as ErrorBody &
    CheckBody & {
      comment?: string;
    };

  if (options.previewOut) {
    if (response.ok && typeof body.comment === 'string') {
      report([withServerDiagnostics(local, body.diagnostics)]);
      writeFileSync(options.previewOut, body.comment);
      options.stdout(`Architecture comment for ${options.repo} written to ${options.previewOut}\n`);
      return 0;
    }
    if (response.status !== 422) {
      report([local]);
      options.stdout(
        `No architecture comment: ${said(body.message) ?? `Furio Cloud answered HTTP ${response.status}`}\n`,
      );
      return 0;
    }
  }

  if (response.ok) {
    report([withServerDiagnostics(local, body.diagnostics)]);
    const map = body.map ? new URL(body.map, options.url).href : options.url;
    if (options.dryRun) {
      listFiles(options, files);
      options.stdout(
        `Token accepted: workspace ${said(body.workspace)} (${said(body.plan)} plan). ` +
          `Furio Cloud would ${body.newRepo ? 'add' : 'update'} ${options.repo}` +
          `${body.project ? ` in project ${said(body.project)}` : ''}: ${map}\nDry run: nothing was uploaded.\n`,
      );
      return 0;
    }
    options.stdout(
      options.plain
        ? `Uploaded ${options.repo} to workspace ${said(body.workspace)}: ${map}\n`
        : `Uploaded ${options.repo}. Furio filed it in workspace ${said(body.workspace)}: ${map}\n`,
    );
    return 0;
  }

  if (options.dryRun && response.status === 404 && !body.error) {
    options.stderr(`${base} does not support dry runs yet: the token was not checked.\n`);
    return 2;
  }
  if (body.diagnostics?.length) report([withServerDiagnostics(local, body.diagnostics)]);
  const detail = said(body.message) ?? `HTTP ${response.status}`;
  const field = body.field ? ` (field: ${said(body.field)})` : '';
  options.stderr(
    `Furio Cloud ${options.dryRun ? 'would refuse' : 'refused'} the upload [${said(body.error) ?? response.status}]: ${detail}${field}\n`,
  );
  return response.status >= 500 ? 2 : 1;
}

/** What the server answered, safe to print (a server is not trusted with the terminal either). */
function said(value: unknown): string | undefined {
  return typeof value === 'string' && value ? printable(value) : undefined;
}

/** The server checked against the whole workspace: its findings replace the local ones. */
function withServerDiagnostics(
  local: ValidationResult,
  diagnostics: ErrorBody['diagnostics'],
): ValidationResult {
  if (!diagnostics) return local;
  const mapped = diagnostics.map((d) => ({ ...d, file: join(local.root, d.file) }));
  const errors = mapped.filter((d) => d.severity === 'error').length;
  return {
    ...local,
    diagnostics: mapped,
    errors,
    warnings: mapped.length - errors,
    valid: !errors,
  };
}

function listFiles(options: UploadOptions, files: Record<string, string>) {
  const paths = Object.keys(files);
  options.stdout(
    `Would send ${paths.length} file${paths.length === 1 ? '' : 's'} for ${options.repo}:\n`,
  );
  for (const path of paths)
    options.stdout(`  ${printable(path, 2000)} (${Buffer.byteLength(files[path]!)} bytes)\n`);
}
