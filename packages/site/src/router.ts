import { useEffect, useState } from 'react';

/**
 * Hash routes, so the static site works on any host and sub-path without server rewrites:
 * #/ workspace · #/p/<project> · #/c/<project>/<component> · #/health · #/diagrams[?d=<key>]
 *
 * Map views carry their state in the query, so any view can be shared as a link:
 * ?sel=<project/component>&mode=impact|depends&depth=<n>&type=a,b&tech=…&owner=…&host=…&only=1
 */
export type Mode = 'nets' | 'impact' | 'depends';

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
}

export type Route =
  | { name: 'workspace'; view: ViewState }
  | { name: 'project'; project: string; view: ViewState }
  | { name: 'component'; key: string }
  | { name: 'health' }
  | { name: 'diagrams'; diagram?: string }
  | { name: 'catalog'; type?: string; q?: string };

export const FILTERS = ['type', 'tech', 'owner', 'host', 'provider', 'status'] as const;
export type FilterKey = (typeof FILTERS)[number];
export type Filter = Partial<Record<FilterKey, string[]>>;

export function hasFilter(filter: Filter): boolean {
  return FILTERS.some((key) => filter[key]?.length);
}

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
    const values = (params.get(key) ?? '').split(',').filter(Boolean);
    if (values.length) view.filter[key] = values;
  }
  if (params.get('only') === '1' && hasFilter(view.filter)) view.only = true;
  return view;
}

export function serializeView(view: ViewState): string {
  const params = new URLSearchParams();
  if (view.sel) params.set('sel', view.sel);
  if (view.sel && view.mode !== 'nets') params.set('mode', view.mode);
  if (view.sel && view.mode !== 'nets' && view.depth) params.set('depth', String(view.depth));
  for (const key of FILTERS)
    if (view.filter[key]?.length) params.set(key, view.filter[key]!.join(','));
  if (view.only && hasFilter(view.filter)) params.set('only', '1');
  if (view.since) params.set('since', view.since);
  const query = params.toString().replace(/%2F/g, '/').replace(/%2C/g, ',');
  return query ? `?${query}` : '';
}

export function parseHash(hash: string): Route {
  const [path = '', query = ''] = hash.replace(/^#\/?/, '').split('?');
  const parts = path.split('/').filter(Boolean).map(decodeURIComponent);
  const view = parseView(query);
  if (parts[0] === 'p' && parts[1]) return { name: 'project', project: parts[1], view };
  if (parts[0] === 'c' && parts[1] && parts[2])
    return { name: 'component', key: `${parts[1]}/${parts[2]}` };
  if (parts[0] === 'health' || parts[0] === 'repos') return { name: 'health' };
  if (parts[0] === 'catalog') {
    const params = new URLSearchParams(query);
    const type = params.get('type');
    const q = params.get('q');
    return { name: 'catalog', ...(type ? { type } : {}), ...(q ? { q } : {}) };
  }
  if (parts[0] === 'diagrams') {
    const diagram = new URLSearchParams(query).get('d');
    return diagram ? { name: 'diagrams', diagram } : { name: 'diagrams' };
  }
  return { name: 'workspace', view };
}

/** Records the view in the URL without a navigation, so it can be shared as is. */
export function replaceView(view: ViewState) {
  const [path] = window.location.hash.split('?');
  const next = `${path || '#/'}${serializeView(view)}`;
  if (next !== window.location.hash) history.replaceState(null, '', next);
}

const withView = (view?: Partial<ViewState>) =>
  view ? serializeView({ mode: 'nets', depth: 0, ...view, filter: view.filter ?? {} }) : '';

export const href = {
  workspace: (view?: Partial<ViewState>) => `#/${withView(view)}`,
  project: (project: string, view?: Partial<ViewState>) =>
    `#/p/${encodeURIComponent(project)}${withView(view)}`,
  component: (key: string) => `#/c/${key.split('/').map(encodeURIComponent).join('/')}`,
  health: () => '#/health',
  /** The table of every component, optionally one type and a search. */
  catalog: (type?: string, q?: string) => {
    const params = new URLSearchParams();
    if (type) params.set('type', type);
    if (q) params.set('q', q);
    const query = params.toString();
    return `#/catalog${query ? `?${query}` : ''}`;
  },
  /** The diagrams page, scrolled to one diagram when a key is given. */
  diagrams: (key?: string) => `#/diagrams${key ? `?d=${encodeURIComponent(key)}` : ''}`,
};

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
 * (another page, filtered out), opens the workspace map with it selected.
 */
export function selectOnMap(key: string) {
  const handled = !window.dispatchEvent(
    new CustomEvent('furio-select', { detail: key, cancelable: true }),
  );
  if (!handled) go(href.workspace({ sel: key }));
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
