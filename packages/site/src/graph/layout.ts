import ELK, { type ElkExtendedEdge, type ElkNode, type ElkPort } from 'elkjs/lib/elk-api.js';
import elkWorkerUrl from 'elkjs/lib/elk-worker.min.js?url';
import type { Edge, Node } from '@xyflow/react';
import {
  matchesFilter,
  withNeighbours,
  type FacetKey,
  type ModelComponent,
  type ModelRelation,
  type Site,
} from '../model';
import type { Arrangement, Grouping } from '../router';
import {
  arrangeAround,
  between,
  CARD,
  groupsOf,
  levelsAround,
  mostConnected,
  tiersOf,
  towards,
  type Box,
  type Group,
  type Point,
  type Side,
} from './arrange';

export type { Point };

export type Direction = 'RIGHT' | 'DOWN';

export interface FootprintData extends Record<string, unknown> {
  component: ModelComponent;
  designator: string;
  inPads: string[];
  outPads: string[];
  /** The side of the footprint each pad sits on. */
  padSide: Record<string, Side>;
  /** Centre of each pad, relative to the footprint. */
  padAt: Record<string, Point>;
}

export interface BoardData extends Record<string, unknown> {
  /** What the board gathers: a project, an owner, a host, a type or a tier. */
  label: string;
  /** Set when the board is a project: it links to its page and carries its colour. */
  project?: string;
  color?: string;
  ghost: boolean;
  /** How many parts it holds; the centre of a stack has no count. */
  count?: number;
  /** The cards on it. */
  members: string[];
  /** A level of a stack around a component: a rule with its name, not a box. */
  level?: boolean;
}

export interface RingData extends Record<string, unknown> {
  /** Hops from the centre to the cards on this ring, and how many they are. */
  hops: number;
  parts: number;
  /** On the first ring, to name the two sides: how many parts each one holds, on every ring. */
  usedBy?: number;
  dependsOn?: number;
}

export interface TraceData extends Record<string, unknown> {
  relation: ModelRelation;
  points: Point[];
}

export interface Layout {
  nodes: Node[];
  edges: Edge[];
  width: number;
  height: number;
  /** Which way the layers run, when the map has layers. */
  direction?: Direction;
  /**
   * Arranged around a component: which one, how many parts of the view it leaves out, whether
   * it is a stack (what uses it above, what it uses below), and what a view can open on, the
   * widest first.
   */
  around?: { centre: string; hidden: number; upright: boolean; frames: Box[] };
}

// Layout runs in a worker: large workspaces never freeze the page while traces are routed.
const elk = new ELK({ workerUrl: elkWorkerUrl });

/** A map too large to fit is never shown smaller than this: it pans instead. */
export const READABLE_ZOOM = 0.85;

const FOOTPRINT_W = CARD.width;
const PAD_PITCH = 16;
const BOARD_TOP = 44;
const BOARD_SIDE = 34;
const BOARD_PADDING = `top=${BOARD_TOP},left=${BOARD_SIDE},bottom=${BOARD_SIDE},right=${BOARD_SIDE}`;
/**
 * A level of a stack: how far above its cards its rule runs. Far enough for a relation to show
 * its last stretch and its head below the name set on the rule.
 */
const LEVEL_TOP = 28;

export interface LayoutScope {
  /** Components to place; boards are derived from their projects. */
  components: ModelComponent[];
  /** Forces a direction (DOWN on phones). Otherwise both are laid out and the more legible wins. */
  direction?: Direction;
  /** Canvas size, to pick the direction that fits it at the largest zoom. */
  canvas?: { width: number; height: number };
  /** How the map is arranged (the flow by default). */
  arrange?: Arrangement;
  /** What the boards of the flow gather (the projects by default). */
  group?: Grouping;
  /** Arranged around a component: which one (the most connected by default). */
  centre?: string;
  /** Arranged around a component: as a stack to read down (narrow screens). */
  upright?: boolean;
}

/** Which components a view shows: the facet filter, when the view shows only its matches. */
export type ScopeFilter = Partial<Record<FacetKey, string[]>>;

export function scopeFor(
  site: Site,
  view: { project?: string; focus?: string; filter?: ScopeFilter },
): LayoutScope {
  const filter = view.filter ?? {};
  const all = site.model.components.filter((c) => matchesFilter(c, filter));
  if (view.focus) {
    const keys = withNeighbours(site, [view.focus]);
    return { components: all.filter((c) => keys.has(c.key)) };
  }
  if (view.project) {
    const own = all.filter((c) => c.project === view.project).map((c) => c.key);
    const keys = withNeighbours(site, own);
    return { components: all.filter((c) => keys.has(c.key)) };
  }
  return { components: all };
}

/**
 * Places footprints on boards and routes every relation orthogonally, the way a layout tool routes
 * copper: ELK layered, hierarchy-aware, one pad per relation end. The boards are the projects, or
 * what the view groups by; in tiers they are bands by kind, in the order of the classic picture.
 * Around a component there are no boards: rings by distance, and straight lines; on a narrow
 * screen, a stack of levels by distance.
 */
export async function layoutBoards(site: Site, scope: LayoutScope): Promise<Layout> {
  if (scope.arrange === 'around')
    return scope.upright ? layoutStack(site, scope) : layoutAround(site, scope);
  if (scope.direction) return layoutIn(site, scope, scope.direction);
  const [across, down] = await Promise.all([
    layoutIn(site, scope, 'RIGHT'),
    layoutIn(site, scope, 'DOWN'),
  ]);
  const canvas = scope.canvas ?? { width: 16, height: 10 };
  const fit = (l: Layout) => Math.min(canvas.width / l.width, canvas.height / l.height);
  // Prefer left-to-right reading unless top-to-bottom is clearly more legible on this canvas.
  return fit(down) > fit(across) * 1.1 ? down : across;
}

const SIDE: Record<string, Side> = { WEST: 'left', EAST: 'right', NORTH: 'top', SOUTH: 'bottom' };

async function layoutIn(
  site: Site,
  scope: LayoutScope,
  direction: Direction,
  levels?: Group[],
): Promise<Layout> {
  const [inSide, outSide] = direction === 'RIGHT' ? ['WEST', 'EAST'] : ['NORTH', 'SOUTH'];
  const tiers = scope.arrange === 'tiers';
  const keys = new Set(scope.components.map((c) => c.key));
  const relations = site.model.relations.filter((r) => keys.has(r.from) && keys.has(r.to));
  const groups =
    levels ??
    (tiers ? tiersOf(scope.components) : groupsOf(scope.components, scope.group ?? 'project'));
  // Bands (tiers, the levels of a stack) hold their cards in place along the flow.
  const banded = tiers || !!levels;
  // The cards of a level wrap, so that a row is never wider than the screen reads.
  const perRow = levels
    ? Math.max(
        1,
        Math.floor(((scope.canvas?.width ?? 0) - 80) / READABLE_ZOOM / (CARD.width + 40) + 0.15),
      )
    : Infinity;
  const rank = new Map(site.order.map((key, i) => [key, i]));
  // The levels of a stack come already in the order to read them.
  const ordered = (members: ModelComponent[]) =>
    levels ? members : [...members].sort((a, b) => (rank.get(a.key) ?? 0) - (rank.get(b.key) ?? 0));

  const pads = new Map<string, { in: string[]; out: string[] }>();
  for (const c of scope.components) pads.set(c.key, { in: [], out: [] });
  relations.forEach((r, i) => {
    pads.get(r.from)!.out.push(`${r.from}#o${i}`);
    pads.get(r.to)!.in.push(`${r.to}#i${i}`);
  });

  /** A card for ELK; in tiers, with the band it must stay in. */
  const footprint = (c: ModelComponent, tier?: number): ElkNode => {
    const p = pads.get(c.key)!;
    const ports: ElkPort[] = [
      ...p.in.map((id, i) => ({
        id,
        width: 9,
        height: 7,
        layoutOptions: { 'elk.port.side': inSide!, 'elk.port.index': String(i) },
      })),
      ...p.out.map((id, i) => ({
        id,
        width: 9,
        height: 7,
        layoutOptions: { 'elk.port.side': outSide!, 'elk.port.index': String(i) },
      })),
    ];
    const pins = Math.max(p.in.length, p.out.length);
    return {
      id: c.key,
      width: direction === 'RIGHT' ? FOOTPRINT_W : Math.max(FOOTPRINT_W, pins * PAD_PITCH + 40),
      height: direction === 'RIGHT' ? Math.max(CARD.height, pins * PAD_PITCH + 28) : CARD.height,
      ports,
      layoutOptions: {
        'elk.portConstraints': 'FIXED_SIDE',
        ...(tier === undefined ? {} : { 'elk.partitioning.partition': String(tier) }),
      },
    };
  };

  // In the flow each group is a box ELK lays out as a whole. In bands the cards are laid out
  // flat, each held in its row, and the bands are drawn around them afterwards.
  let rows = 0;
  const children: ElkNode[] = banded
    ? groups.flatMap((group) => {
        const first = rows;
        rows += Math.max(1, Math.ceil(group.members.length / perRow));
        return ordered(group.members).map((c, i) => footprint(c, first + Math.floor(i / perRow)));
      })
    : groups.map((group) => ({
        id: `board:${group.id}`,
        layoutOptions: {
          'elk.padding': `[${BOARD_PADDING}]`,
          'elk.algorithm': 'layered',
          'elk.direction': direction,
        },
        children: ordered(group.members).map((c) => footprint(c)),
      }));

  const edges: ElkExtendedEdge[] = relations.map((r, i) => ({
    id: `rel:${i}`,
    sources: [`${r.from}#o${i}`],
    targets: [`${r.to}#i${i}`],
  }));

  const graph: ElkNode = {
    id: 'root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': direction,
      ...(banded
        ? { 'elk.partitioning.activate': 'true' }
        : { 'elk.hierarchyHandling': 'INCLUDE_CHILDREN' }),
      'elk.edgeRouting': 'ORTHOGONAL',
      // Room between two bands for the name of the second and the edge of the first.
      'elk.layered.spacing.nodeNodeBetweenLayers': levels ? '44' : tiers ? '124' : '72',
      'elk.spacing.nodeNode': '40',
      'elk.spacing.edgeEdge': '10',
      'elk.spacing.edgeNode': '18',
      'elk.layered.spacing.edgeNodeBetweenLayers': '18',
      // A stack is a column: every row centred on the same line, not shifted to straighten lines.
      'elk.layered.nodePlacement.strategy': levels ? 'SIMPLE' : 'BRANDES_KOEPF',
      'elk.layered.crossingMinimization.semiInteractive': 'false',
      'elk.json.edgeCoords': 'ROOT',
      'elk.padding': '[top=56,left=40,bottom=40,right=40]',
    },
    children,
    edges,
  };

  const result = await elk.layout(graph);

  const boardData = (group: Group): BoardData => {
    const members = group.members.map((c) => c.key);
    // A level counts what is that far, declared or not; the centre is one, and says so by name.
    if (group.kind)
      return {
        label: group.label,
        ghost: false,
        ...(group.kind === 'level' ? { count: members.length } : {}),
        members,
        level: true,
      };
    if (group.project === undefined) {
      return {
        label: group.label,
        ghost: group.members.every((c) => c.ghost),
        count: group.members.filter((c) => !c.ghost).length,
        members,
      };
    }
    const project = group.project;
    return {
      label: project,
      project,
      color: site.projectColor.get(project) ?? '#6b6f78',
      // A board is a ghost only if its project declares nothing at all, not because the view
      // happens to show only its ghost parts.
      ghost: site.model.projects.find((p) => p.id === project)?.ghost ?? true,
      count: site.model.components.filter((c) => c.project === project && !c.ghost).length,
      members,
    };
  };

  const nodes: Node[] = [];
  const board = (id: string, group: Group, box: Box) =>
    nodes.push({
      id,
      type: 'board',
      position: { x: box.x, y: box.y },
      data: boardData(group),
      style: { width: box.width, height: box.height },
      selectable: false,
      draggable: false,
      zIndex: 0,
    });
  /** A card on its board, or on the map itself when it has none. */
  const card = (child: ElkNode, parent?: string, origin: Point = { x: 0, y: 0 }) => {
    const p = pads.get(child.id)!;
    nodes.push({
      id: child.id,
      type: 'footprint',
      ...(parent ? { parentId: parent } : {}),
      position: { x: (child.x ?? 0) - origin.x, y: (child.y ?? 0) - origin.y },
      data: {
        component: site.byKey.get(child.id)!,
        designator: site.designator.get(child.id) ?? '',
        inPads: p.in,
        outPads: p.out,
        padSide: Object.fromEntries([
          ...p.in.map((id) => [id, SIDE[inSide!]!] as const),
          ...p.out.map((id) => [id, SIDE[outSide!]!] as const),
        ]),
        // Pad centres from ELK, so traces land exactly on the pads.
        padAt: Object.fromEntries(
          (child.ports ?? []).map((port) => [
            port.id,
            {
              x: (port.x ?? 0) + (port.width ?? 0) / 2,
              y: (port.y ?? 0) + (port.height ?? 0) / 2,
            },
          ]),
        ),
      } satisfies FootprintData,
      style: { width: child.width, height: child.height },
      draggable: false,
      zIndex: 2,
    });
  };

  if (banded) {
    const placed = new Map((result.children ?? []).map((child) => [child.id, child]));
    const extent = (cards: ElkNode[]) => ({
      left: Math.min(...cards.map((c) => c.x ?? 0)),
      top: Math.min(...cards.map((c) => c.y ?? 0)),
      right: Math.max(...cards.map((c) => (c.x ?? 0) + (c.width ?? 0))),
      bottom: Math.max(...cards.map((c) => (c.y ?? 0) + (c.height ?? 0))),
    });
    const all = extent([...placed.values()]);
    for (const group of groups) {
      const cards = group.members.map((c) => placed.get(c.key)!);
      const own = extent(cards);
      // A level of a stack, and its centre: a rule with its name, over the lines that cross it.
      // The cards stand on the map.
      if (group.kind) {
        nodes.push({
          id: `board:${group.id}`,
          type: 'board',
          position: { x: all.left - BOARD_SIDE, y: own.top - LEVEL_TOP },
          data: boardData(group),
          // As thin as its rule: a node with no height is never measured, and never shown.
          style: { width: all.right - all.left + BOARD_SIDE * 2, height: 1 },
          selectable: false,
          draggable: false,
          zIndex: 3,
        });
        for (const child of cards) card(child);
        continue;
      }
      // A band runs across the whole map, as deep as its own cards.
      const across = direction === 'DOWN';
      const left = (across ? all.left : own.left) - BOARD_SIDE;
      const top = (across ? own.top : all.top) - BOARD_TOP;
      const box = {
        x: left,
        y: top,
        width: (across ? all.right : own.right) + BOARD_SIDE - left,
        height: (across ? own.bottom : all.bottom) + BOARD_SIDE - top,
      };
      const id = `board:${group.id}`;
      board(id, group, box);
      for (const child of cards) card(child, id, box);
    }
  } else {
    for (const [i, box] of (result.children ?? []).entries()) {
      board(box.id, groups[i]!, {
        x: box.x ?? 0,
        y: box.y ?? 0,
        width: box.width ?? 0,
        height: box.height ?? 0,
      });
      for (const child of box.children ?? []) card(child, box.id, { x: 0, y: 0 });
    }
  }

  const routed = new Map((result.edges ?? []).map((e) => [e.id, e]));
  const flowEdges: Edge[] = relations.map((r, i) => {
    const section = routed.get(`rel:${i}`)?.sections?.[0];
    const points = section
      ? [section.startPoint, ...(section.bendPoints ?? []), section.endPoint]
      : [];
    return trace(r, i, points);
  });

  return {
    nodes,
    edges: flowEdges,
    width: result.width ?? 1,
    height: result.height ?? 1,
    direction,
  };
}

function trace(relation: ModelRelation, i: number, points: Point[]): Edge {
  return {
    id: `rel:${i}`,
    source: relation.from,
    target: relation.to,
    sourceHandle: `${relation.from}#o${i}`,
    targetHandle: `${relation.to}#i${i}`,
    type: 'trace',
    data: { relation, points } satisfies TraceData,
    zIndex: 1,
  };
}

/** The centre a view asks for, or the most connected component, and the relations in view. */
function centreOf(site: Site, scope: LayoutScope) {
  const keys = new Set(scope.components.map((c) => c.key));
  const inView = site.model.relations.filter((r) => keys.has(r.from) && keys.has(r.to));
  const centre =
    scope.centre && keys.has(scope.centre) ? scope.centre : mostConnected(scope.components, inView);
  return { centre, inView };
}

const NOTHING: Layout = { nodes: [], edges: [], width: 1, height: 1 };

/**
 * Around a component on a narrow screen: a stack to read down. What uses the centre is above it,
 * what it uses below, a level for each distance, laid out and routed like the bands of the tiers.
 */
async function layoutStack(site: Site, scope: LayoutScope): Promise<Layout> {
  const { centre, inView } = centreOf(site, scope);
  if (!centre) return NOTHING;
  const { levels, hidden } = levelsAround(scope.components, inView, centre);
  const components = levels.flatMap((level) => level.members);
  const layout = await layoutIn(site, { ...scope, components }, 'DOWN', levels);
  const boxOf = (node: Node): Box => ({
    ...node.position,
    width: Number(node.style?.width),
    height: Number(node.style?.height),
  });
  const around = (boxes: Box[]): Box => {
    const x = Math.min(...boxes.map((b) => b.x));
    const y = Math.min(...boxes.map((b) => b.y));
    return {
      x,
      y,
      width: Math.max(...boxes.map((b) => b.x + b.width)) - x,
      height: Math.max(...boxes.map((b) => b.y + b.height)) - y,
    };
  };
  // What a view can open on: the stack whole, the centre with the levels one hop away, the centre.
  const near = new Set(
    levels.flatMap((level) =>
      ['before:1', 'centre', 'after:1'].includes(level.id)
        ? [`board:${level.id}`, ...level.members.map((c) => c.key)]
        : [],
    ),
  );
  const frames = [
    layout.nodes,
    layout.nodes.filter((n) => near.has(n.id)),
    layout.nodes.filter((n) => n.id === centre),
  ].map((nodes) => around(nodes.map(boxOf)));
  return { ...layout, around: { centre, hidden, upright: true, frames } };
}

/** One component at the centre, the rest in rings by distance, joined by straight lines. */
function layoutAround(site: Site, scope: LayoutScope): Layout {
  const { centre, inView } = centreOf(site, scope);
  if (!centre) return NOTHING;
  const around = arrangeAround(scope.components, inView, centre);
  const relations = inView.filter((r) => around.at.has(r.from) && around.at.has(r.to));
  const box = (key: string): Box => ({ ...around.at.get(key)!, ...CARD });

  // Relations between the same two cards run side by side.
  const pair = (r: ModelRelation) => [r.from, r.to].sort().join(' ');
  const lanes = new Map<string, number[]>();
  relations.forEach((r, i) => (lanes.get(pair(r)) ?? lanes.set(pair(r), []).get(pair(r))!).push(i));

  const data = new Map<string, Pick<FootprintData, 'inPads' | 'outPads' | 'padSide' | 'padAt'>>(
    [...around.at.keys()].map((key) => [key, { inPads: [], outPads: [], padSide: {}, padAt: {} }]),
  );
  /** How many relations already go over the centre, and under it. */
  const detours = { over: 0, under: 0 };
  const edges = relations.map((r, i) => {
    const lane = lanes.get(pair(r))!;
    // The same sideways shift whichever way the relation runs between the two.
    const turn = r.from < r.to ? 1 : -1;
    const shift = (lane.indexOf(i) - (lane.length - 1) / 2) * 12 * turn;
    const straight = between(box(r.from), box(r.to), shift);
    // A relation between the two sides would run behind the card at the centre: it goes over it
    // or under it instead, each one a little further out than the one before.
    const middle = box(centre);
    const [p, q] = [straight.from, straight.to];
    const across =
      r.from !== centre &&
      r.to !== centre &&
      Math.sign(p.x - around.origin.x) !== Math.sign(q.x - around.origin.x);
    const y = p.y + ((around.origin.x - p.x) / (q.x - p.x || 1)) * (q.y - p.y);
    const behind = across && y > middle.y - 14 && y < middle.y + middle.height + 14;
    const over = y < around.origin.y;
    const clear = 26 + 12 * (behind ? detours[over ? 'over' : 'under']++ : 0);
    const bend = {
      x: around.origin.x,
      y: over ? middle.y - clear : middle.y + middle.height + clear,
    };
    const from = behind ? towards(box(r.from), bend) : straight.from;
    const to = behind ? towards(box(r.to), bend) : straight.to;
    for (const [key, id, end, list] of [
      [r.from, `${r.from}#o${i}`, from, 'outPads'],
      [r.to, `${r.to}#i${i}`, to, 'inPads'],
    ] as const) {
      const card = data.get(key)!;
      const at = around.at.get(key)!;
      card[list].push(id);
      card.padSide[id] = end.side;
      card.padAt[id] = { x: end.x - at.x, y: end.y - at.y };
    }
    return trace(r, i, behind ? [from, bend, to] : [from, to]);
  });

  const nodes: Node[] = around.rings.map((ring, i) => ({
    id: `ring:${i + 1}`,
    type: 'ring',
    position: { x: around.origin.x - ring.a, y: around.origin.y - ring.b },
    data: {
      hops: i + 1,
      parts: ring.parts,
      ...(i === 0 ? { usedBy: around.usedBy, dependsOn: around.dependsOn } : {}),
    } satisfies RingData,
    style: { width: ring.a * 2, height: ring.b * 2 },
    selectable: false,
    draggable: false,
    zIndex: 0,
  }));
  for (const [key, position] of around.at) {
    nodes.push({
      id: key,
      type: 'footprint',
      position,
      data: {
        component: site.byKey.get(key)!,
        designator: site.designator.get(key) ?? '',
        ...data.get(key)!,
      } satisfies FootprintData,
      style: { ...CARD },
      draggable: false,
      zIndex: 2,
    });
  }
  return {
    nodes,
    edges,
    width: around.width,
    height: around.height,
    around: { centre, hidden: around.hidden, upright: false, frames: around.frames },
  };
}
