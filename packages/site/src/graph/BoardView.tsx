import {
  Controls,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Edge,
  type FitViewOptions,
  type Node,
} from '@xyflow/react';
import '@xyflow/react/dist/base.css';
import { X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  changeMarks,
  changeSummary,
  extensionArrange,
  extensionBadges,
  type CardBadge,
  type ChangeMarks,
} from '../extensions';
import { impact, matchesFilter, revision, type Site } from '../model';
import { flowOnly, go, hasFilter, href, replaceView, type ViewState } from '../router';
import { marksIn, projectScope } from '../scope';
import { ArrangeMenu } from '../ui/ArrangeMenu';
import { FilterBox } from '../ui/FilterBox';
import { DetailPanel } from '../ui/DetailPanel';
import { ExportButtons, ZoomButtons } from './export';
import type { Box } from './arrange';
import { layoutBoards, READABLE_ZOOM, scopeFor, type Layout, type TraceData } from './layout';
import { Board, Footprint, LitContext, Ring, Trace, type Lit } from './parts';

const nodeTypes = { footprint: Footprint, board: Board, ring: Ring };
const edgeTypes = { trace: Trace };

export interface BoardViewProps {
  site: Site;
  project?: string;
  /** Neighbourhood of one component (the component page). */
  focus?: string;
  /** Overlays (title block, legend, net report, filters) only on the full canvas. */
  chrome?: boolean;
  /** Selection, mode and filters, from the URL. */
  view?: ViewState;
}

const DEFAULT_VIEW: ViewState = { mode: 'nets', depth: 0, filter: {} };
const MIN_READABLE_ZOOM = READABLE_ZOOM;
/** What the detail panel covers on the right of the canvas, with its margin. */
const PANEL = 372;
/** What the overlays of the full canvas cover: the filter, the buttons, the legend, the title. */
const INSET = { top: 120, right: 72, bottom: 150, left: 40 };
/** On phones only the filter and the buttons, at the top. */
const INSET_NARROW = { top: 56, right: 16, bottom: 16, left: 16 };
const EDGE = 16;

/** The pace of the map's state changes (--step); none for a viewer who asked for less motion. */
const step = () => (window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 150);

export function BoardView(props: BoardViewProps) {
  return (
    <ReactFlowProvider>
      <Canvas {...props} />
    </ReactFlowProvider>
  );
}

function Canvas({
  site,
  project,
  focus,
  chrome = true,
  view: initial = DEFAULT_VIEW,
}: BoardViewProps) {
  const [layout, setLayout] = useState<Layout | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The other arrangements are the host's to offer: without them a link opens on the flow.
  const arrangeable = chrome && extensionArrange();
  const [view, setView] = useState<ViewState>(() => {
    const first = focus ? { ...initial, sel: focus } : initial;
    return arrangeable ? first : flowOnly(first);
  });
  const flow = useReactFlow();
  const narrow = useNarrow();
  // The full canvas keeps the legend and the title block clear of the boards.
  const padding: FitViewOptions['padding'] =
    chrome && !narrow
      ? {
          top: `${INSET.top}px`,
          right: `${INSET.right}px`,
          bottom: `${INSET.bottom}px`,
          left: `${INSET.left}px`,
        }
      : 0.08;
  const host = useRef<HTMLDivElement>(null);
  const selected = view.sel ?? null;
  const update = (patch: Partial<ViewState>) => setView((current) => ({ ...current, ...patch }));
  // Arranged around a component, the card that is selected becomes the centre.
  const centred = (key: string): Partial<ViewState> =>
    view.arrange === 'around' ? { sel: key, around: key } : { sel: key };
  const select = (key: string | null) =>
    update(key ? centred(key) : { sel: undefined, mode: 'nets', depth: 0 });
  const [arranging, setArranging] = useState(false);
  // The viewer's choice of direction; on phones the layers run down unless they chose.
  const direction =
    view.dir === 'right' ? 'RIGHT' : view.dir === 'down' || narrow ? 'DOWN' : undefined;
  // Around a component, on phones, the map is a stack: what uses it above, what it uses below.
  const upright = chrome && view.arrange === 'around' && narrow;

  // The layout changes only when the view hides what does not match; otherwise it dims.
  const filterKey = JSON.stringify(view.filter);
  const filter = useMemo(() => (view.only ? view.filter : {}), [view.only, filterKey]);
  // A project's map is its scope: the filter offers, matches and counts only what it shows.
  const scope = useMemo(() => (project ? projectScope(site, project) : undefined), [site, project]);
  const matches = useMemo(() => {
    if (!chrome || !hasFilter(view.filter)) return undefined;
    return new Set(
      site.model.components
        .filter((c) => (!scope || scope.map.has(c.key)) && matchesFilter(c, view.filter))
        .map((c) => c.key),
    );
  }, [chrome, site, scope, filterKey]);

  useEffect(() => {
    let live = true;
    // A map around a component stays on screen while its centre moves: the cards glide.
    if (!(view.arrange === 'around' && layout?.around)) setLayout(null);
    const box = host.current?.getBoundingClientRect();
    layoutBoards(site, {
      ...scopeFor(site, {
        ...(project ? { project } : {}),
        ...(focus ? { focus } : {}),
        filter,
      }),
      ...(direction ? { direction } : {}),
      ...(box && box.height > 0 ? { canvas: { width: box.width, height: box.height } } : {}),
      ...(chrome && view.arrange ? { arrange: view.arrange } : {}),
      ...(chrome && view.group ? { group: view.group } : {}),
      ...(chrome && view.around ? { centre: view.around } : {}),
      ...(upright ? { upright } : {}),
    })
      .then((result) => live && setLayout(result))
      .catch((e: unknown) => live && setError((e as Error).message));
    return () => {
      live = false;
    };
  }, [site, project, focus, direction, upright, filter, view.arrange, view.group, view.around]);

  /** Brings a card into view when it is off screen or under the detail panel. */
  const reveal = (key: string, duration = 300) => {
    const node = flow.getInternalNode(key);
    const box = host.current?.getBoundingClientRect();
    if (!node || !box) return;
    const { x: vx, y: vy, zoom } = flow.getViewport();
    const { x, y } = node.internals.positionAbsolute;
    const w = node.measured.width ?? 216;
    const h = node.measured.height ?? 76;
    // The filter bar covers the top of the canvas, the panel its right (a sheet on phones).
    const bar = host.current?.querySelector('.filter-bar, .filter-toggle')?.getBoundingClientRect();
    const covered = {
      top: bar ? bar.bottom - box.top : 0,
      right: narrow ? 0 : 372,
      bottom: narrow ? box.height * 0.55 : 0,
    };
    const left = x * zoom + vx;
    const top = y * zoom + vy;
    const visible =
      left >= 0 &&
      top >= covered.top &&
      left + w * zoom <= box.width - covered.right &&
      top + h * zoom <= box.height - covered.bottom;
    if (visible) return;
    void flow.setCenter(
      x + w / 2 + covered.right / 2 / zoom,
      y + h / 2 + (covered.bottom - covered.top) / 2 / zoom,
      { zoom, duration },
    );
  };
  const selectedRef = useRef(selected);
  selectedRef.current = selected;

  /**
   * Blast radius and Depends on answer a question: fits every lit card, the selected one
   * included, in the part of the canvas the overlays leave free (the filter bar, the buttons,
   * the legend, and the panel: a column on the right, a sheet from the bottom on phones). False
   * when there is nothing to frame: direct relations, or a selection that reaches nothing here.
   */
  const framed = useRef<string[]>([]);
  const frame = (duration = 300): boolean => {
    const canvas = host.current;
    if (!canvas || framed.current.length < 2) return false;
    const box = canvas.getBoundingClientRect();
    const shown = (selector: string) => {
      const rect = canvas.querySelector(selector)?.getBoundingClientRect();
      return rect?.height ? rect : undefined;
    };
    const bar = shown('.filter-bar, .filter-toggle');
    const buttons = shown('.react-flow__controls');
    const legend = shown('.legend');
    // By its offsets, not its rectangle: the panel is still sliding in when a link opens.
    const panel = canvas.querySelector<HTMLElement>('.detail-panel');
    const sheet = panel?.offsetLeft === 0;
    const covered = {
      top: bar ? bar.bottom - box.top : 0,
      right: Math.max(
        panel && !sheet ? box.width - panel.offsetLeft : 0,
        buttons ? box.right - buttons.left : 0,
      ),
      bottom: Math.max(
        panel && sheet ? box.height - panel.offsetTop : 0,
        legend ? box.bottom - legend.top : 0,
      ),
    };
    const gap = 16;
    void flow.fitView({
      nodes: framed.current.map((id) => ({ id })),
      padding: {
        top: `${Math.round(covered.top) + gap}px`,
        right: `${Math.round(covered.right) + gap}px`,
        bottom: `${Math.round(covered.bottom) + gap}px`,
        left: `${gap}px`,
      },
      maxZoom: 1.2,
      duration,
    });
    return true;
  };

  /**
   * Around a component the view opens on as much as reads at once: the rings whole, or every
   * card, or the centre with the cards one hop away, or the centre alone. The rest is a pan
   * away. With the panel open, in the part of the canvas it leaves free.
   */
  const frameAround = async (around: NonNullable<Layout['around']>, duration = 0) => {
    const box = host.current?.getBoundingClientRect();
    const [whole, ...closer] = around.frames;
    if (!box || !whole) return;
    const open = !!selectedRef.current;
    const base = narrow ? INSET_NARROW : INSET;
    const inset = {
      ...base,
      right: open && !narrow ? PANEL + 24 : base.right,
      bottom: open && narrow ? box.height * 0.55 : base.bottom,
    };
    const free = {
      width: box.width - inset.left - inset.right,
      height: box.height - inset.top - inset.bottom,
    };
    const fit = (frame: Box) => Math.min(free.width / frame.width, free.height / frame.height);
    const readable = fit(whole) >= MIN_READABLE_ZOOM;
    const zoom = readable ? Math.min(fit(whole), 1.2) : MIN_READABLE_ZOOM;
    const frame = readable
      ? whole
      : (closer.find((f) => fit(f) >= MIN_READABLE_ZOOM) ?? around.frames.at(-1)!);
    await flow.setViewport(
      {
        x: inset.left + free.width / 2 - (frame.x + frame.width / 2) * zoom,
        y: inset.top + free.height / 2 - (frame.y + frame.height / 2) * zoom,
        zoom,
      },
      { duration },
    );
  };

  // Fit the whole map, but never below a readable zoom: a large workspace starts where its flow
  // starts (the top, centred; the left edge when it runs right) and pans instead of shrinking
  // every card to an unreadable size. A card selected in the URL is then brought into view, or
  // everything it lights when the link asks a question.
  const fitted = useRef<Layout | null>(null);
  useEffect(() => {
    const before = fitted.current;
    fitted.current = layout;
    if (!layout) return;
    // A new centre is one continuous change: the view follows at the pace of the cards.
    const glide = before?.around && layout.around && before !== layout ? step() : 0;
    // A map that came after this one frames itself: this one stops where it is.
    let live = true;
    const fit = async () => {
      // A new map is measured first; one that stays on screen moves from where it is.
      if (!glide) await flow.fitView({ padding, duration: 0, maxZoom: 1.2 });
      if (!live) return;
      if (layout.around) return frameAround(layout.around, glide);
      const box = host.current?.getBoundingClientRect();
      if (!chrome || !box || flow.getZoom() >= MIN_READABLE_ZOOM) return;
      const zoom = MIN_READABLE_ZOOM;
      const inset = narrow ? INSET_NARROW : INSET;
      if (layout.direction === 'RIGHT' && layout.width * zoom > box.width) {
        // The first board whole by the left edge, its name clear of what covers the canvas.
        const boards = layout.nodes.filter((n) => !n.parentId);
        const left = Math.min(...boards.map((n) => n.position.x));
        const top = Math.min(...boards.map((n) => n.position.y));
        const bottom = Math.max(...boards.map((n) => n.position.y + Number(n.style?.height)));
        const spare = box.height - inset.top - inset.bottom - (bottom - top) * zoom;
        await flow.setViewport({
          x: EDGE - left * zoom,
          y: inset.top + Math.max(spare, 0) / 2 - top * zoom,
          zoom,
        });
        return;
      }
      await flow.setViewport({ x: box.width / 2 - (layout.width / 2) * zoom, y: 120, zoom });
    };
    const id = requestAnimationFrame(() => {
      void fit().then(() => {
        if (live && chrome && selectedRef.current && !frame(0)) reveal(selectedRef.current, 0);
      });
    });
    return () => {
      live = false;
      cancelAnimationFrame(id);
    };
  }, [layout, flow]);

  useEffect(() => {
    if (chrome) replaceView(view);
  }, [chrome, view]);

  useEffect(() => {
    if (!chrome || !selected || !layout) return;
    const id = requestAnimationFrame(() => {
      // Around a component the view makes room for the panel; a new centre brings its own map.
      if (!layout.around) reveal(selected);
      else if (layout.around.centre === selected) void frameAround(layout.around, step());
    });
    return () => cancelAnimationFrame(id);
    // Only when the selection changes: a new layout reveals it after fitting.
  }, [selected]);

  useEffect(() => {
    if (!chrome) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement)
        return;
      if (event.key === 'Escape') select(null);
      if (event.key === 'Enter' && selected) go(href.component(selected));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [chrome, selected]);

  const reach = useMemo(
    () =>
      selected && view.mode !== 'nets'
        ? impact(site, selected, view.mode === 'impact' ? 'up' : 'down', view.depth)
        : null,
    [site, selected, view.mode, view.depth],
  );

  const [marks, setMarks] = useState<ChangeMarks | undefined>();
  useEffect(() => {
    let live = true;
    setMarks(undefined);
    if (chrome && view.since)
      void changeMarks(view.since, site.model, project).then(
        (m) => live && setMarks(m && scope ? marksIn(m, scope) : m),
      );
    return () => {
      live = false;
    };
  }, [chrome, view.since, site, project, scope]);

  const [badges, setBadges] = useState<Record<string, CardBadge>>({});
  useEffect(() => {
    let live = true;
    void extensionBadges(site.model).then((b) => live && setBadges(b));
    return () => {
      live = false;
    };
  }, [site]);

  const lit = useMemo<Lit>(() => {
    const marked = {
      ...(marks ? { marks: marks.components } : {}),
      ...(matches ? { matches } : {}),
      badges,
    };
    if (!selected || !layout)
      return { selected: null, nodes: new Set(), edges: new Set(), ...marked };
    const nodes = new Set([selected]);
    const edges = new Set<string>();
    for (const edge of layout.edges) {
      const relation = (edge.data as TraceData).relation;
      const on = reach
        ? reach.relations.has(relation)
        : edge.source === selected || edge.target === selected;
      if (on) {
        edges.add(edge.id);
        nodes.add(edge.source);
        nodes.add(edge.target);
      }
    }
    return { selected, nodes, edges, ...(reach ? { distance: reach.distance } : {}), ...marked };
  }, [selected, layout, reach, marks, matches, badges]);
  framed.current = chrome && reach ? [...lit.nodes] : [];

  // A new question from the panel (the mode, the depth) moves the map to its answer. A new
  // layout frames it after fitting.
  useEffect(() => {
    if (!layout) return;
    const id = requestAnimationFrame(() => frame());
    return () => cancelAnimationFrame(id);
  }, [view.mode, view.depth]);

  // The sidebar search selects on this map when the card is on it (see selectOnMap).
  useEffect(() => {
    if (!chrome) return;
    const onSelect = (event: Event) => {
      const key = (event as CustomEvent<string>).detail;
      // Around a component, anything in the workspace can become the centre, even what the rings
      // leave out; otherwise only what is on this map.
      const reachable = view.arrange === 'around' && !view.only && !project && site.byKey.has(key);
      if (!reachable && !layout?.nodes.some((n) => n.id === key)) return;
      event.preventDefault();
      update({ ...centred(key), mode: 'nets', depth: 0 });
    };
    window.addEventListener('furio-select', onSelect);
    return () => window.removeEventListener('furio-select', onSelect);
  }, [chrome, layout, project, view.arrange, view.only]);

  const filters = chrome ? (
    <FilterBox
      site={site}
      {...(scope ? { within: scope.map } : {})}
      view={view}
      matches={matches?.size ?? 0}
      onChange={update}
      collapsible={narrow}
    />
  ) : null;
  const arrange = arrangeable ? (
    <ArrangeMenu
      view={view}
      around={layout?.around}
      open={arranging}
      onOpen={setArranging}
      onChange={update}
    />
  ) : null;

  if (error || !layout || !layout.nodes.length) {
    return (
      <div className={`board-canvas ${arrangeable ? 'has-arrange' : ''}`} ref={host}>
        {filters}
        {arrange}
        <div className="layout-status" role={error ? 'alert' : 'status'}>
          {error
            ? `Layout failed: ${error}`
            : !layout
              ? 'Routing traces…'
              : hasFilter(filter)
                ? 'No part matches the filter.'
                : 'No components on this board yet.'}
        </div>
      </div>
    );
  }

  const selectedComponent = selected ? site.byKey.get(selected) : undefined;

  return (
    <LitContext.Provider value={lit}>
      <div
        className={`board-canvas ${arrangeable ? 'has-arrange' : ''} ${layout.around ? 'is-around' : ''} ${chrome && selectedComponent ? 'has-panel' : ''}`}
        ref={host}
      >
        <ReactFlow
          nodes={layout.nodes as Node[]}
          edges={layout.edges as Edge[]}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable={false}
          minZoom={0.15}
          maxZoom={2.5}
          fitView
          fitViewOptions={{ padding, maxZoom: 1.2 }}
          proOptions={{ hideAttribution: true }}
          onNodeClick={(_, node) => {
            // A click on a board, outside any card, clears the selection like the canvas does.
            if (node.type !== 'footprint') return chrome && select(null);
            if (!chrome) go(href.component(node.id));
            else if (selected !== node.id) select(node.id);
          }}
          onNodeDoubleClick={(_, node) => {
            if (chrome && node.type === 'footprint') go(href.component(node.id));
          }}
          zoomOnDoubleClick={!chrome}
          onPaneClick={() => chrome && select(null)}
        >
          <Controls
            showInteractive={false}
            showZoom={false}
            showFitView={false}
            position="top-right"
          >
            <ZoomButtons fitPadding={{ padding, maxZoom: 1.2 }} />
            {chrome && <ExportButtons site={site} />}
          </Controls>
        </ReactFlow>

        {filters}
        {arrange}

        {chrome && selectedComponent && (
          <DetailPanel
            site={site}
            component={selectedComponent}
            view={view}
            reached={reach ? reach.distance.size - 1 : lit.edges.size}
            onChange={update}
            onSelect={(key) => update(centred(key))}
            onClose={() => select(null)}
          />
        )}

        {chrome && view.since && (
          <ChangesBanner marks={marks} onClear={() => update({ since: undefined })} />
        )}
        {chrome && <Legend />}
        {chrome && <TitleBlock site={site} project={project} />}
      </div>
    </LitContext.Provider>
  );
}

function ChangesBanner({ marks, onClear }: { marks?: ChangeMarks; onClear: () => void }) {
  const removed = marks?.removed ?? [];
  const parts = changeSummary(marks);
  return (
    <div className="overlay changes-banner" role="status">
      <span className="changes-title">{marks?.label ?? 'Changes'}</span>
      <span
        className="changes-count"
        title={removed.length ? `Removed: ${removed.join(', ')}` : undefined}
      >
        {!marks
          ? 'No change in this period.'
          : parts.length
            ? parts.join(' · ')
            : 'No change to the map.'}
      </span>
      <button
        className="icon-button"
        type="button"
        onClick={onClear}
        aria-label="Leave the Changes view"
      >
        <X size={14} aria-hidden />
      </button>
    </div>
  );
}

const LAYERS: [string, string, boolean?][] = [
  ['calls', 'calls'],
  ['publishes', 'publishes · consumes'],
  ['reads', 'reads · writes'],
  ['serves', 'serves'],
  ['depends_on', 'depends on · spawns', true],
];

function Legend() {
  return (
    <div className="overlay legend" aria-label="Legend">
      <span className="legend-title">Layers</span>
      {LAYERS.map(([type, label, dashed]) => (
        <span className="legend-row" key={type}>
          <svg width="22" height="6" aria-hidden>
            <line
              x1="0"
              y1="3"
              x2="22"
              y2="3"
              className={`trace ${type}`}
              strokeDasharray={dashed ? '5 3' : undefined}
            />
          </svg>
          {label}
        </span>
      ))}
      <span
        className="legend-row"
        title="On the map, but Blast radius and Depends on do not follow it"
      >
        <svg width="22" height="6" aria-hidden>
          <line x1="1" y1="3" x2="22" y2="3" className="trace is-non-critical" />
        </svg>
        non-critical, any colour
      </span>
      <span className="legend-row">
        <svg width="22" height="12" aria-hidden>
          <rect
            x="1"
            y="1"
            width="20"
            height="10"
            fill="none"
            stroke="var(--ghost)"
            strokeDasharray="3 2"
          />
        </svg>
        Not declared by any repo
      </span>
    </div>
  );
}

function TitleBlock({ site, project }: { site: Site; project?: string }) {
  const { model } = site;
  const valid = model.repos.filter((r) => r.status === 'valid').length;
  const total = model.repos.filter((r) => r.status !== 'skipped').length;
  const generated = new Date(model.generatedAt);
  return (
    <dl className="overlay title-block" aria-label="Title block">
      <div className="tb-name">
        <dt>{project ? 'Board' : 'Workspace'}</dt>
        <dd>{project ?? model.workspace.id}</dd>
      </div>
      <div className="tb-l">
        <dt>Generated</dt>
        <dd>
          <time dateTime={model.generatedAt}>
            {generated.toISOString().slice(0, 16).replace('T', ' ')} UTC
          </time>
        </dd>
      </div>
      <div>
        <dt>Repos on map</dt>
        <dd>
          {valid} / {total}
        </dd>
      </div>
      <div className="tb-l">
        <dt>Rev</dt>
        <dd title="Fingerprint of the repo commits on this map">{revision(model)}</dd>
      </div>
      <div>
        <dt>Parts</dt>
        <dd>
          {model.components.filter((c) => !c.ghost && (!project || c.project === project)).length}
        </dd>
      </div>
      <div className="tb-wide tb-last">
        <dt>Checked by</dt>
        <dd>furio {model.generator.version}</dd>
      </div>
    </dl>
  );
}

/** Narrow screens stack boards top to bottom instead of left to right. */
function useNarrow(): boolean {
  const query = '(max-width: 760px)';
  const [narrow, setNarrow] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const media = window.matchMedia(query);
    const onChange = () => setNarrow(media.matches);
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, []);
  return narrow;
}
