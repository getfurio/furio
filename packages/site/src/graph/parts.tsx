import {
  Handle,
  Position,
  type EdgeProps,
  type Node,
  type NodeProps,
  type Edge,
} from '@xyflow/react';
import {
  Clock,
  Database,
  Globe,
  HardDrive,
  Layers,
  ListOrdered,
  Monitor,
  MonitorSmartphone,
  Radio,
  Server,
  Signpost,
  SquareDashed,
  Waypoints,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import { createContext, useContext, useMemo } from 'react';
import { extensionIcon } from '../extensions';
import { useAppearance, type Palette, type Theme } from '../theme';
import { STATUS_LABEL, TYPE_LABEL, type ModelComponent } from '../model';
import { href } from '../router';
import type { BoardData, FootprintData, Point, TraceData } from './layout';

/** What is lit: the selected footprint, its nets, its neighbours. */
export interface Lit {
  selected: string | null;
  nodes: Set<string>;
  edges: Set<string>;
  /** Hops from the selection, in blast-radius and depends-on modes. */
  distance?: Map<string, number>;
  /** The Changes view: what happened to each card over the period. */
  marks?: Record<string, 'added' | 'changed'>;
  /** The filter: the cards it matches (the rest are dimmed). */
  matches?: Set<string>;
}

export const LitContext = createContext<Lit>({
  selected: null,
  nodes: new Set(),
  edges: new Set(),
});

type FootprintNode = Node<FootprintData, 'footprint'>;
type BoardNode = Node<BoardData, 'board'>;
type TraceEdge = Edge<TraceData, 'trace'>;

export function Footprint({ id, data }: NodeProps<FootprintNode>) {
  const lit = useContext(LitContext);
  // Circuit draws the cards as black chips whatever the theme.
  const chip = useAppearance()[0].palette === 'circuit';
  const { component, inPads, outPads, padAt, direction } = data;
  const across = direction === 'RIGHT';
  const mark = lit.marks?.[id];
  const state =
    lit.selected === id
      ? 'is-selected'
      : lit.selected
        ? lit.nodes.has(id)
          ? ''
          : 'is-dim'
        : (lit.marks && !mark) || (lit.matches && !lit.matches.has(id))
          ? 'is-dim'
          : lit.matches
            ? 'is-match'
            : '';
  const retired = component.status ? 'is-retired' : '';
  return (
    <div
      className={`footprint ${component.ghost ? 'is-ghost' : ''} ${retired} ${state}`}
      title={
        component.ghost ? `${component.key}: referenced, but no repo declares it` : component.key
      }
    >
      {inPads.map((pad) => (
        <Handle
          key={pad}
          id={pad}
          type="target"
          position={across ? Position.Left : Position.Top}
          className={`pad ${across ? '' : 'is-vertical'} ${lit.edges.has(edgeOf(pad)) ? 'is-lit' : ''}`}
          style={across ? { top: padAt[pad]?.y, left: -5 } : { left: padAt[pad]?.x, top: -5 }}
          isConnectable={false}
        />
      ))}
      <span
        className="fp-icon"
        data-type={component.ghost ? undefined : component.type}
        aria-hidden
      >
        <ComponentIcon component={component} {...(chip ? { surface: 'dark' as const } : {})} />
      </span>
      {mark && (
        <span className={`change-mark ${mark}`} title={mark === 'added' ? 'Added' : 'Changed'}>
          {mark === 'added' ? 'New' : 'Changed'}
        </span>
      )}
      {lit.distance && lit.distance.get(id)! > 0 && (
        <span
          className="hop"
          title={`${lit.distance.get(id)} hop${lit.distance.get(id) === 1 ? '' : 's'} away`}
        >
          {lit.distance.get(id)}
        </span>
      )}
      <span className="fp-text">
        {/* A domain reads better by its name (example.com) than by its id. */}
        <span className="fp-id">
          {component.type === 'domain' && component.name ? component.name : component.id}
        </span>
        <span className="fp-type">
          {component.ghost ? (
            <span className="ghost-pill">Not declared</span>
          ) : (
            <>
              <span>
                {TYPE_LABEL[component.type ?? ''] ?? component.type}
                {component.tech && <span className="fp-tech"> · {component.tech}</span>}
              </span>
              {component.status && (
                <span className="status-pill">{STATUS_LABEL[component.status]}</span>
              )}
            </>
          )}
        </span>
      </span>
      {outPads.map((pad) => (
        <Handle
          key={pad}
          id={pad}
          type="source"
          position={across ? Position.Right : Position.Bottom}
          className={`pad ${across ? '' : 'is-vertical'} ${lit.edges.has(edgeOf(pad)) ? 'is-lit' : ''}`}
          style={
            across
              ? { top: padAt[pad]?.y, right: -5 }
              : { left: padAt[pad]?.x, bottom: -5, top: 'auto' }
          }
          isConnectable={false}
        />
      ))}
    </div>
  );
}

function edgeOf(pad: string): string {
  return `rel:${pad.slice(pad.lastIndexOf('#') + 2)}`;
}

export function Board({ data }: NodeProps<BoardNode>) {
  const lit = useContext(LitContext);
  const has = (keys: Iterable<string>) =>
    [...keys].some((key) => key.startsWith(`${data.project}/`));
  const dim = lit.selected ? !has(lit.nodes) : lit.matches ? !has(lit.matches) : false;
  return (
    <div className={`board ${data.ghost ? 'is-ghost' : ''} ${dim ? 'is-dim' : ''}`}>
      <a className="board-label nopan" href={href.project(data.project)}>
        <span className="dot" style={{ background: data.color }} aria-hidden />
        {data.project}
        <span className="mono">{data.ghost ? 'not declared' : `${data.count} parts`}</span>
      </a>
    </div>
  );
}

export function Trace({ id, data, source, target }: EdgeProps<TraceEdge>) {
  const lit = useContext(LitContext);
  const [{ palette }] = useAppearance();
  const points = data?.points ?? [];
  const path = useMemo(() => toPath(points, palette), [points, palette]);
  const length = useMemo(() => polylineLength(points), [points]);
  if (!data || points.length < 2) return null;
  const { relation } = data;
  const outside = (key: string) =>
    (lit.matches && !lit.matches.has(key)) || (lit.marks && !lit.marks[key]);
  const state = lit.edges.has(id)
    ? 'is-lit'
    : lit.selected || outside(source) || outside(target)
      ? 'is-dim'
      : '';
  const end = points[points.length - 1]!;
  const before = points[points.length - 2]!;
  return (
    <g className={`trace-group ${state}`} style={{ ['--len' as string]: length }}>
      {/* Presentation attributes as well as classes: exports (PNG/SVG) keep the layer colours. */}
      <path
        className={`trace ${relation.type}`}
        d={path}
        fill="none"
        stroke={LAYER_COLOR[relation.type]}
        strokeWidth={2.25}
        strokeDasharray={DASHED.has(relation.type) ? '6 4' : undefined}
      />
      <path className="trace-hit" d={path} fill="none" stroke="transparent">
        <title>
          {relation.from} {relation.type.replace(/_/g, ' ')} {relation.to}
          {relation.protocol ? ` (${relation.protocol})` : ''}
        </title>
      </path>
      {palette === 'circuit' &&
        points
          .slice(1, -1)
          .map((p, i) => (
            <circle
              key={i}
              className={`via ${relation.type}`}
              cx={p.x}
              cy={p.y}
              r={3.5}
              fill={LAYER_COLOR[relation.type]}
            />
          ))}
      {palette === 'blueprint' && (
        <circle
          className={`trace-origin ${relation.type}`}
          cx={points[0]!.x}
          cy={points[0]!.y}
          r={2.5}
          fill={LAYER_COLOR[relation.type]}
        />
      )}
      {palette === 'blueprint' ? (
        <polyline
          className={`trace-arrow is-open ${relation.type}`}
          fill="none"
          stroke={LAYER_COLOR[relation.type]}
          points={arrow(before, end, 9, true)}
        />
      ) : (
        <polygon
          className={`trace-arrow ${relation.type}`}
          fill={LAYER_COLOR[relation.type]}
          points={arrow(before, end)}
        />
      )}
    </g>
  );
}

const LAYER_COLOR: Record<string, string> = {
  calls: '#8b8dff',
  publishes: '#3fb68b',
  consumes: '#3fb68b',
  reads: '#e5a54b',
  writes: '#e5a54b',
  reads_writes: '#e5a54b',
  serves: '#4cb3d4',
  spawns: '#6b6f78',
  depends_on: '#6b6f78',
};

const DASHED = new Set(['depends_on', 'spawns']);

/**
 * The route drawn in the palette's manner: Furio rounds the bends, Blueprint keeps them sharp like
 * a drafted line, Circuit cuts them at 45 degrees like a copper trace.
 */
function toPath(points: Point[], palette: Palette): string {
  if (palette === 'blueprint' || points.length < 3) {
    return points.map((p, i) => `${i ? 'L' : 'M'}${p.x},${p.y}`).join(' ');
  }
  const cut = palette === 'circuit' ? 10 : 12;
  let d = `M${points[0]!.x},${points[0]!.y}`;
  for (let i = 1; i < points.length - 1; i++) {
    const prev = points[i - 1]!;
    const at = points[i]!;
    const next = points[i + 1]!;
    // Never more than half a segment, so two close bends do not overlap.
    const r = Math.min(cut, segment(prev, at) / 2, segment(at, next) / 2);
    const a = toward(at, prev, r);
    const b = toward(at, next, r);
    d +=
      palette === 'circuit'
        ? ` L${a.x},${a.y} L${b.x},${b.y}`
        : ` L${a.x},${a.y} Q${at.x},${at.y} ${b.x},${b.y}`;
  }
  const last = points[points.length - 1]!;
  return `${d} L${last.x},${last.y}`;
}

function segment(a: Point, b: Point): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/** The point at `distance` from `from` on the way to `to`. */
function toward(from: Point, to: Point, distance: number): Point {
  const length = segment(from, to) || 1;
  return {
    x: from.x + ((to.x - from.x) / length) * distance,
    y: from.y + ((to.y - from.y) / length) * distance,
  };
}

function polylineLength(points: Point[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += Math.hypot(points[i]!.x - points[i - 1]!.x, points[i]!.y - points[i - 1]!.y);
  }
  return Math.ceil(total);
}

/** A filled head, or an open chevron (left, tip, right) to stroke. */
function arrow(from: Point, to: Point, size = 7, open = false): string {
  const angle = Math.atan2(to.y - from.y, to.x - from.x);
  const tip = { x: to.x - Math.cos(angle) * 4, y: to.y - Math.sin(angle) * 4 };
  const left = {
    x: tip.x - Math.cos(angle - Math.PI / 7) * size,
    y: tip.y - Math.sin(angle - Math.PI / 7) * size,
  };
  const right = {
    x: tip.x - Math.cos(angle + Math.PI / 7) * size,
    y: tip.y - Math.sin(angle + Math.PI / 7) * size,
  };
  return open
    ? `${left.x},${left.y} ${tip.x},${tip.y} ${right.x},${right.y}`
    : `${tip.x},${tip.y} ${left.x},${left.y} ${right.x},${right.y}`;
}

const TYPE_ICON: Record<string, LucideIcon> = {
  service: Server,
  function: Zap,
  job: Clock,
  frontend: Monitor,
  queue: ListOrdered,
  topic: Radio,
  database: Database,
  cache: Layers,
  storage: HardDrive,
  external: Globe,
  client: MonitorSmartphone,
  proxy: Waypoints,
  domain: Signpost,
};

/**
 * The extension's image for a component when there is one, otherwise the icon of its type. The
 * image is used as a mask, painted in the text colour: icons stay monochrome like the rest of the
 * board, and follow the theme and the selection.
 */
export function ComponentIcon({
  component,
  size = 16,
  surface,
}: {
  component: ModelComponent;
  size?: number;
  /** What the icon sits on, when it is not the theme's own surface. */
  surface?: Theme;
}) {
  const theme = useAppearance()[0].theme;
  const icon = component.ghost ? undefined : extensionIcon(component);
  if (icon) {
    const mask = `url("${icon.src.replace(/"/g, '%22')}") center / contain no-repeat`;
    const brand = icon.color && readable(icon.color, surface ?? theme) ? icon.color : undefined;
    return (
      <span
        className="ext-icon"
        style={{
          width: size,
          height: size,
          mask,
          WebkitMask: mask,
          ...(brand ? { ['--brand' as string]: brand } : {}),
        }}
        data-icon={icon.src}
      />
    );
  }
  return <TypeIcon type={component.ghost ? undefined : component.type} size={size} />;
}

/** A brand colour is used only when it stands out on the theme (no black on dark, no white on light). */
export function readable(hex: string, theme: Theme): boolean {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return false;
  const n = parseInt(m[1]!, 16);
  const channel = (c: number) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  const l =
    0.2126 * channel((n >> 16) & 255) +
    0.7152 * channel((n >> 8) & 255) +
    0.0722 * channel(n & 255);
  return theme === 'dark' ? l > 0.06 : l < 0.6;
}

export function TypeIcon({ type, size = 16 }: { type: string | undefined; size?: number }) {
  const Icon = (type && TYPE_ICON[type]) || SquareDashed;
  return <Icon size={size} strokeWidth={1.75} />;
}
