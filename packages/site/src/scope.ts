import type { ChangeMarks } from './extensions';
import { withNeighbours, type Model, type ModelComponent, type Site } from './model';
import { currentScope, href, type ViewState } from './router';

/**
 * A project's scope: what the pages show to a reader who came for one project. Its map shows the
 * project and the parts of other projects it touches; the catalog, health and diagrams only what
 * is the project's own.
 */
export interface Scope {
  project: string;
  /** Its components, the ones referenced and declared by no repo included. */
  own: Set<string>;
  /** What its map shows: its components and the parts of other projects they relate to. */
  map: Set<string>;
  /** The repos that declare it. */
  repos: Set<string>;
}

const scopes = new WeakMap<Site, Map<string, Scope>>();

export function projectScope(site: Site, project: string): Scope {
  const known = scopes.get(site) ?? scopes.set(site, new Map()).get(site)!;
  let scope = known.get(project);
  if (!scope) {
    const own = new Set(
      site.model.components.filter((c) => c.project === project).map((c) => c.key),
    );
    scope = {
      project,
      own,
      map: withNeighbours(site, own),
      repos: new Set(site.model.repos.filter((r) => r.project === project).map((r) => r.id)),
    };
    known.set(project, scope);
  }
  return scope;
}

/** What the pages list, in a project's scope or across the workspace. */
export interface Contents {
  /** Declared components: the catalog. */
  components: ModelComponent[];
  /** Referenced by a repo and declared by none; in a scope, the ones on its map. */
  ghosts: ModelComponent[];
  diagrams: Model['diagrams'];
  repos: Model['repos'];
  issues: Model['issues'];
  /**
   * Repos in no project: without a manifest, or with one Furio could not read. They belong to the
   * workspace: a scope does not list them.
   */
  unassigned: number;
}

export function contents(site: Site, scope?: Scope): Contents {
  const { model } = site;
  const unassigned = model.repos.filter((r) => !r.project).length;
  if (!scope)
    return {
      components: model.components.filter((c) => !c.ghost),
      ghosts: model.components.filter((c) => c.ghost),
      diagrams: model.diagrams,
      repos: model.repos,
      issues: model.issues,
      unassigned,
    };
  return {
    components: model.components.filter((c) => !c.ghost && scope.own.has(c.key)),
    ghosts: model.components.filter((c) => c.ghost && scope.map.has(c.key)),
    diagrams: model.diagrams.filter((d) => d.project === scope.project),
    repos: model.repos.filter((r) => scope.repos.has(r.id)),
    issues: model.issues.filter((i) => scope.repos.has(i.repo)),
    unassigned,
  };
}

/**
 * The marks of the Changes view that concern a scope: the parts on its map and the project's
 * removed ones. The relation counts are the extension's, which is told the project.
 */
export function marksIn(marks: ChangeMarks, scope: Scope): ChangeMarks {
  const { removed, ...rest } = marks;
  return {
    ...rest,
    components: Object.fromEntries(
      Object.entries(marks.components).filter(([key]) => scope.map.has(key)),
    ),
    ...(removed ? { removed: removed.filter((key) => key.startsWith(`${scope.project}/`)) } : {}),
  };
}

/**
 * The map with a component selected: the scope's when the component is on it, the workspace's
 * otherwise (the only map that shows it).
 */
export function mapWith(site: Site, key: string, view: Partial<ViewState> = {}): string {
  const project = currentScope();
  return project && projectScope(site, project).map.has(key)
    ? href.project(project, { ...view, sel: key })
    : href.workspace({ ...view, sel: key });
}
