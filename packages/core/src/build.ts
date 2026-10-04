import { relative, sep } from 'node:path';
import type { Manifest } from '@getfurio/schema';
import { countBySeverity, type Diagnostic } from './diagnostics.js';
import { readInside } from './files.js';
import {
  MODEL_VERSION,
  type Model,
  type ModelComponent,
  type ModelDiagram,
  type ModelIssue,
  type ModelProject,
  type ModelRelation,
  type ModelRepo,
} from './model.js';
import type { SkippedRepo } from './github.js';
import { qualify, validateRepo, type ValidationResult } from './validate.js';

export interface RepoSource {
  /** Stable repo id, e.g. "furio-demo/shop-api". */
  id: string;
  /** Local checkout (or the folder that contains its `.architecture/`). */
  dir: string;
  url?: string;
  commit?: string;
}

export interface BuildOptions {
  workspace: string;
  /** Version of the tool that builds the model, recorded in it. */
  generatorVersion: string;
  now?: Date;
  /** Repos that were looked at but have nothing to contribute. */
  skipped?: SkippedRepo[];
}

export interface BuildResult {
  model: Model;
  /** Per repo, the final validation (with workspace-wide reference checks). */
  results: Map<string, ValidationResult>;
}

/**
 * Merges the manifests of many repos into one model. Repos with errors are left out (and listed
 * with their issues), so the map only ever shows valid data.
 */
export function buildModel(sources: RepoSource[], options: BuildOptions): BuildResult {
  const ordered = [...sources].sort((a, b) => a.id.localeCompare(b.id));

  // Pass 1: what does each repo declare? Needed to check references across repos.
  const known = new Set<string>();
  for (const source of ordered) {
    const manifest = validateRepo(source.dir).manifest;
    for (const component of manifest?.components ?? [])
      known.add(`${manifest!.project}/${component.id}`);
  }

  // Pass 2: validate again against the whole workspace.
  const results = new Map<string, ValidationResult>();
  const issues: ModelIssue[] = [];
  const repos: ModelRepo[] = [];
  const components = new Map<string, ModelComponent>();
  const relations: ModelRelation[] = [];
  const diagrams: ModelDiagram[] = [];

  for (const source of ordered) {
    const result = validateRepo(source.dir, { knownComponents: known });
    const extra: Diagnostic[] = [];
    const manifest = result.valid ? result.manifest : undefined;

    // Ids are unique per project, and a project can span repos: the first repo (by id) wins.
    if (manifest) {
      manifest.components.forEach((component, index) => {
        const owner = components.get(`${manifest.project}/${component.id}`);
        if (owner) {
          extra.push({
            severity: 'error',
            code: 'duplicate-component',
            message: `Component "${manifest.project}/${component.id}" is also declared by ${owner.repo}.`,
            hint: 'A component is declared once, in the repo that owns it; other repos reference it by id.',
            file: result.manifestPath!,
            path: ['components', index, 'id'],
          });
        }
      });
    }

    const diagnostics = [...result.diagnostics, ...extra];
    const { errors, warnings } = countBySeverity(diagnostics);
    results.set(source.id, { ...result, diagnostics, errors, warnings, valid: errors === 0 });
    for (const d of diagnostics) issues.push(toIssue(source, result, d));

    repos.push({
      id: source.id,
      ...(source.url ? { url: source.url } : {}),
      ...(source.commit ? { commit: source.commit } : {}),
      ...(result.manifest ? { project: result.manifest.project } : {}),
      ...(result.manifestPath
        ? { manifest: toPosix(relative(result.root, result.manifestPath)) }
        : {}),
      status: errors ? 'invalid' : 'valid',
      errors,
      warnings,
    });

    if (!manifest || errors) continue;
    addManifest(source, result, manifest, components, relations, diagrams);
  }

  for (const skipped of options.skipped ?? []) {
    repos.push({
      id: skipped.id,
      url: skipped.url,
      status: 'skipped',
      skipReason: skipped.reason,
      errors: 0,
      warnings: 0,
    });
  }
  repos.sort((a, b) => a.id.localeCompare(b.id));

  // Ghosts: referenced but declared by no valid repo.
  const declared = [...components.values()].sort((a, b) => a.key.localeCompare(b.key));
  const ghosts = new Map<string, ModelComponent>();
  const referenced = [...relations.map((r) => r.to), ...diagrams.flatMap((d) => d.components)];
  for (const key of referenced) {
    if (components.has(key) || ghosts.has(key)) continue;
    const [project, id] = key.split('/') as [string, string];
    ghosts.set(key, { key, project, id, ghost: true, tags: [], links: {} });
  }

  const allComponents = [
    ...declared,
    ...[...ghosts.values()].sort((a, b) => a.key.localeCompare(b.key)),
  ];
  const model: Model = {
    modelVersion: MODEL_VERSION,
    generatedAt: (options.now ?? new Date()).toISOString(),
    generator: { name: 'furio', version: options.generatorVersion },
    workspace: { id: options.workspace },
    projects: buildProjects(allComponents),
    repos,
    components: allComponents,
    relations,
    diagrams,
    issues,
  };
  return { model, results };
}

function addManifest(
  source: RepoSource,
  result: ValidationResult,
  manifest: Manifest,
  components: Map<string, ModelComponent>,
  relations: ModelRelation[],
  diagrams: ModelDiagram[],
) {
  const { project } = manifest;
  for (const c of manifest.components) {
    const key = `${project}/${c.id}`;
    if (components.has(key)) continue;
    const owner = c.owner ?? manifest.owner;
    components.set(key, {
      key,
      project,
      id: c.id,
      ghost: false,
      type: c.type,
      ...(c.name ? { name: c.name } : {}),
      ...(c.description ? { description: c.description } : {}),
      ...(owner ? { owner } : {}),
      ...(c.provider ? { provider: c.provider } : {}),
      ...(c.runtime ? { runtime: c.runtime } : {}),
      ...(c.tech ? { tech: c.tech } : {}),
      ...(c.path ? { path: c.path.replace(/\/+$/, '') } : {}),
      ...(c.host ? { host: c.host } : {}),
      ...(c.status && c.status !== 'active' ? { status: c.status } : {}),
      tags: c.tags ?? [],
      links: c.links ?? {},
      repo: source.id,
    });
  }
  for (const r of manifest.relations) {
    relations.push({
      from: `${project}/${r.from}`,
      to: qualify(r.to, project),
      type: r.type,
      ...(r.protocol ? { protocol: r.protocol } : {}),
      ...(r.description ? { description: r.description } : {}),
      ...(r.critical === false ? { critical: false as const } : {}),
      repo: source.id,
    });
  }
  for (const d of manifest.diagrams) {
    const file = toPosix(d.file).replace(/^\.\//, '');
    // Validation already refused what is not a regular file inside .architecture/.
    const read = readInside(result.architectureDir, d.file);
    if ('problem' in read) continue;
    diagrams.push({
      key: `${source.id}:${file}`,
      title: d.title,
      repo: source.id,
      project,
      file,
      format: file.toLowerCase().endsWith('.md') ? 'markdown' : 'mermaid',
      content: read.text,
      components: (d.components ?? []).map((ref) => qualify(ref, project)),
    });
  }
}

function buildProjects(components: ModelComponent[]): ModelProject[] {
  const projects = new Map<string, { repos: Set<string>; owners: Set<string>; ghost: boolean }>();
  for (const c of components) {
    const p = projects.get(c.project) ?? { repos: new Set(), owners: new Set(), ghost: true };
    if (!c.ghost) p.ghost = false;
    if (c.repo) p.repos.add(c.repo);
    if (c.owner) p.owners.add(c.owner);
    projects.set(c.project, p);
  }
  return [...projects.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([id, p]) => ({
      id,
      repos: [...p.repos].sort(),
      owners: [...p.owners].sort(),
      ghost: p.ghost,
    }));
}

function toIssue(source: RepoSource, result: ValidationResult, d: Diagnostic): ModelIssue {
  return {
    repo: source.id,
    severity: d.severity,
    code: d.code,
    message: d.message,
    ...(d.hint ? { hint: d.hint } : {}),
    file: toPosix(relative(result.root, d.file)) || '.',
    ...(d.line !== undefined ? { line: d.line } : {}),
    ...(d.column !== undefined ? { column: d.column } : {}),
  };
}

function toPosix(path: string): string {
  return path.split(sep).join('/');
}
