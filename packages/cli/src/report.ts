import { isAbsolute, relative } from 'node:path';
import { styleText } from 'node:util';
import { printable, type Diagnostic, type Model, type ValidationResult } from '@getfurio/core';

export type Format = 'pretty' | 'json' | 'github';

export interface ReportOptions {
  plain: boolean;
  color: boolean;
  cwd: string;
}

type Style = Parameters<typeof styleText>[0];

/** A path as people read it: relative inside the current folder, absolute outside it. */
export function displayPath(path: string, cwd: string): string {
  const rel = relative(cwd, path);
  if (!rel) return '.';
  return rel === '..' || rel.startsWith('../') || rel.startsWith('..\\') || isAbsolute(rel)
    ? path
    : rel;
}

/**
 * Text for a terminal or a CI log. Messages quote manifests and file names, written by anyone
 * who can open a pull request: a new line followed by `::error` would be a command to the GitHub
 * runner, an escape sequence would rewrite the terminal. They are printed as visible escapes.
 */
const text = (value: string) => printable(value, 2000);

function location(d: Diagnostic, cwd: string): string {
  const file = text(displayPath(d.file, cwd));
  if (d.line === undefined) return file;
  return `${file}:${d.line}:${d.column ?? 1}`;
}

/** Human-readable report. Technical details first, Furio's personality only in the summary. */
export function formatPretty(results: ValidationResult[], options: ReportOptions): string {
  const paint = (style: Style, text: string) => (options.color ? styleText(style, text) : text);
  const lines: string[] = [];

  for (const result of results) {
    for (const d of result.diagnostics) {
      const label =
        d.severity === 'error'
          ? paint(['red', 'bold'], 'error')
          : paint(['yellow', 'bold'], 'warning');
      lines.push(`${label} ${paint('dim', location(d, options.cwd))}`);
      lines.push(`  ${text(d.message)}`);
      if (d.hint) lines.push(`  ${paint('cyan', '→')} ${text(d.hint)}`);
      lines.push(paint('dim', `  [${text(d.code)}]`));
      lines.push('');
    }
  }

  const errors = results.reduce((sum, r) => sum + r.errors, 0);
  const warnings = results.reduce((sum, r) => sum + r.warnings, 0);
  const counts = `${plural(errors, 'error')}, ${plural(warnings, 'warning')}`;
  const checked = results
    .filter((r) => r.manifestPath)
    .map((r) => text(displayPath(r.manifestPath!, options.cwd)))
    .join(', ');

  if (options.plain) {
    lines.push(
      errors
        ? `Invalid: ${counts}.`
        : `Valid${warnings ? ` with ${plural(warnings, 'warning')}` : ''}.`,
    );
  } else if (errors) {
    lines.push(paint(['red', 'bold'], `Furio is not happy: ${counts}.`));
  } else if (warnings) {
    lines.push(
      paint(
        ['yellow', 'bold'],
        `Tidy enough. Furio made a note of ${plural(warnings, 'warning')}.`,
      ),
    );
  } else {
    lines.push(paint(['green', 'bold'], 'All tidy. Furio approves.'));
  }
  if (checked) lines.push(paint('dim', `Checked ${checked}`));
  return lines.join('\n') + '\n';
}

export function formatJson(results: ValidationResult[], cwd: string): string {
  const files = results.map((r) => ({
    root: displayPath(r.root, cwd),
    manifest: r.manifestPath ? displayPath(r.manifestPath, cwd) : null,
    valid: r.valid,
    errors: r.errors,
    warnings: r.warnings,
    diagnostics: r.diagnostics.map((d) => ({ ...d, file: displayPath(d.file, cwd) })),
  }));
  const summary = {
    valid: results.every((r) => r.valid),
    errors: files.reduce((sum, f) => sum + f.errors, 0),
    warnings: files.reduce((sum, f) => sum + f.warnings, 0),
  };
  return JSON.stringify({ version: 1, summary, results: files }, null, 2) + '\n';
}

/** The message of a GitHub Actions workflow command (`::error ...::<message>`), on one line. */
export function commandData(message: string): string {
  return message.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
}

/** GitHub Actions workflow commands, so diagnostics show up inline on the PR diff. */
export function formatGithubAnnotations(results: ValidationResult[], cwd: string): string {
  const escapeData = commandData;
  const escapeProp = (s: string) => escapeData(s).replace(/:/g, '%3A').replace(/,/g, '%2C');
  const out: string[] = [];
  for (const result of results) {
    for (const d of result.diagnostics) {
      const props = [`file=${escapeProp(relative(cwd, d.file) || '.')}`];
      if (d.line !== undefined) props.push(`line=${d.line}`);
      if (d.column !== undefined) props.push(`col=${d.column}`);
      props.push(`title=${escapeProp(`Furio: ${d.code}`)}`);
      const text = d.hint ? `${d.message}\n${d.hint}` : d.message;
      out.push(
        `::${d.severity === 'error' ? 'error' : 'warning'} ${props.join(',')}::${escapeData(text)}`,
      );
    }
  }
  return out.length ? out.join('\n') + '\n' : '';
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

export interface BuildReportOptions {
  plain: boolean;
  color: boolean;
  cwd: string;
  output: string;
  /** Private repos without a manifest, left out of the model. */
  unlisted?: number;
}

/** Summary of `furio build`: issues per repo, then what the map contains. */
export function formatBuild(model: Model, options: BuildReportOptions): string {
  const paint = (style: Style, text: string) => (options.color ? styleText(style, text) : text);
  const lines: string[] = [];

  for (const issue of model.issues) {
    const label =
      issue.severity === 'error'
        ? paint(['red', 'bold'], 'error')
        : paint(['yellow', 'bold'], 'warning');
    const file = text(issue.file);
    const where = issue.line === undefined ? file : `${file}:${issue.line}:${issue.column ?? 1}`;
    lines.push(`${label} ${paint('bold', text(issue.repo))} ${paint('dim', where)}`);
    lines.push(`  ${text(issue.message)}`);
    if (issue.hint) lines.push(`  ${paint('cyan', '→')} ${text(issue.hint)}`);
    lines.push(paint('dim', `  [${text(issue.code)}]`));
    lines.push('');
  }

  const valid = model.repos.filter((r) => r.status === 'valid').length;
  const invalid = model.repos.filter((r) => r.status === 'invalid');
  const skipped = model.repos.filter((r) => r.status === 'skipped');
  const declared = model.components.filter((c) => !c.ghost).length;
  const ghosts = model.components.length - declared;
  const projects = model.projects.filter((p) => !p.ghost).length;

  lines.push(
    `Workspace ${text(model.workspace.id)}: ${plural(valid, 'repo')} on the map, ${plural(projects, 'project')}, ` +
      `${plural(declared, 'component')}, ${plural(model.relations.length, 'relation')}, ` +
      `${plural(model.diagrams.length, 'diagram')}.`,
  );
  if (ghosts) lines.push(`${plural(ghosts, 'ghost component')} (referenced, declared by no repo).`);
  if (skipped.length) {
    lines.push(
      `Skipped ${plural(skipped.length, 'repo')} (no manifest, empty or archived): ${skipped.map((r) => text(r.id)).join(', ')}.`,
    );
  }
  if (options.unlisted) {
    lines.push(
      `Not listed: ${plural(options.unlisted, 'private repo')} without a manifest (--list-private puts their names on the map).`,
    );
  }
  if (invalid.length) {
    const names = invalid.map((r) => text(r.id)).join(', ');
    lines.push(
      options.plain
        ? `Left out ${plural(invalid.length, 'invalid repo')}: ${names}.`
        : paint(
            ['red', 'bold'],
            `Furio left out ${plural(invalid.length, 'invalid repo')}: ${names}.`,
          ),
    );
  } else if (!valid) {
    lines.push('Nothing on the map yet: no repo has a .architecture/ folder.');
  } else if (!options.plain) {
    lines.push(paint(['green', 'bold'], 'All tidy. Furio approves.'));
  }
  lines.push(paint('dim', `Wrote ${text(displayPath(options.output, options.cwd))}`));
  return lines.join('\n') + '\n';
}
