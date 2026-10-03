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
import { changeMarks, type ChangeMarks } from '../extensions';
import { impact, matchesFilter, revision, type Site } from '../model';
import { go, hasFilter, href, replaceView, type ViewState } from '../router';
import { FilterBox } from '../ui/FilterBox';
import { DetailPanel } from '../ui/DetailPanel';
import { ExportButtons, ZoomButtons } from './export';
import { layoutBoards, scopeFor, type Layout, type TraceData } from './layout';
import { Board, Footprint, LitContext, Trace, type Lit } from './parts';

const nodeTypes = { footprint: Footprint, board: Board };
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
const MIN_READABLE_ZOOM = 0.85;

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
  const [view, setView] = useState<ViewState>(() => (focus ? { ...initial, sel: focus } : initial));
  const flow = useReactFlow();
  const narrow = useNarrow();
  // The full canvas keeps the legend and the title block clear of the boards.
  const padding: FitViewOptions['padding'] =
    chrome && !narrow ? { top: '120px', right: '72px', bottom: '150px', left: '40px' } : 0.08;
  const host = useRef<HTMLDivElement>(null);
  const selected = view.sel ?? null;
  const update = (patch: Partial<ViewState>) => setView((current) => ({ ...current, ...patch }));
  const select = (key: string | null) =>
    update(key ? { sel: key } : { sel: undefined, mode: 'nets', depth: 0 });

  // The layout changes only when the view hides what does not match; otherwise it dims.
  const filterKey = JSON.stringify(view.filter);
  const filter = useMemo(() => (view.only ? view.filter : {}), [view.only, filterKey]);
  const matches = useMemo(() => {
    if (!chrome || !hasFilter(view.filter)) return undefined;
    return new Set(
      site.model.components.filter((c) => matchesFilter(c, view.filter)).map((c) => c.key),
    );
  }, [chrome, site, filterKey]);

  useEffect(() => {
    let live = true;
    setLayout(null);
    const box = host.current?.getBoundingClientRect();
    layoutBoards(site, {
      ...scopeFor(site, {
        ...(project ? { project } : {}),
        ...(focus ? { focus } : {}),
        filter,
      }),
      ...(narrow ? { direction: 'DOWN' as const } : {}),
      ...(box && box.height > 0 ? { canvas: { width: box.width, height: box.height } } : {}),
    })
      .then((result) => live && setLayout(result))
      .catch((e: unknown) => live && setError((e as Error).message));
    return () => {
      live = false;
    };
  }, [site, project, focus, narrow, filter]);

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

  // Fit the whole map, but never below a readable zoom: a large workspace starts at the top,
  // centred, and pans instead of shrinking every card to an unreadable size. A card selected in
  // the URL is then brought into view.
  useEffect(() => {
    if (!layout) return;
    requestAnimationFrame(() => {
      void flow
        .fitView({ padding, duration: 0, maxZoom: 1.2 })
        .then(async () => {
          const zoom = flow.getZoom();
          const box = host.current?.getBoundingClientRect();
          if (!chrome || !box || zoom >= MIN_READABLE_ZOOM) return;
          const x = box.width / 2 - (layout.width / 2) * MIN_READABLE_ZOOM;
          await flow.setViewport({ x, y: 120, zoom: MIN_READABLE_ZOOM });
        })
        .then(() => {
          if (chrome && selectedRef.current) reveal(selectedRef.current, 0);
        });
    });
  }, [layout, flow]);

  useEffect(() => {
    if (chrome) replaceView(view);
  }, [chrome, view]);

  useEffect(() => {
    if (!chrome || !selected || !layout) return;
    const id = requestAnimationFrame(() => reveal(selected));
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
      void changeMarks(view.since, site.model).then((m) => live && setMarks(m));
    return () => {
      live = false;
    };
  }, [chrome, view.since, site]);

  const lit = useMemo<Lit>(() => {
    const marked = {
      ...(marks ? { marks: marks.components } : {}),
      ...(matches ? { matches } : {}),
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
  }, [selected, layout, reach, marks, matches]);

  // The sidebar search selects on this map when the card is on it (see selectOnMap).
  useEffect(() => {
    if (!chrome) return;
    const onSelect = (event: Event) => {
      const key = (event as CustomEvent<string>).detail;
      if (!layout?.nodes.some((n) => n.id === key)) return;
      event.preventDefault();
      update({ sel: key, mode: 'nets', depth: 0 });
    };
    window.addEventListener('furio-select', onSelect);
    return () => window.removeEventListener('furio-select', onSelect);
  }, [chrome, layout]);

  const filters = chrome ? (
    <FilterBox
      site={site}
      view={view}
      matches={matches?.size ?? 0}
      onChange={update}
      collapsible={narrow}
    />
  ) : null;

  if (error || !layout || !layout.nodes.length) {
    return (
      <div className="board-canvas" ref={host}>
        {filters}
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
      <div className={`board-canvas ${chrome && selectedComponent ? 'has-panel' : ''}`} ref={host}>
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

        {chrome && selectedComponent && (
          <DetailPanel
            site={site}
            component={selectedComponent}
            view={view}
            reached={reach ? reach.distance.size - 1 : lit.edges.size}
            onChange={update}
            onSelect={(key) => update({ sel: key })}
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
  const values = Object.values(marks?.components ?? {});
  const added = values.filter((v) => v === 'added').length;
  const changed = values.length - added;
  const removed = marks?.removed ?? [];
  const parts = [
    added && `${added} added`,
    changed && `${changed} changed`,
    removed.length && `${removed.length} removed`,
    marks?.relations?.added && `+${marks.relations.added} relations`,
    marks?.relations?.removed && `−${marks.relations.removed} relations`,
  ].filter(Boolean);
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
