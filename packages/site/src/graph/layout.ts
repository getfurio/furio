import ELK, { type ElkExtendedEdge, type ElkNode, type ElkPort } from 'elkjs/lib/elk-api.js';
import elkWorkerUrl from 'elkjs/lib/elk-worker.min.js?url';
import type { Edge, Node } from '@xyflow/react';
import {
  matchesFilter,
  type FacetKey,
  type ModelComponent,
  type ModelRelation,
  type Site,
} from '../model';

export interface Point {
  x: number;
  y: number;
}

export type Direction = 'RIGHT' | 'DOWN';

export interface FootprintData extends Record<string, unknown> {
  component: ModelComponent;
  designator: string;
  inPads: string[];
  outPads: string[];
  direction: Direction;
  /** Centre of each pad, relative to the footprint, from ELK. */
  padAt: Record<string, Point>;
}

export interface BoardData extends Record<string, unknown> {
  project: string;
  color: string;
  ghost: boolean;
  count: number;
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
}

// Layout runs in a worker: large workspaces never freeze the page while traces are routed.
const elk = new ELK({ workerUrl: elkWorkerUrl });

const FOOTPRINT_W = 216;
const PAD_PITCH = 16;
const BOARD_PADDING = 'top=44,left=34,bottom=34,right=34';

export interface LayoutScope {
  /** Components to place; boards are derived from their projects. */
  components: ModelComponent[];
  /** Forces a direction (DOWN on phones). Otherwise both are laid out and the more legible wins. */
  direction?: Direction;
  /** Canvas size, to pick the direction that fits it at the largest zoom. */
  canvas?: { width: number; height: number };
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
    const keys = new Set([view.focus]);
    for (const r of site.outgoing.get(view.focus) ?? []) keys.add(r.to);
    for (const r of site.incoming.get(view.focus) ?? []) keys.add(r.from);
    return { components: all.filter((c) => keys.has(c.key)) };
  }
  if (view.project) {
    const own = new Set(all.filter((c) => c.project === view.project).map((c) => c.key));
    const keys = new Set(own);
    for (const key of own) {
      for (const r of site.outgoing.get(key) ?? []) keys.add(r.to);
      for (const r of site.incoming.get(key) ?? []) keys.add(r.from);
    }
    return { components: all.filter((c) => keys.has(c.key)) };
  }
  return { components: all };
}

/**
 * Places footprints inside one board per project and routes every relation orthogonally, the way a
 * layout tool routes copper: ELK layered, hierarchy-aware, one pad per relation end.
 */
export async function layoutBoards(site: Site, scope: LayoutScope): Promise<Layout> {
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

async function layoutIn(site: Site, scope: LayoutScope, direction: Direction): Promise<Layout> {
  const [inSide, outSide] = direction === 'RIGHT' ? ['WEST', 'EAST'] : ['NORTH', 'SOUTH'];
  const keys = new Set(scope.components.map((c) => c.key));
  const relations = site.model.relations.filter((r) => keys.has(r.from) && keys.has(r.to));
  const projects = [...new Set(scope.components.map((c) => c.project))].sort();

  const pads = new Map<string, { in: string[]; out: string[] }>();
  for (const c of scope.components) pads.set(c.key, { in: [], out: [] });
  relations.forEach((r, i) => {
    pads.get(r.from)!.out.push(`${r.from}#o${i}`);
    pads.get(r.to)!.in.push(`${r.to}#i${i}`);
  });

  const boards: ElkNode[] = projects.map((project) => ({
    id: `board:${project}`,
    layoutOptions: {
      'elk.padding': `[${BOARD_PADDING}]`,
      'elk.algorithm': 'layered',
      'elk.direction': direction,
    },
    children: scope.components
      .filter((c) => c.project === project)
      .sort((a, b) => site.order.indexOf(a.key) - site.order.indexOf(b.key))
      .map((c) => {
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
          height: direction === 'RIGHT' ? Math.max(76, pins * PAD_PITCH + 28) : 76,
          ports,
          layoutOptions: { 'elk.portConstraints': 'FIXED_SIDE' },
        };
      }),
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
      'elk.hierarchyHandling': 'INCLUDE_CHILDREN',
      'elk.edgeRouting': 'ORTHOGONAL',
      'elk.layered.spacing.nodeNodeBetweenLayers': '72',
      'elk.spacing.nodeNode': '40',
      'elk.spacing.edgeEdge': '10',
      'elk.spacing.edgeNode': '18',
      'elk.layered.spacing.edgeNodeBetweenLayers': '18',
      'elk.layered.nodePlacement.strategy': 'BRANDES_KOEPF',
      'elk.layered.crossingMinimization.semiInteractive': 'false',
      'elk.json.edgeCoords': 'ROOT',
      'elk.padding': '[top=56,left=40,bottom=40,right=40]',
    },
    children: boards,
    edges,
  };

  const result = await elk.layout(graph);

  const nodes: Node[] = [];
  for (const board of result.children ?? []) {
    const project = board.id.slice('board:'.length);
    const children = board.children ?? [];
    nodes.push({
      id: board.id,
      type: 'board',
      position: { x: board.x ?? 0, y: board.y ?? 0 },
      data: {
        project,
        color: site.projectColor.get(project) ?? '#6b6f78',
        // A board is a ghost only if its project declares nothing at all, not because the view
        // happens to show only its ghost parts.
        ghost: site.model.projects.find((p) => p.id === project)?.ghost ?? true,
        count: site.model.components.filter((c) => c.project === project && !c.ghost).length,
      } satisfies BoardData,
      style: { width: board.width, height: board.height },
      selectable: false,
      draggable: false,
      zIndex: 0,
    });
    for (const child of children) {
      const component = site.byKey.get(child.id)!;
      const p = pads.get(child.id)!;
      nodes.push({
        id: child.id,
        type: 'footprint',
        parentId: board.id,
        position: { x: child.x ?? 0, y: child.y ?? 0 },
        data: {
          component,
          designator: site.designator.get(child.id) ?? '',
          inPads: p.in,
          outPads: p.out,
          direction,
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
    }
  }

  const routed = new Map((result.edges ?? []).map((e) => [e.id, e]));
  const flowEdges: Edge[] = relations.map((r, i) => {
    const section = routed.get(`rel:${i}`)?.sections?.[0];
    const points = section
      ? [section.startPoint, ...(section.bendPoints ?? []), section.endPoint]
      : [];
    return {
      id: `rel:${i}`,
      source: r.from,
      target: r.to,
      sourceHandle: `${r.from}#o${i}`,
      targetHandle: `${r.to}#i${i}`,
      type: 'trace',
      data: { relation: r, points } satisfies TraceData,
      zIndex: 1,
    };
  });

  return { nodes, edges: flowEdges, width: result.width ?? 1, height: result.height ?? 1 };
}
