import { TYPE_PLURAL, type ModelComponent, type ModelRelation } from '../model';
import type { Grouping } from '../router';

/** A card as the map draws it when it has few relations. */
export const CARD = { width: 216, height: 76 };

export interface Point {
  x: number;
  y: number;
}

export type Side = 'left' | 'right' | 'top' | 'bottom';

/** What a board gathers: a project, an owner, a host, a type or a tier. */
export interface Group {
  /** Unique among the groups of a layout. */
  id: string;
  label: string;
  /** Set when the group is a project: its board links to the project's page. */
  project?: string;
  /**
   * In a stack around a component: a level by distance, or the centre. Each is drawn as a rule
   * with its name; a level also says how many parts it holds.
   */
  kind?: 'level' | 'centre';
  members: ModelComponent[];
}

/** The components of a view gathered by project, owner, host or type, in reading order. */
export function groupsOf(components: ModelComponent[], by: Grouping): Group[] {
  const groups = new Map<string, Group>();
  const rank = new Map<string, number>();
  for (const c of components) {
    const [group, order] = groupFor(c, by);
    if (!groups.has(group.id)) {
      groups.set(group.id, { ...group, members: [] });
      rank.set(group.id, order);
    }
    groups.get(group.id)!.members.push(c);
  }
  return [...groups.values()].sort(
    (a, b) => rank.get(a.id)! - rank.get(b.id)! || a.label.localeCompare(b.label),
  );
}

/**
 * The group of a component, and its rank in the list: what has no value closes it (it is what is
 * left to tidy), and after it comes what no repo declares.
 */
function groupFor(c: ModelComponent, by: Grouping): [Omit<Group, 'members'>, number] {
  if (by === 'project') return [{ id: c.project, label: c.project, project: c.project }, 0];
  if (c.ghost) return [{ id: 'undeclared', label: 'Not declared' }, 2];
  if (by === 'type') {
    const type = c.type ?? '';
    return [{ id: `type:${type}`, label: TYPE_PLURAL[type] ?? (type || 'Other') }, 0];
  }
  const value = c[by];
  return value
    ? [{ id: `${by}:${value}`, label: value }, 0]
    : [{ id: `no-${by}`, label: by === 'owner' ? 'No owner' : 'No host' }, 1];
}

/** The bands of the classic picture, from what people open to what the system rests on. */
const TIERS: { id: string; label: string; types: string[] }[] = [
  { id: 'entry', label: 'Entry points', types: ['domain', 'proxy', 'frontend', 'client'] },
  { id: 'services', label: 'Services', types: ['service', 'function', 'job'] },
  { id: 'messaging', label: 'Messaging', types: ['queue', 'topic'] },
  { id: 'data', label: 'Data', types: ['database', 'cache', 'storage'] },
  { id: 'external', label: 'External', types: ['external'] },
];

/** The components of a view in tiers by kind, in the order of the bands; empty tiers are left out. */
export function tiersOf(components: ModelComponent[]): Group[] {
  const tiers: Group[] = [
    ...TIERS.map(({ id, label }) => ({ id, label, members: [] as ModelComponent[] })),
    { id: 'undeclared', label: 'Not declared', members: [] },
  ];
  for (const c of components) {
    const tier = c.ghost ? -1 : TIERS.findIndex((t) => t.types.includes(c.type ?? ''));
    tiers[tier < 0 ? tiers.length - 1 : tier]!.members.push(c);
  }
  return tiers.filter((t) => t.members.length);
}

/** The component with the most relations in the view: a sensible centre to start from. */
export function mostConnected(
  components: ModelComponent[],
  relations: ModelRelation[],
): string | undefined {
  const degree = new Map(components.map((c) => [c.key, 0]));
  for (const r of relations) {
    if (!degree.has(r.from) || !degree.has(r.to)) continue;
    degree.set(r.from, degree.get(r.from)! + 1);
    degree.set(r.to, degree.get(r.to)! + 1);
  }
  let best: string | undefined;
  for (const [key, count] of degree)
    if (best === undefined || count > degree.get(best)!) best = key;
  return best;
}

export interface Around {
  centre: string;
  /** Top-left corner of each card on the map. */
  at: Map<string, Point>;
  /** The centre of the rings. */
  origin: Point;
  /**
   * Each ring, the nearest first: its horizontal and vertical semi-axes, and how many cards sit
   * on it (one hop away on the first).
   */
  rings: { a: number; b: number; parts: number }[];
  /** How many components use the centre, directly or not, and how many it uses. */
  usedBy: number;
  dependsOn: number;
  /** Components of the view that neither use the centre nor are used by it: not on this map. */
  hidden: number;
  /**
   * What a view can open on, the widest first: the rings whole, every card, the centre with the
   * cards one hop away, the centre alone.
   */
  frames: Box[];
  width: number;
  height: number;
}

const PITCH = CARD.height + 28;
const RING_A = 340;
const RING_B = 190;
/** Room for the names set on a ring. */
const LABELS = 12;
const MARGIN = 56;

/**
 * What uses the centre (`before` it) and what it uses (`after`), each side by distance, the
 * nearest first. A component reachable both ways sits where it is nearer; what is not connected
 * to the centre either way is on neither side.
 */
function sidesOf(components: ModelComponent[], relations: ModelRelation[], centre: string) {
  const keys = new Set(components.map((c) => c.key));
  const out = new Map<string, string[]>();
  const into = new Map<string, string[]>();
  for (const r of relations) {
    if (!keys.has(r.from) || !keys.has(r.to) || r.from === r.to) continue;
    (out.get(r.from) ?? out.set(r.from, []).get(r.from)!).push(r.to);
    (into.get(r.to) ?? into.set(r.to, []).get(r.to)!).push(r.from);
  }
  const uses = hops(centre, out);
  const usedBy = hops(centre, into);
  const before: ModelComponent[][] = [];
  const after: ModelComponent[][] = [];
  for (const c of components) {
    if (c.key === centre) continue;
    const up = usedBy.get(c.key);
    const down = uses.get(c.key);
    if (up === undefined && down === undefined) continue;
    const first = up !== undefined && (down === undefined || up <= down);
    ((first ? before : after)[(first ? up : down)! - 1] ??= []).push(c);
  }
  const neighbours = (key: string) => [...(out.get(key) ?? []), ...(into.get(key) ?? [])];
  return { before, after, neighbours, uses: (key: string) => out.get(key) ?? [] };
}

/**
 * One component at the centre and the rest in rings by distance: on its left what uses it (one
 * hop, then what uses those...), on its right what it uses. What is not connected to it either
 * way is left out.
 */
export function arrangeAround(
  components: ModelComponent[],
  relations: ModelRelation[],
  centre: string,
): Around {
  const { before, after, neighbours } = sidesOf(components, relations, centre);
  const sides = { left: before, right: after };

  const centres = new Map<string, Point>([[centre, { x: 0, y: 0 }]]);
  const near = [centre];
  const rings: Around['rings'] = [];
  const count = Math.max(before.length, after.length);
  for (let k = 0; k < count; k++) {
    const most = Math.max(before[k]?.length ?? 0, after[k]?.length ?? 0);
    const previous = rings[k - 1];
    // Tall enough for its cards to stay in the flatter part of the ellipse, where rings do not
    // crowd each other, and always outside the ring before.
    const ring = {
      a: Math.max(RING_A * (k + 1), (previous?.a ?? 0) + RING_A),
      b: Math.max(RING_B * (k + 1), ((most - 1) * PITCH) / 2 / 0.7, (previous?.b ?? 0) + 130),
      parts: (before[k]?.length ?? 0) + (after[k]?.length ?? 0),
    };
    rings.push(ring);
    for (const side of ['left', 'right'] as const) {
      const cards = (sides[side][k] ?? []).map((c) => c.key);
      // Next to what they are connected to on the ring before, so lines cross less.
      const pull = (key: string) => {
        const ys = neighbours(key).flatMap((n) => (centres.has(n) ? [centres.get(n)!.y] : []));
        return ys.length ? ys.reduce((sum, y) => sum + y, 0) / ys.length : 0;
      };
      const ordered = [...cards].sort((x, y) => pull(x) - pull(y) || x.localeCompare(y));
      ordered.forEach((key, i) => {
        const y = (i - (ordered.length - 1) / 2) * PITCH;
        const x = ring.a * Math.sqrt(1 - (y / ring.b) ** 2);
        centres.set(key, { x: side === 'left' ? -x : x, y });
        if (k === 0) near.push(key);
      });
    }
  }

  /** The box around some of the cards, where the middle of the centre is the origin. */
  const boxOf = (cards: string[]): Box => {
    const xs = cards.map((key) => centres.get(key)!.x);
    const ys = cards.map((key) => centres.get(key)!.y);
    const left = Math.min(...xs) - CARD.width / 2;
    const top = Math.min(...ys) - CARD.height / 2;
    return {
      x: left,
      y: top,
      width: Math.max(...xs) + CARD.width / 2 - left,
      height: Math.max(...ys) + CARD.height / 2 - top,
    };
  };
  const cards = boxOf([...centres.keys()]);
  const outer = rings.at(-1) ?? { a: 0, b: 0 };
  const whole = {
    left: Math.min(cards.x, -outer.a - LABELS),
    top: Math.min(cards.y, -outer.b - LABELS),
    right: Math.max(cards.x + cards.width, outer.a + LABELS),
    bottom: Math.max(cards.y + cards.height, outer.b + LABELS),
  };
  const left = whole.left - MARGIN;
  const top = whole.top - MARGIN;
  const frames = [
    {
      x: whole.left,
      y: whole.top,
      width: whole.right - whole.left,
      height: whole.bottom - whole.top,
    },
    cards,
    boxOf(near),
    boxOf([centre]),
  ].map((box) => ({ ...box, x: box.x - left, y: box.y - top }));
  const total = (side: ModelComponent[][]) => side.reduce((sum, ring) => sum + ring.length, 0);
  return {
    centre,
    at: new Map(
      [...centres].map(([key, p]) => [
        key,
        { x: p.x - CARD.width / 2 - left, y: p.y - CARD.height / 2 - top },
      ]),
    ),
    origin: { x: -left, y: -top },
    rings,
    usedBy: total(before),
    dependsOn: total(after),
    hidden: components.length - centres.size,
    frames,
    width: whole.right + MARGIN - left,
    height: whole.bottom + MARGIN - top,
  };
}

/**
 * The same map for a narrow screen, as a stack to read down: what uses the centre above it, the
 * farthest first, then the centre, then what it uses. Each distance is a level of its own.
 */
export function levelsAround(
  components: ModelComponent[],
  relations: ModelRelation[],
  centre: string,
): { levels: Group[]; hidden: number } {
  const { before, after, uses } = sidesOf(components, relations, centre);
  /** The stack reads down the chain inside a level too: a part above what it uses. */
  const chain = (members: ModelComponent[]): ModelComponent[] => {
    const waiting = [...members];
    const sorted: ModelComponent[] = [];
    while (waiting.length) {
      // The first that nothing still waiting uses; in a cycle, the first.
      const next = waiting.findIndex(
        (c) => !waiting.some((other) => other !== c && uses(other.key).includes(c.key)),
      );
      sorted.push(...waiting.splice(Math.max(next, 0), 1));
    }
    return sorted;
  };
  const level = (side: 'before' | 'after', members: ModelComponent[], i: number): Group => ({
    id: `${side}:${i + 1}`,
    label: `${side === 'before' ? 'Used by' : 'Depends on'} · ${i === 0 ? '1 hop' : `${i + 1} hops`}`,
    kind: 'level',
    members: chain(members),
  });
  // A distance can be empty on one side, when what is that far is nearer the other way.
  const levels: Group[] = [
    ...before.flatMap((members, i) => [level('before', members, i)]).reverse(),
    {
      id: 'centre',
      label: 'Centre',
      kind: 'centre',
      members: components.filter((c) => c.key === centre),
    },
    ...after.flatMap((members, i) => [level('after', members, i)]),
  ];
  const shown = levels.reduce((sum, l) => sum + l.members.length, 0);
  return { levels, hidden: components.length - shown };
}

/** How many hops each component is from `start`, following `next`. */
function hops(start: string, next: Map<string, string[]>): Map<string, number> {
  const distance = new Map([[start, 0]]);
  const queue = [start];
  for (const key of queue) {
    for (const to of next.get(key) ?? []) {
      if (distance.has(to)) continue;
      distance.set(to, distance.get(key)! + 1);
      queue.push(to);
    }
  }
  distance.delete(start);
  return distance;
}

export interface Box extends Point {
  width: number;
  height: number;
}

/**
 * The straight line between two cards: where it leaves the first and where it enters the second,
 * and on which side of each. `shift` moves it sideways, so that two relations between the same
 * cards do not lie on top of each other.
 */
export function between(
  a: Box,
  b: Box,
  shift = 0,
): { from: Point & { side: Side }; to: Point & { side: Side } } {
  const mid = (box: Box) => ({ x: box.x + box.width / 2, y: box.y + box.height / 2 });
  const [p, q] = [mid(a), mid(b)];
  const length = Math.hypot(q.x - p.x, q.y - p.y) || 1;
  const normal = { x: (-(q.y - p.y) / length) * shift, y: ((q.x - p.x) / length) * shift };
  const start = { x: p.x + normal.x, y: p.y + normal.y };
  const end = { x: q.x + normal.x, y: q.y + normal.y };
  return { from: leave(a, start, end), to: leave(b, end, start) };
}

/** Where a line from the middle of a card towards a point leaves the card, and on which side. */
export function towards(box: Box, to: Point): Point & { side: Side } {
  return leave(box, { x: box.x + box.width / 2, y: box.y + box.height / 2 }, to);
}

/** Where the ray from `from` (inside the box) towards `to` crosses the edge of the box. */
function leave(box: Box, from: Point, to: Point): Point & { side: Side } {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const tx = dx > 0 ? (box.x + box.width - from.x) / dx : dx < 0 ? (box.x - from.x) / dx : Infinity;
  const ty =
    dy > 0 ? (box.y + box.height - from.y) / dy : dy < 0 ? (box.y - from.y) / dy : Infinity;
  const t = Math.min(tx, ty);
  const side: Side = tx <= ty ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'bottom' : 'top';
  return { x: from.x + dx * t, y: from.y + dy * t, side };
}
