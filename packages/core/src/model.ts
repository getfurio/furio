import type { ComponentStatus, ComponentType, RelationType } from '@getfurio/schema';
import type { DiagnosticCode, Severity } from './diagnostics.js';

export const MODEL_VERSION = 1;

/**
 * The aggregated model of a workspace: every repo's manifest merged, references resolved. It is
 * the contract between the engine and any map (the static site, Furio Cloud).
 */
export interface Model {
  modelVersion: typeof MODEL_VERSION;
  generatedAt: string;
  generator: { name: 'furio'; version: string };
  workspace: { id: string };
  projects: ModelProject[];
  repos: ModelRepo[];
  /** Declared components first, then ghosts (referenced but declared by no repo). */
  components: ModelComponent[];
  relations: ModelRelation[];
  diagrams: ModelDiagram[];
  issues: ModelIssue[];
}

export interface ModelProject {
  id: string;
  /** Repos that declare components of this project. */
  repos: string[];
  owners: string[];
  /** True when no repo declares this project: it only appears in references. */
  ghost: boolean;
}

export interface ModelRepo {
  /** e.g. "furio-demo/shop-api". */
  id: string;
  url?: string;
  commit?: string;
  project?: string;
  /** Manifest path relative to the repo root, when found. */
  manifest?: string;
  /**
   * Invalid repos are left out of the map; their issues explain why. Repos without a manifest
   * (or empty, or archived) are listed as skipped, so the map knows who has not joined yet.
   */
  status: 'valid' | 'invalid' | 'skipped';
  skipReason?: 'no-manifest' | 'empty' | 'archived';
  errors: number;
  warnings: number;
}

export interface ModelComponent {
  /** "project/component", unique in the workspace. */
  key: string;
  project: string;
  id: string;
  ghost: boolean;
  type?: ComponentType;
  name?: string;
  description?: string;
  owner?: string;
  provider?: string;
  runtime?: string;
  tech?: string;
  /** Folder of the component in its repo, e.g. "apps/server". */
  path?: string;
  host?: string;
  /** Absent means active. */
  status?: Exclude<ComponentStatus, 'active'>;
  tags: string[];
  links: Record<string, string>;
  repo?: string;
}

export interface ModelRelation {
  from: string;
  to: string;
  type: RelationType;
  protocol?: string;
  description?: string;
  repo: string;
}

export interface ModelDiagram {
  /** "repo-id:path", unique in the workspace. */
  key: string;
  title: string;
  repo: string;
  project: string;
  /** Path relative to .architecture/. */
  file: string;
  format: 'mermaid' | 'markdown';
  /** Raw file content: Mermaid source, or Markdown with ```mermaid blocks. */
  content: string;
  components: string[];
}

export interface ModelIssue {
  repo: string;
  severity: Severity;
  code: DiagnosticCode;
  message: string;
  hint?: string;
  /** Relative to the repo root. */
  file: string;
  line?: number;
  column?: number;
}
