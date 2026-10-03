import type { Model, ModelComponent, ModelRelation } from '@getfurio/core';

export type { Model, ModelComponent, ModelRelation };

/** Reference designator prefix per component type, as on a board's silkscreen. */
const PREFIX: Record<string, string> = {
  service: 'SVC',
  function: 'FN',
  job: 'JOB',
  frontend: 'UI',
  queue: 'Q',
  topic: 'TOP',
  database: 'DB',
  cache: 'CA',
  storage: 'ST',
  external: 'EXT',
  client: 'APP',
  proxy: 'PX',
  domain: 'DOM',
};

const TYPE_ORDER = Object.keys(PREFIX);

export interface Site {
  model: Model;
  byKey: Map<string, ModelComponent>;
  designator: Map<string, string>;
  incoming: Map<string, ModelRelation[]>;
  outgoing: Map<string, ModelRelation[]>;
  /** Every component key in reading order (project, then type, then id): j / k follow it. */
  order: string[];
  projectIds: string[];
  /** A stable colour per project, for the sidebar dot and the group label. */
  projectColor: Map<string, string>;
}

const PROJECT_COLORS = [
  '#7170ff',
  '#3fb68b',
  '#e5a54b',
  '#e5484d',
  '#4cb3d4',
  '#c084fc',
  '#f472b6',
];

export async function loadModel(url = './model.json'): Promise<Model> {
  const response = await fetch(url, { cache: 'no-cache' });
  if (!response.ok) throw new Error(`model.json returned HTTP ${response.status}`);
  const model = (await response.json()) as Model;
  if (model.modelVersion !== 1)
    throw new Error(`Unsupported model version ${String(model.modelVersion)}`);
  return model;
}

export function indexModel(model: Model): Site {
  const byKey = new Map(model.components.map((c) => [c.key, c]));
  const incoming = new Map<string, ModelRelation[]>();
  const outgoing = new Map<string, ModelRelation[]>();
  for (const r of model.relations) {
    (outgoing.get(r.from) ?? outgoing.set(r.from, []).get(r.from)!).push(r);
    (incoming.get(r.to) ?? incoming.set(r.to, []).get(r.to)!).push(r);
  }

  const sorted = [...model.components].sort(
    (a, b) =>
      a.project.localeCompare(b.project) ||
      Number(a.ghost) - Number(b.ghost) ||
      typeRank(a) - typeRank(b) ||
      a.id.localeCompare(b.id),
  );

  const designator = new Map<string, string>();
  const counters = new Map<string, number>();
  for (const c of sorted) {
    if (c.ghost) {
      designator.set(c.key, 'DNP');
      continue;
    }
    const prefix = PREFIX[c.type ?? ''] ?? 'X';
    const counter = `${c.project}:${prefix}`;
    const n = (counters.get(counter) ?? 0) + 1;
    counters.set(counter, n);
    designator.set(c.key, `${prefix}${n}`);
  }

  return {
    model,
    byKey,
    designator,
    incoming,
    outgoing,
    order: sorted.map((c) => c.key),
    projectIds: model.projects.map((p) => p.id),
    projectColor: new Map(
      model.projects.map((p, i) => [
        p.id,
        p.ghost ? '#6b6f78' : PROJECT_COLORS[i % PROJECT_COLORS.length]!,
      ]),
    ),
  };
}

function typeRank(c: ModelComponent): number {
  const i = TYPE_ORDER.indexOf(c.type ?? '');
  return i === -1 ? TYPE_ORDER.length : i;
}

export function displayName(c: ModelComponent): string {
  return c.name ?? c.id;
}

export const TYPE_LABEL: Record<string, string> = {
  service: 'Service',
  function: 'Function',
  job: 'Job',
  frontend: 'Frontend',
  queue: 'Queue',
  topic: 'Topic',
  database: 'Database',
  cache: 'Cache',
  storage: 'Storage',
  external: 'External',
  client: 'Client app',
  proxy: 'Proxy',
  domain: 'Domain',
};

export const STATUS_LABEL: Record<string, string> = {
  deprecated: 'Deprecated',
  'dev-only': 'Dev only',
};

/** A link to the component's folder on its repo's host, when both are known. */
export function codeUrl(site: Site, c: ModelComponent): string | undefined {
  const repo = site.model.repos.find((r) => r.id === c.repo);
  if (!c.path || !repo?.url || !/^https:\/\/github\.com\//.test(repo.url)) return undefined;
  const ref = repo.commit ?? 'HEAD';
  return `${repo.url}/tree/${ref}/${c.path.split('/').map(encodeURIComponent).join('/')}`;
}

export interface SearchHit {
  component: ModelComponent;
  score: number;
}

/** Ranks components by how well every word of the query matches their fields. */
export function search(site: Site, query: string, limit = 12): SearchHit[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const hits: SearchHit[] = [];
  for (const c of site.model.components) {
    const fields: [string, number][] = [
      [c.id, 6],
      [c.key, 5],
      [c.name ?? '', 5],
      [c.type ?? '', 3],
      [c.provider ?? '', 3],
      [c.runtime ?? '', 2],
      [c.tech ?? '', 3],
      [c.host ?? '', 2],
      [c.path ?? '', 2],
      [c.owner ?? '', 3],
      [c.project, 2],
      [c.tags.join(' '), 2],
      [c.description ?? '', 1],
      [site.designator.get(c.key) ?? '', 4],
    ];
    let score = 0;
    for (const word of words) {
      let best = 0;
      for (const [text, weight] of fields) {
        const t = text.toLowerCase();
        if (!t) continue;
        if (t === word) best = Math.max(best, weight * 3);
        else if (t.startsWith(word)) best = Math.max(best, weight * 2);
        else if (t.includes(word)) best = Math.max(best, weight);
      }
      if (!best) {
        score = 0;
        break;
      }
      score += best;
    }
    if (score) hits.push({ component: c, score: c.ghost ? score - 1 : score });
  }
  return hits
    .sort((a, b) => b.score - a.score || a.component.key.localeCompare(b.component.key))
    .slice(0, limit);
}

/**
 * A short fingerprint of the repo commits the map was built from: it changes whenever any repo on
 * the map changes. "local" when the model was built from folders without commits.
 */
export function revision(model: Model): string {
  const commits = model.repos
    .filter((r) => r.commit)
    .map((r) => `${r.id}@${r.commit}`)
    .sort();
  if (!commits.length) return 'local';
  let hash = 0x811c9dc5;
  for (const char of commits.join('\n')) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0').slice(0, 7);
}

export type ImpactDirection = 'up' | 'down';

export interface Impact {
  /** Every reached component and how many hops away it is (the origin is 0). */
  distance: Map<string, number>;
  /** Relations walked to reach them. */
  relations: Set<ModelRelation>;
}

/**
 * Walks the dependency graph from one component. Every relation means "from depends on to":
 * a caller on what it calls, a consumer on its queue, a writer on its database.
 * - up: who is affected if this component goes down (its dependents, transitively);
 * - down: what this component needs to work (its dependencies, transitively).
 * depth 0 follows the graph to the end.
 */
export function impact(site: Site, origin: string, direction: ImpactDirection, depth = 0): Impact {
  const distance = new Map([[origin, 0]]);
  const relations = new Set<ModelRelation>();
  let frontier = [origin];
  for (let hop = 1; frontier.length && (!depth || hop <= depth); hop++) {
    const next: string[] = [];
    for (const key of frontier) {
      const edges = direction === 'up' ? site.incoming.get(key) : site.outgoing.get(key);
      for (const r of edges ?? []) {
        const other = direction === 'up' ? r.from : r.to;
        relations.add(r);
        if (!distance.has(other)) {
          distance.set(other, hop);
          next.push(other);
        }
      }
    }
    frontier = next;
  }
  return { distance, relations };
}

export type FacetKey = 'type' | 'tech' | 'owner' | 'host' | 'provider' | 'status';

/** The value of a facet for a component; status is "active" when not set. */
export function facetValue(c: ModelComponent, key: FacetKey): string | undefined {
  if (c.ghost) return undefined;
  return key === 'status' ? (c.status ?? 'active') : c[key];
}

/** Distinct values of a facet with how many declared components have each, most common first. */
export function facet(site: Site, key: FacetKey): { value: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const c of site.model.components) {
    const value = facetValue(c, key);
    if (value) counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
}

/** OR within a facet, AND across facets. Ghosts never match a filter. */
export function matchesFilter(
  c: ModelComponent,
  filter: Partial<Record<FacetKey, string[]>>,
): boolean {
  return (Object.keys(filter) as FacetKey[]).every((key) => {
    const values = filter[key];
    if (!values?.length) return true;
    const value = facetValue(c, key);
    return value !== undefined && values.includes(value);
  });
}
