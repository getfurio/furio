import { existsSync, readdirSync, statSync } from 'node:fs';
import {
  basename,
  dirname,
  extname,
  isAbsolute,
  join,
  normalize,
  relative,
  resolve,
  sep,
} from 'node:path';
import type { z } from 'zod';
import {
  ARCHITECTURE_DIR,
  COMPONENT_TYPES,
  DIAGRAM_EXTENSIONS,
  DiagramSchema,
  KNOWN_TECH,
  MANIFEST_FILE_NAMES,
  ManifestSchema,
  RELATION_TYPES,
  RelationSchema,
  SCHEMA_VERSION,
  SLUG_PATTERN,
  type Manifest,
} from '@getfurio/schema';
import {
  countBySeverity,
  printable,
  type Diagnostic,
  type DiagnosticCode,
  type Severity,
} from './diagnostics.js';
import { isSymlink, MAX_FILE_SIZE, readInside, type FileProblem } from './files.js';
import { closest } from './suggest.js';
import { YamlSource, type ManifestPath } from './yaml-source.js';

export interface ValidateOptions {
  /**
   * Components already known to the workspace, as "project/component" (for example from a
   * published model). With it, references to other repos are checked and typos get suggestions.
   */
  knownComponents?: Iterable<string>;
  /**
   * Check that each component's `path` exists in the repo. By default only when the repo is a
   * real checkout (it has more than its `.architecture/` folder), not when only the manifest was
   * received, as on Furio Cloud.
   */
  checkPaths?: boolean;
}

export interface ValidationResult {
  /** The repo root: the directory that contains `.architecture/`. */
  root: string;
  architectureDir: string;
  manifestPath?: string;
  /** Present when the manifest matches the schema (it may still have semantic errors). */
  manifest?: Manifest;
  diagnostics: Diagnostic[];
  errors: number;
  warnings: number;
  valid: boolean;
}

// Spaces and tabs only around the fence: \s would also run over new lines, and a file of blank
// lines would then take a time that grows with the square of its size.
const MERMAID_BLOCK = /^[ \t]*(```|~~~)[ \t]*mermaid\b/m;

/** "Did you mean" is a courtesy with a budget: a manifest full of mistakes stays quick to check. */
const MAX_SUGGESTIONS = 25;
/** A value quoted in a message is cut at this length. */
const MAX_QUOTED = 80;

/**
 * Validates the `.architecture/` folder of one repo. `target` can be the repo root, the
 * `.architecture/` folder itself, or the manifest file.
 */
export function validateRepo(target: string, options: ValidateOptions = {}): ValidationResult {
  const located = locateManifest(resolve(target));
  const diagnostics: Diagnostic[] = [...located.diagnostics];
  let manifest: Manifest | undefined;

  if (located.manifestPath) {
    const check = new ManifestCheck(located.manifestPath, located.architectureDir, options);
    manifest = check.run();
    diagnostics.push(...check.diagnostics);
  }

  diagnostics.sort(
    (a, b) =>
      a.file.localeCompare(b.file) ||
      (a.line ?? 0) - (b.line ?? 0) ||
      (a.column ?? 0) - (b.column ?? 0),
  );
  const { errors, warnings } = countBySeverity(diagnostics);
  return {
    root: dirname(located.architectureDir),
    architectureDir: located.architectureDir,
    manifestPath: located.manifestPath,
    manifest,
    // Messages quote the manifest and file names, which anyone who can open a pull request
    // writes: nothing in them may reach a terminal or a CI log as a control character.
    diagnostics: diagnostics.map((d) => ({
      ...d,
      message: printable(d.message),
      ...(d.hint ? { hint: printable(d.hint) } : {}),
    })),
    errors,
    warnings,
    valid: errors === 0,
  };
}

interface Located {
  architectureDir: string;
  manifestPath?: string;
  diagnostics: Diagnostic[];
}

function locateManifest(target: string): Located {
  if (existsSync(target) && statSync(target).isFile()) {
    return { architectureDir: dirname(target), manifestPath: target, diagnostics: [] };
  }
  const architectureDir =
    basename(target) === ARCHITECTURE_DIR ? target : join(target, ARCHITECTURE_DIR);
  if (isSymlink(architectureDir)) {
    return {
      architectureDir,
      diagnostics: [
        {
          severity: 'error',
          code: 'symlink-not-followed',
          message: `${ARCHITECTURE_DIR}/ is a symbolic link: Furio does not follow links.`,
          hint: `Make ${ARCHITECTURE_DIR}/ a real folder of the repo: a link could point anywhere on the machine that runs Furio.`,
          file: architectureDir,
        },
      ],
    };
  }
  const found = MANIFEST_FILE_NAMES.filter((name) => existsSync(join(architectureDir, name)));

  if (found.length > 1) {
    return {
      architectureDir,
      diagnostics: [
        {
          severity: 'error',
          code: 'manifest-ambiguous',
          message: `Both ${found.join(' and ')} exist in ${ARCHITECTURE_DIR}/; Furio reads only one.`,
          hint: `Keep ${MANIFEST_FILE_NAMES[0]} and delete ${found.slice(1).join(', ')}.`,
          file: join(architectureDir, found[1]!),
        },
      ],
    };
  }
  if (found.length === 1) {
    return { architectureDir, manifestPath: join(architectureDir, found[0]!), diagnostics: [] };
  }

  const wrongExtension = MANIFEST_FILE_NAMES.map((name) => name.replace(/\.yaml$/, '.yml')).find(
    (name) => existsSync(join(architectureDir, name)),
  );
  if (wrongExtension) {
    return {
      architectureDir,
      diagnostics: [
        {
          severity: 'error',
          code: 'manifest-wrong-extension',
          message: `Found ${wrongExtension}, but manifests must use the .yaml extension.`,
          hint: `Rename it to ${wrongExtension.replace(/\.yml$/, '.yaml')}.`,
          file: join(architectureDir, wrongExtension),
        },
      ],
    };
  }
  return {
    architectureDir,
    diagnostics: [
      {
        severity: 'error',
        code: 'manifest-not-found',
        message: `No manifest found: expected ${ARCHITECTURE_DIR}/${MANIFEST_FILE_NAMES[0]} (or ${MANIFEST_FILE_NAMES[1]}).`,
        hint: 'Run npx @getfurio/cli init to create one.',
        file: architectureDir,
      },
    ],
  };
}

class ManifestCheck {
  readonly diagnostics: Diagnostic[] = [];
  private source!: YamlSource;
  private data: unknown;
  private readonly known: Set<string>;
  private readonly hasKnown: boolean;
  private readonly checkPaths: boolean;
  private closed = false;
  private suggestions = 0;
  /** Links already reported, relative to `.architecture/`. */
  private readonly links = new Set<string>();

  constructor(
    private readonly file: string,
    private readonly architectureDir: string,
    options: ValidateOptions,
  ) {
    this.known = new Set(options.knownComponents ?? []);
    this.hasKnown = options.knownComponents !== undefined;
    this.checkPaths = options.checkPaths ?? isCheckout(dirname(architectureDir));
  }

  run(): Manifest | undefined {
    const name = basename(this.file);
    const read = readInside(dirname(this.file), name);
    if ('problem' in read) {
      const label =
        basename(this.architectureDir) === ARCHITECTURE_DIR ? `${ARCHITECTURE_DIR}/${name}` : name;
      this.diagnostics.push({
        severity: 'error',
        file: this.file,
        ...(read.problem === 'symlink' || read.problem === 'too-large'
          ? unreadable(read, label, name)
          : { code: 'manifest-not-found', message: `${label} is not a file.` }),
      });
      return undefined;
    }
    this.source = new YamlSource(read.text);
    const { doc } = this.source;
    for (const error of doc.errors) {
      const pos = this.source.positionOfOffset(error.pos[0]);
      this.add(
        'error',
        'yaml-syntax',
        `YAML syntax error: ${firstLine(error.message)}`,
        undefined,
        pos,
      );
    }
    if (doc.errors.length) return undefined;
    for (const warning of doc.warnings) {
      const pos = this.source.positionOfOffset(warning.pos[0]);
      this.add('warning', 'yaml-warning', `YAML: ${firstLine(warning.message)}`, undefined, pos);
    }

    try {
      this.data = doc.toJS();
    } catch (error) {
      // The parser refuses what would exhaust memory (aliases that multiply each other): the
      // manifest is invalid, and the other repos of a build go on.
      this.add(
        'error',
        'yaml-syntax',
        `YAML cannot be loaded: ${firstLine((error as Error).message)}.`,
        'Write the values out instead of repeating them with aliases (&name, *name).',
        { line: 1, column: 1 },
      );
      return undefined;
    }
    if (!isRecord(this.data)) {
      this.add(
        'error',
        'schema-invalid-value',
        'The manifest must be a YAML mapping (key: value pairs).',
        undefined,
        {
          line: 1,
          column: 1,
        },
      );
      return undefined;
    }

    const version = this.data.version;
    if (typeof version === 'number' && version !== SCHEMA_VERSION) {
      this.addAt(
        'error',
        'schema-unsupported-version',
        `Manifest version ${version} is not supported: this version of Furio reads version ${SCHEMA_VERSION}.`,
        ['version'],
        version > SCHEMA_VERSION
          ? 'Update furio to the latest version.'
          : `Set version: ${SCHEMA_VERSION}.`,
      );
      return undefined;
    }

    const parsed = ManifestSchema.safeParse(this.data);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) this.reportIssue(issue);
      // Report what the valid parts already tell, so one run shows every problem.
      const partial = this.partialManifest();
      if (partial) this.checkSemantics(partial, true);
      return undefined;
    }
    this.checkSemantics(parsed.data, false);
    return parsed.data;
  }

  /**
   * The parts of a manifest that failed the schema which are still usable: the project, and the
   * items that are valid on their own. Arrays keep their original indexes (invalid items are
   * holes, which forEach skips), so messages point at the right entries. Components only need a
   * valid id: their other fields do not matter to the reference checks.
   */
  private partialManifest(): Manifest | undefined {
    const data = this.data as Record<string, unknown>;
    if (typeof data.project !== 'string' || !SLUG_PATTERN.test(data.project)) return undefined;
    const pick = <T>(value: unknown, keep: (item: unknown) => T | undefined): T[] => {
      const out: T[] = [];
      if (Array.isArray(value))
        value.forEach((item, index) => {
          const kept = keep(item);
          if (kept !== undefined) out[index] = kept;
        });
      return out;
    };
    return {
      version: SCHEMA_VERSION,
      project: data.project,
      ...(typeof data.owner === 'string' && data.owner ? { owner: data.owner } : {}),
      components: pick(data.components, (item) =>
        isRecord(item) && typeof item.id === 'string' && SLUG_PATTERN.test(item.id)
          ? (item as Manifest['components'][number])
          : undefined,
      ),
      relations: pick(data.relations, (item) => {
        const r = RelationSchema.safeParse(item);
        return r.success ? r.data : undefined;
      }),
      diagrams: pick(data.diagrams, (item) => {
        const d = DiagramSchema.safeParse(item);
        return d.success ? d.data : undefined;
      }),
    } as Manifest;
  }

  // ---------------------------------------------------------------- schema issues

  private reportIssue(issue: z.core.$ZodIssue) {
    const path = issue.path.filter((p): p is string | number => typeof p !== 'symbol');
    const label = this.label(path);

    const parent = valueAt(this.data, path.slice(0, -1));
    const field = path.at(-1);
    if (
      (issue.code === 'invalid_type' || issue.code === 'invalid_value') &&
      typeof field === 'string' &&
      isRecord(parent) &&
      !(field in parent)
    ) {
      const where = path.length > 1 ? `${this.label(path.slice(0, -1))} is` : 'The manifest is';
      this.addAt(
        'error',
        'schema-missing-field',
        `${where} missing the required field "${field}".`,
        path,
      );
      return;
    }

    switch (issue.code) {
      case 'unrecognized_keys': {
        const allowed = allowedKeysAt(path);
        for (const key of issue.keys) {
          const suggestion = this.suggest(key, () => allowed);
          const where = path.length ? `in ${label}` : 'at the top level';
          this.addAt(
            'error',
            'schema-unknown-field',
            `Unknown field "${key}" ${where}.`,
            path,
            suggestion ? `Did you mean "${suggestion}"?` : `Allowed fields: ${allowed.join(', ')}.`,
            key,
          );
        }
        return;
      }
      case 'invalid_type': {
        this.addAt(
          'error',
          'schema-invalid-value',
          `${label} should be ${article(issue.expected)}, but it is ${describe(valueAt(this.data, path))}.`,
          path,
        );
        return;
      }
      case 'invalid_value': {
        const value = valueAt(this.data, path);
        const allowed = issue.values.map(String);
        const kind =
          field === 'type' && path[0] === 'components'
            ? 'component type'
            : field === 'type' && path[0] === 'relations'
              ? 'relation type'
              : 'value';
        const suggestion =
          typeof value === 'string' ? this.suggest(value, () => allowed) : undefined;
        this.addAt(
          'error',
          'schema-invalid-value',
          `${label} is ${describe(value)}, which is not a valid ${kind}.`,
          path,
          suggestion
            ? `Did you mean "${suggestion}"? Valid: ${allowed.join(', ')}.`
            : `Valid: ${allowed.join(', ')}.`,
        );
        return;
      }
      case 'invalid_format': {
        const value = valueAt(this.data, path);
        if (issue.format === 'regex') {
          const suggestion = typeof value === 'string' ? kebab(value) : '';
          this.addAt(
            'error',
            'schema-invalid-value',
            `${label} is ${describe(value)}: ${issue.message}.`,
            path,
            suggestion && suggestion !== value ? `Try "${suggestion}".` : undefined,
          );
        } else {
          this.addAt(
            'error',
            'schema-invalid-value',
            `${label} is ${describe(value)}, which is not a valid ${issue.format === 'url' ? 'URL' : issue.format}.`,
            path,
          );
        }
        return;
      }
      case 'too_small':
        if (issue.origin === 'string') {
          this.addAt('error', 'schema-invalid-value', `${label} must not be empty.`, path);
          return;
        }
        break;
    }
    this.addAt('error', 'schema-invalid-value', `${label}: ${issue.message}.`, path);
  }

  // ---------------------------------------------------------------- semantics

  private checkSemantics(manifest: Manifest, partial: boolean) {
    const project = manifest.project;
    const localIds = new Map<string, number>();
    this.closed = manifest.closed === true;

    if (!partial && !manifest.components.length) {
      const hasKey = isRecord(this.data) && 'components' in this.data;
      this.addAt(
        'warning',
        'no-components',
        'The manifest declares no components.',
        hasKey ? [] : ['project'],
        'Add the components this repo owns under components:.',
        hasKey ? 'components' : undefined,
      );
    }

    manifest.components.forEach((component, index) => {
      const first = localIds.get(component.id);
      if (first !== undefined) {
        this.addAt(
          'error',
          'duplicate-component',
          `Component id "${component.id}" is declared twice (components[${first}] and components[${index}]).`,
          ['components', index, 'id'],
          'Component ids must be unique within the project.',
        );
      } else {
        localIds.set(component.id, index);
      }
      this.checkComponentFields(component, index);
    });

    if (!manifest.owner) {
      const ownerless = manifest.components
        .map((component, index) => ({ component, index }))
        .filter(({ component, index }) => !component.owner && localIds.get(component.id) === index);
      if (ownerless.length === 1) {
        const { component, index } = ownerless[0]!;
        this.addAt(
          'warning',
          'missing-owner',
          `Component "${component.id}" has no owner.`,
          ['components', index, 'id'],
          'Add owner: to the component, or a default owner: at the top of the manifest.',
        );
      } else if (ownerless.length > 1) {
        this.addAt(
          'warning',
          'missing-owner',
          `${ownerless.length} components have no owner: ${ownerless.map(({ component }) => component.id).join(', ')}.`,
          ['project'],
          'Add a default owner: at the top of the manifest (components can still override it).',
        );
      }
    }

    const seenRelations = new Map<string, number>();
    manifest.relations.forEach((relation, index) => {
      const at = (field: string): ManifestPath => ['relations', index, field];
      if (!localIds.has(relation.from)) {
        const suggestion = this.suggest(relation.from, () => localIds.keys());
        this.addAt(
          'error',
          'unknown-from',
          `relations[${index}].from is "${relation.from}", which is not declared in this manifest.`,
          at('from'),
          suggestion
            ? `Did you mean "${suggestion}"?`
            : 'A relation starts from a component this repo owns: declare it under components:, or move the relation to the repo that owns it.',
        );
      }
      this.checkReference(relation.to, project, localIds, at('to'), `relations[${index}].to`);

      const target = qualify(relation.to, project);
      if (target === `${project}/${relation.from}`) {
        this.addAt(
          'warning',
          'self-relation',
          `relations[${index}] goes from "${relation.from}" to itself.`,
          at('to'),
        );
      }
      const key = `${relation.from} ${relation.type} ${target}`;
      const firstIndex = seenRelations.get(key);
      if (firstIndex !== undefined) {
        this.addAt(
          'warning',
          'duplicate-relation',
          `relations[${index}] repeats relations[${firstIndex}] (${relation.from} ${relation.type} ${relation.to}).`,
          ['relations', index],
          'Remove one of the two.',
        );
      } else {
        seenRelations.set(key, index);
      }
    });

    this.checkDiagrams(manifest, project, localIds);
  }

  /** tech near-misses and paths that do not exist: warnings, the manifest is still valid. */
  private checkComponentFields(component: Manifest['components'][number], index: number) {
    const tech = component.tech;
    if (typeof tech === 'string' && !KNOWN_TECH.includes(tech)) {
      const suggestion = this.suggest(tech, () => KNOWN_TECH);
      if (suggestion)
        this.addAt(
          'warning',
          'unknown-tech',
          `components[${index}].tech is "${tech}", which Furio does not know.`,
          ['components', index, 'tech'],
          `Did you mean "${suggestion}"? Any lowercase name works; this only catches typos.`,
        );
    }
    const path = component.path;
    if (this.checkPaths && typeof path === 'string') {
      const root = dirname(this.architectureDir);
      if (!existsSync(join(root, path)))
        this.addAt(
          'warning',
          'path-not-found',
          `components[${index}].path is "${path}", but the repo has no such folder.`,
          ['components', index, 'path'],
          'Paths are relative to the repo root, e.g. "apps/server".',
        );
    }
  }

  private checkReference(
    ref: string,
    project: string,
    localIds: Map<string, number>,
    path: ManifestPath,
    label: string,
  ) {
    const full = qualify(ref, project);
    const [refProject, id] = full.split('/') as [string, string];
    if (refProject === project && localIds.has(id)) return;
    if (this.known.has(full)) return;

    const sameProject = refProject === project;
    if (sameProject && this.closed) {
      const suggestion = this.suggest(id, () => localIds.keys());
      this.addAt(
        'error',
        'undeclared-component',
        `${label} points to "${ref}", which this manifest does not declare, and project "${project}" is closed (closed: true).`,
        path,
        suggestion
          ? `Did you mean "${suggestion}"?`
          : `Declare "${id}" under components:, or point to a component of another project ("project/${id}").`,
      );
      return;
    }
    if (this.hasKnown) {
      const suggestion = this.suggest(ref, () =>
        sameProject
          ? [
              ...localIds.keys(),
              ...[...this.known]
                .filter((k) => k.startsWith(`${project}/`))
                .map((k) => k.slice(project.length + 1)),
            ]
          : [...this.known, ...[...localIds.keys()].map((k) => `${project}/${k}`)],
      );
      this.addAt(
        'warning',
        'unresolved-reference',
        `${label} points to "${ref}", which no repo in the workspace declares.`,
        path,
        suggestion
          ? `Did you mean "${suggestion}"? Until it is declared, the map shows it as a ghost node.`
          : 'Until some repo declares it, the map shows it as a ghost node.',
      );
      return;
    }
    // Without the workspace model, only a near-miss of a local id is suspicious: a bare id may
    // legitimately live in another repo of the same project.
    if (sameProject) {
      const suggestion = this.suggest(id, () => localIds.keys());
      if (suggestion) {
        this.addAt(
          'warning',
          'unresolved-reference',
          `${label} points to "${ref}", which is not declared in this manifest.`,
          path,
          `Did you mean "${suggestion}"? If "${id}" lives in another repo of project "${project}", all good.`,
        );
      }
    }
  }

  private checkDiagrams(manifest: Manifest, project: string, localIds: Map<string, number>) {
    const declared = new Map<string, number>();
    const { files: diagramFiles, links } = listDiagramFiles(this.architectureDir);

    manifest.diagrams.forEach((diagram, index) => {
      const at = (field: string): ManifestPath => ['diagrams', index, field];
      const relativeFile = normalize(diagram.file);
      if (
        isAbsolute(relativeFile) ||
        relativeFile === '..' ||
        relativeFile.startsWith(`..${sep}`)
      ) {
        this.addAt(
          'error',
          'diagram-outside-architecture',
          `diagrams[${index}].file is "${diagram.file}", which is outside ${ARCHITECTURE_DIR}/.`,
          at('file'),
          `Paths are relative to ${ARCHITECTURE_DIR}/, e.g. "diagrams/checkout-flow.mmd".`,
        );
        return;
      }
      const ext = extname(relativeFile).toLowerCase();
      if (!(DIAGRAM_EXTENSIONS as readonly string[]).includes(ext)) {
        this.addAt(
          'error',
          'diagram-bad-extension',
          `diagrams[${index}].file is "${diagram.file}": diagrams must be .mmd files or .md files with mermaid blocks.`,
          at('file'),
        );
        return;
      }
      const key = relativeFile.split(sep).join('/');
      const first = declared.get(key);
      if (first !== undefined) {
        this.addAt(
          'warning',
          'diagram-duplicate',
          `diagrams[${index}] uses the same file as diagrams[${first}] ("${diagram.file}").`,
          at('file'),
        );
      } else {
        declared.set(key, index);
      }

      const read = readInside(this.architectureDir, relativeFile);
      if ('problem' in read) {
        if (read.problem === 'missing') {
          const suggestion = this.suggest(key, () => diagramFiles);
          this.addAt(
            'error',
            'diagram-not-found',
            `diagrams[${index}].file is "${diagram.file}", but ${ARCHITECTURE_DIR}/${key} does not exist.`,
            at('file'),
            suggestion ? `Did you mean "${suggestion}"?` : undefined,
          );
        } else if (read.problem === 'not-a-file') {
          this.addAt(
            'error',
            'diagram-not-found',
            `diagrams[${index}].file is "${diagram.file}", but ${ARCHITECTURE_DIR}/${key} is not a file.`,
            at('file'),
          );
        } else {
          if (read.problem === 'symlink') this.links.add(read.link);
          const { code, message, hint } = unreadable(
            read,
            `diagrams[${index}].file is "${diagram.file}", but ${ARCHITECTURE_DIR}/${key}`,
            key,
          );
          this.addAt('error', code, message, at('file'), hint);
        }
      } else {
        const content = read.text;
        if (ext === '.mmd' && !content.trim()) {
          this.addAt('error', 'diagram-empty', `${ARCHITECTURE_DIR}/${key} is empty.`, at('file'));
        }
        if (ext === '.md' && !MERMAID_BLOCK.test(content)) {
          this.addAt(
            'error',
            'diagram-no-mermaid-block',
            `${ARCHITECTURE_DIR}/${key} contains no \`\`\`mermaid block.`,
            at('file'),
            'Wrap the diagram in a fenced block that starts with ```mermaid.',
          );
        }
      }

      diagram.components?.forEach((ref, refIndex) => {
        const path: ManifestPath = ['diagrams', index, 'components', refIndex];
        const label = `diagrams[${index}].components[${refIndex}]`;
        this.checkReference(ref, project, localIds, path, label);
      });
    });

    for (const file of diagramFiles) {
      if (declared.has(file)) continue;
      let isDiagram = file.endsWith('.mmd');
      if (!isDiagram) {
        const read = readInside(this.architectureDir, file);
        isDiagram = 'text' in read && MERMAID_BLOCK.test(read.text);
      }
      if (!isDiagram) continue;
      this.diagnostics.push({
        severity: 'warning',
        code: 'diagram-unreferenced',
        message: `${ARCHITECTURE_DIR}/${file} is not listed under diagrams: in the manifest, so the map ignores it.`,
        hint: `Add it with:  - file: ${file}  and a title.`,
        file: join(this.architectureDir, file),
      });
    }

    for (const link of links) {
      if (this.links.has(link)) continue;
      this.diagnostics.push({
        severity: 'warning',
        code: 'symlink-not-followed',
        message: `${ARCHITECTURE_DIR}/${link} is a symbolic link: Furio does not follow links, so the map ignores it.`,
        hint: `Put the file itself in ${ARCHITECTURE_DIR}/, or delete the link.`,
        file: join(this.architectureDir, link),
      });
    }
  }

  // ---------------------------------------------------------------- helpers

  /** The closest candidate, while the budget lasts; candidates are listed only when needed. */
  private suggest(value: string, candidates: () => Iterable<string>): string | undefined {
    if (this.suggestions >= MAX_SUGGESTIONS) return undefined;
    this.suggestions++;
    return closest(value, candidates());
  }

  private label(path: ManifestPath): string {
    let out = '';
    path.forEach((part, i) => {
      if (typeof part === 'number') {
        out += `[${part}]`;
        const item = valueAt(this.data, path.slice(0, i + 1));
        if (i === 1 && path[0] === 'components' && isRecord(item) && typeof item.id === 'string') {
          out += ` (${item.id})`;
        }
      } else {
        out += out ? `.${part}` : part;
      }
    });
    return out || 'manifest';
  }

  private addAt(
    severity: Severity,
    code: DiagnosticCode,
    message: string,
    path: ManifestPath,
    hint?: string,
    key?: string,
  ) {
    const pos = this.source.positionOf(path, key);
    this.add(severity, code, message, hint, pos, key ? [...path, key] : path);
  }

  private add(
    severity: Severity,
    code: DiagnosticCode,
    message: string,
    hint: string | undefined,
    pos: { line: number; column: number } | undefined,
    path?: ManifestPath,
  ) {
    this.diagnostics.push({
      severity,
      code,
      message,
      ...(hint ? { hint } : {}),
      file: this.file,
      ...(pos ? { line: pos.line, column: pos.column } : {}),
      ...(path?.length ? { path } : {}),
    });
  }
}

/** "component" → "project/component" for the given project. */
export function qualify(ref: string, project: string): string {
  return ref.includes('/') ? ref : `${project}/${ref}`;
}

/** A real checkout has more than the `.architecture/` folder (Furio Cloud receives only that). */
function isCheckout(root: string): boolean {
  try {
    return readdirSync(root).some((name) => name !== ARCHITECTURE_DIR);
  } catch {
    return false;
  }
}

/**
 * The diagram files of `.architecture/` and the symbolic links in it, as paths relative to it.
 * Links are listed, never followed: not as folders to walk, not as files to read.
 */
function listDiagramFiles(architectureDir: string): { files: string[]; links: string[] } {
  const files: string[] = [];
  const links: string[] = [];
  const walk = (dir: string) => {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      const path = relative(architectureDir, full).split(sep).join('/');
      if (entry.isSymbolicLink()) links.push(path);
      else if (entry.isDirectory()) walk(full);
      else if (
        entry.isFile() &&
        (DIAGRAM_EXTENSIONS as readonly string[]).includes(extname(entry.name).toLowerCase())
      ) {
        files.push(path);
      }
    }
  };
  walk(architectureDir);
  return { files: files.sort(), links: links.sort() };
}

/**
 * Why Furio does not read a file that is there: a link, or too large. `path` is the file,
 * relative to `.architecture/`: the link may be the file or a folder above it.
 */
function unreadable(
  problem: Extract<FileProblem, { problem: 'symlink' | 'too-large' }>,
  label: string,
  path: string,
): Pick<Diagnostic, 'code' | 'message' | 'hint'> {
  if (problem.problem === 'symlink') {
    const what =
      problem.link === path
        ? 'a symbolic link'
        : `inside a symbolic link (${ARCHITECTURE_DIR}/${problem.link})`;
    return {
      code: 'symlink-not-followed',
      message: `${label} is ${what}: Furio does not follow links.`,
      hint: `Put the file itself in ${ARCHITECTURE_DIR}/: a link could point anywhere on the machine that runs Furio.`,
    };
  }
  return {
    code: 'file-too-large',
    message: `${label} is ${Math.ceil(problem.size / 1024)} KB: Furio reads files up to ${MAX_FILE_SIZE / 1024} KB.`,
  };
}

type AnySchema = { _zod: { def: Record<string, unknown> & { type: string } } };

function allowedKeysAt(path: ManifestPath): string[] {
  let schema = ManifestSchema as unknown as AnySchema;
  const unwrap = (s: AnySchema): AnySchema => {
    let current = s;
    while (['optional', 'default', 'nullable', 'prefault'].includes(current._zod.def.type)) {
      current = current._zod.def.innerType as AnySchema;
    }
    return current;
  };
  for (const part of path) {
    schema = unwrap(schema);
    const def = schema._zod.def;
    if (def.type === 'array' && typeof part === 'number') schema = def.element as AnySchema;
    else if (def.type === 'object' && typeof part === 'string') {
      const next = (def.shape as Record<string, AnySchema>)[part];
      if (!next) return [];
      schema = next;
    } else return [];
  }
  const def = unwrap(schema)._zod.def;
  return def.type === 'object' ? Object.keys(def.shape as object) : [];
}

function valueAt(data: unknown, path: ManifestPath): unknown {
  let current = data;
  for (const part of path) {
    if (current === null || typeof current !== 'object') return undefined;
    current = (current as Record<string | number, unknown>)[part];
  }
  return current;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function describe(value: unknown): string {
  if (value === null) return 'empty';
  if (Array.isArray(value)) return 'a list';
  if (typeof value === 'object') return 'a mapping';
  if (typeof value === 'string')
    return `"${value.length > MAX_QUOTED ? `${value.slice(0, MAX_QUOTED)}…` : value}"`;
  return String(value);
}

function article(expected: string): string {
  const names: Record<string, string> = {
    string: 'text',
    number: 'a number',
    array: 'a list',
    object: 'a mapping',
    boolean: 'true or false',
  };
  return names[expected] ?? expected;
}

function kebab(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function firstLine(message: string): string {
  return message.split('\n')[0]!.trim();
}

export const VOCABULARY = { componentTypes: COMPONENT_TYPES, relationTypes: RELATION_TYPES };
