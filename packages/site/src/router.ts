import { useEffect, useMemo, useState } from 'react';

/**
 * Hash routes, so the static site works on any host and sub-path without server rewrites:
 * #/ workspace · #/c/<project>/<component> · #/health · #/catalog[?type=…&q=…&owner=…&tag=…]
 * · #/diagrams[?q=…&project=…] · #/diagrams?d=<key> (one diagram)
 *
 * A project is a scope: #/p/<project> is its map (the project and the parts of other projects it
 * touches), and the pages under it show that project only, e.g. #/p/<project>/catalog or
 * #/p/<project>/c/<project>/<component>. Links keep the scope of the page they are on.
 *
 * Map views carry their state in the query, so any view can be shared as a link:
 * ?sel=<project/component>&mode=impact|depends&depth=<n>&type=a,b&tech=…&owner=…&host=…&only=1
 * &arrange=tiers|around&dir=right|down&group=owner|host|type&around=<project/component>
 */
export type Mode = 'nets' | 'impact' | 'depends';

/** How the map is laid out: by what depends on what, in bands by kind, or around one component. */
export const ARRANGEMENTS = ['flow', 'tiers', 'around'] as const;
export type Arrangement = (typeof ARRANGEMENTS)[number];
/** What a board of the flow gathers. */
export const GROUPINGS = ['project', 'owner', 'host', 'type'] as const;
export type Grouping = (typeof GROUPINGS)[number];
/** Which way the layers run; without it the map picks what fits the canvas. */
export type Flow = 'right' | 'down';

export interface ViewState {
  sel?: string;
  mode: Mode;
  /** Hops followed in impact and depends modes; 0 means all. */
  depth: number;
  /**
   * Facet filters: OR within a facet, AND across facets. Matching cards are highlighted and the
   * rest dimmed, unless `only` hides them.
   */
  filter: Filter;
  /** Show only the matching cards (and lay the map out again). */
  only?: boolean;
  /** The Changes view: a period an extension understands (e.g. "7" days, "last"). */
  since?: string;
  /** The arrangement, when it is not the flow. */
  arrange?: Exclude<Arrangement, 'flow'>;
  /** The direction of the layers, when the viewer chose one. */
  dir?: Flow;
  /** What the boards of the flow gather, when it is not the projects. */
  group?: Exclude<Grouping, 'project'>;
  /** The component at the centre, when the map is arranged around one. */
  around?: string;
}

/** The pages; the map of a project is the root of its scope, the others carry it when they have one. */
export type Route =
  | { name: 'workspace'; view: ViewState }
  | { name: 'project'; project: string; view: ViewState }
  | { name: 'component'; key: string; scope?: string }
  | { name: 'health'; scope?: string }
  | { name: 'diagrams'; diagram?: string; q?: string; projects?: string[]; scope?: string }
  | { name: 'catalog'; type?: string; q?: string; filter?: CatalogFilter; scope?: string };

export const FILTERS = ['type', 'tech', 'owner', 'host', 'provider', 'status'] as const;
export type FilterKey = (typeof FILTERS)[number];
export type Filter = Partial<Record<FilterKey, string[]>>;

export function hasFilter(filter: Filter): boolean {
  return FILTERS.some((key) => filter[key]?.length);
}

/** What the catalog's menus filter on, besides the type of its tabs and the search. */
export const CATALOG_FILTERS = [
  'project',
  'owner',
  'tech',
  'host',
  'provider',
  'status',
  'tag',
] as const;
export type CatalogFilterKey = (typeof CATALOG_FILTERS)[number];
export type CatalogFilter = Partial<Record<CatalogFilterKey, string[]>>;

/** What narrows the grid of diagrams: a search and, across the workspace, some of its projects. */
export interface DiagramFind {
  q?: string | undefined;
  projects?: string[] | undefined;
}

/**
 * Several values in one parameter, comma-separated as in `owner=a,b`. A comma inside a value is
 * written %2C, so a team called "Payments, Billing" stays one value.
 */
const joinList = (values: string[]) =>
  values.map((value) => value.replace(/%/g, '%25').replace(/,/g, '%2C')).join(',');

const splitList = (text: string | null) =>
  (text ?? '')
    .split(',')
    .filter(Boolean)
    .map((value) => value.replace(/%(2C|25)/gi, (_, code: string) => (code === '25' ? '%' : ',')));

/** A query as it reads in a link: the slashes of a key and the commas of a list left as they are. */
const queryOf = (params: URLSearchParams) => {
  const query = params.toString().replace(/%2F/g, '/').replace(/%2C/g, ',');
  return query ? `?${query}` : '';
};

export function parseView(query: string): ViewState {
  const params = new URLSearchParams(query);
  const mode = params.get('mode');
  const depth = Number(params.get('depth') ?? '0');
  const view: ViewState = {
    mode: mode === 'impact' || mode === 'depends' ? mode : 'nets',
    depth: Number.isInteger(depth) && depth > 0 ? depth : 0,
    filter: {},
  };
  const sel = params.get('sel');
  if (sel) view.sel = sel;
  const since = params.get('since');
  if (since && /^[\w-]{1,20}$/.test(since)) view.since = since;
  for (const key of FILTERS) {
    const values = splitList(params.get(key));
    if (values.length) view.filter[key] = values;
  }
  if (params.get('only') === '1' && hasFilter(view.filter)) view.only = true;
  const arrange = params.get('arrange');
  if (arrange === 'tiers' || arrange === 'around') view.arrange = arrange;
  const dir = params.get('dir');
  if ((dir === 'right' || dir === 'down') && view.arrange !== 'around') view.dir = dir;
  const group = params.get('group');
  if ((group === 'owner' || group === 'host' || group === 'type') && !view.arrange)
    view.group = group;
  const around = params.get('around');
  if (around && view.arrange === 'around') view.around = around;
  return view;
}

/** The view on a map that offers no other arrangement than the flow: the rest of it, as it is. */
export function flowOnly(view: ViewState): ViewState {
  const plain = { ...view };
  delete plain.arrange;
  delete plain.dir;
  delete plain.group;
  delete plain.around;
  return plain;
}

export function serializeView(view: ViewState): string {
  const params = new URLSearchParams();
  if (view.sel) params.set('sel', view.sel);
  if (view.sel && view.mode !== 'nets') params.set('mode', view.mode);
  if (view.sel && view.mode !== 'nets' && view.depth) params.set('depth', String(view.depth));
  for (const key of FILTERS)
    if (view.filter[key]?.length) params.set(key, joinList(view.filter[key]!));
  if (view.only && hasFilter(view.filter)) params.set('only', '1');
  if (view.since) params.set('since', view.since);
  if (view.arrange) params.set('arrange', view.arrange);
  if (view.dir && view.arrange !== 'around') params.set('dir', view.dir);
  if (view.group && !view.arrange) params.set('group', view.group);
  if (view.around && view.arrange === 'around') params.set('around', view.around);
  return queryOf(params);
}

export function parseHash(hash: string): Route {
  const [path = '', query = ''] = hash.replace(/^#\/?/, '').split('?');
  const parts = path.split('/').filter(Boolean).map(decodeURIComponent);
  if (parts[0] === 'p' && parts[1]) {
    const route = pageRoute(parts.slice(2), query, parts[1]);
    return route.name === 'workspace'
      ? { name: 'project', project: parts[1], view: route.view }
      : route;
  }
  return pageRoute(parts, query);
}

/** A page from its path, inside a project's scope when one is given. */
function pageRoute(parts: string[], query: string, scope?: string): Route {
  const scoped = scope ? { scope } : {};
  if (parts[0] === 'c' && parts[1] && parts[2])
    return { name: 'component', key: `${parts[1]}/${parts[2]}`, ...scoped };
  if (parts[0] === 'health' || parts[0] === 'repos') return { name: 'health', ...scoped };
  if (parts[0] === 'catalog') {
    const params = new URLSearchParams(query);
    const type = params.get('type');
    const q = params.get('q');
    const filter: CatalogFilter = {};
    for (const key of CATALOG_FILTERS) {
      // In a scope every row is the project's: a project in the link filters nothing there.
      const values = key === 'project' && scope ? [] : splitList(params.get(key));
      if (values.length) filter[key] = values;
    }
    return {
      name: 'catalog',
      ...(type ? { type } : {}),
      ...(q ? { q } : {}),
      ...(Object.keys(filter).length ? { filter } : {}),
      ...scoped,
    };
  }
  if (parts[0] === 'diagrams') {
    const params = new URLSearchParams(query);
    const diagram = params.get('d');
    const q = params.get('q');
    const projects = scope ? [] : splitList(params.get('project'));
    return {
      name: 'diagrams',
      ...(diagram ? { diagram } : {}),
      ...(q ? { q } : {}),
      ...(projects.length ? { projects } : {}),
      ...scoped,
    };
  }
  return { name: 'workspace', view: parseView(query) };
}

/** The project a page is scoped to, if any. */
export function routeScope(route: Route): string | undefined {
  if (route.name === 'project') return route.project;
  return route.name === 'workspace' ? undefined : route.scope;
}

/** The scope of the page on screen: the links of the map keep it. */
export function currentScope(): string | undefined {
  const hash = typeof window === 'undefined' ? undefined : window.location?.hash;
  return hash ? routeScope(parseHash(hash)) : undefined;
}

/** Records the view in the URL without a navigation, so it can be shared as is. */
export function replaceView(view: ViewState) {
  const [path] = window.location.hash.split('?');
  replaceHash(`${path || '#/'}${serializeView(view)}`);
}

const REPLACED = 'furio-replace';

/**
 * Records what the page shows in the URL without a navigation; the links built from the URL on
 * screen (leaving the scope, another project) follow it.
 */
export function replaceHash(next: string) {
  if (next === window.location.hash) return;
  history.replaceState(null, '', next);
  window.dispatchEvent(new Event(REPLACED));
}

/** The page on screen as its URL says now, with what the page has recorded in it since. */
export function useHere(): Route {
  const [hash, setHash] = useState(() => window.location.hash);
  useEffect(() => {
    const update = () => setHash(window.location.hash);
    window.addEventListener('hashchange', update);
    window.addEventListener(REPLACED, update);
    return () => {
      window.removeEventListener('hashchange', update);
      window.removeEventListener(REPLACED, update);
    };
  }, []);
  return useMemo(() => parseHash(hash), [hash]);
}

const withView = (view?: Partial<ViewState>) =>
  view ? serializeView({ mode: 'nets', depth: 0, ...view, filter: view.filter ?? {} }) : '';

/** The pages of the map inside a project's scope, or across the workspace without one. */
export function linksIn(scope?: string) {
  const base = scope ? `#/p/${encodeURIComponent(scope)}` : '#';
  return {
    /** The project's map in a scope, the workspace's otherwise. */
    map: (view?: Partial<ViewState>) => `${scope ? base : '#/'}${withView(view)}`,
    component: (key: string) => `${base}/c/${key.split('/').map(encodeURIComponent).join('/')}`,
    health: () => `${base}/health`,
    /** The table of every component, optionally one type, a search and the values of its menus. */
    catalog: (type?: string, q?: string, filter: CatalogFilter = {}) => {
      const params = new URLSearchParams();
      if (type) params.set('type', type);
      if (q) params.set('q', q);
      for (const key of CATALOG_FILTERS) {
        const values = key === 'project' && scope ? [] : (filter[key] ?? []);
        if (values.length) params.set(key, joinList(values));
      }
      return `${base}/catalog${queryOf(params)}`;
    },
    /**
     * The grid of diagrams, or one diagram on its own page when a key is given. What narrowed the
     * grid goes along, so the page of a diagram moves among the ones found and leads back to them.
     */
    diagrams: (key?: string, find: DiagramFind = {}) => {
      const params = new URLSearchParams();
      if (key) params.set('d', key);
      if (find.q) params.set('q', find.q);
      if (find.projects?.length && !scope) params.set('project', joinList(find.projects));
      return `${base}/diagrams${queryOf(params)}`;
    },
  };
}

/** Links from the page on screen: the pages keep its scope, if it has one. */
export const href = {
  /** The whole workspace, out of any scope. */
  workspace: (view?: Partial<ViewState>) => `#/${withView(view)}`,
  /** A project's map, which is also the way into its scope. */
  project: (project: string, view?: Partial<ViewState>) =>
    `#/p/${encodeURIComponent(project)}${withView(view)}`,
  map: (view?: Partial<ViewState>) => linksIn(currentScope()).map(view),
  component: (key: string) => linksIn(currentScope()).component(key),
  health: () => linksIn(currentScope()).health(),
  catalog: (type?: string, q?: string, filter?: CatalogFilter) =>
    linksIn(currentScope()).catalog(type, q, filter),
  diagrams: (key?: string, find?: DiagramFind) => linksIn(currentScope()).diagrams(key, find),
};

/**
 * The page on screen in another scope. Without one (the whole workspace) it keeps everything it
 * shows; in another project, the same page with what still applies there (the catalog's tab,
 * search and menus; the search of the diagrams). A component page becomes the project's map.
 */
export function pageIn(route: Route, scope?: string): string {
  const to = linksIn(scope);
  switch (route.name) {
    case 'workspace':
    case 'project':
      return to.map(scope ? undefined : route.view);
    case 'component':
      return scope ? to.map() : to.component(route.key);
    case 'health':
      return to.health();
    case 'catalog':
      return to.catalog(route.type, route.q, route.filter);
    case 'diagrams':
      return to.diagrams(scope ? undefined : route.diagram, {
        q: route.q,
        projects: route.projects,
      });
  }
}

/** A link to a page of the map from elsewhere (an extension), kept in the scope on screen. */
export function inScope(link: string): string {
  const scope = currentScope();
  if (!scope || !link.startsWith('#/') || link.startsWith('#/p/')) return link;
  const rest = link.slice(2);
  return `#/p/${encodeURIComponent(scope)}${rest && !rest.startsWith('?') ? '/' : ''}${rest}`;
}

export function go(to: string) {
  window.location.hash = to.slice(1);
}

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parseHash(window.location.hash));
  useEffect(() => {
    const onChange = () => setRoute(parseHash(window.location.hash));
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return route;
}

/**
 * Selects a component on the map on screen, without leaving it; when the map does not show it
 * (another page, filtered out), opens the map of the scope with it selected (the search finds only
 * what that map shows).
 */
export function selectOnMap(key: string) {
  const handled = !window.dispatchEvent(
    new CustomEvent('furio-select', { detail: key, cancelable: true }),
  );
  if (!handled) go(href.map({ sel: key }));
}

/**
 * The pages visited in this tab, so pages can offer "Back" to where the reader came from inside
 * the map (and not to the site before it).
 */
const trail: string[] = typeof window === 'undefined' ? [] : [window.location.hash];
if (typeof window !== 'undefined')
  window.addEventListener('hashchange', () => {
    const now = window.location.hash;
    const path = (h: string) => h.split('?')[0];
    if (trail.length > 1 && path(trail[trail.length - 2]!) === path(now)) trail.pop();
    else if (path(trail[trail.length - 1] ?? '') !== path(now)) trail.push(now);
    else trail[trail.length - 1] = now;
  });

/** Where Back goes: the previous page of the map in this tab, if any. */
export function backTarget(): string | undefined {
  return trail.length > 1 ? trail[trail.length - 2] : undefined;
}
