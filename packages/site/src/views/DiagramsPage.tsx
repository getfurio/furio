import {
  ArrowLeft,
  ArrowLeftRight,
  ArrowRight,
  Blocks,
  Boxes,
  ChartColumn,
  ChartGantt,
  FileText,
  GitGraph,
  ListTree,
  Milestone,
  Network,
  Repeat,
  Route as RouteIcon,
  Search as SearchIcon,
  Shapes,
  SquareKanban,
  Table2,
  Workflow,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { diagramKind, findDiagrams, partLabel, type ModelDiagram } from '../diagrams';
import type { Site } from '../model';
import { contents, type Scope } from '../scope';
import { go, href, replaceHash, type DiagramFind, type Route } from '../router';
import { Diagram } from '../ui/Diagram';
import { FacetMenu } from '../ui/FacetMenu';
import { PeekLink } from '../ui/Peek';

export const DIAGRAMS_GUIDE = 'https://getfurio.com/docs/manifest#diagrams';

const KIND_ICON: Record<string, LucideIcon> = {
  flowchart: Workflow,
  sequence: ArrowLeftRight,
  state: Repeat,
  entities: Table2,
  class: Boxes,
  journey: RouteIcon,
  gantt: ChartGantt,
  timeline: Milestone,
  git: GitGraph,
  mindmap: Network,
  c4: Blocks,
  architecture: Blocks,
  requirements: ListTree,
  kanban: SquareKanban,
  chart: ChartColumn,
  document: FileText,
};

function KindIcon({ diagram, size }: { diagram: ModelDiagram; size: number }) {
  const Icon = KIND_ICON[diagramKind(diagram).id] ?? Shapes;
  return <Icon size={size} strokeWidth={1.75} aria-hidden />;
}

/** The name of a repo without its account: the part that tells two repos of a project apart. */
const repoName = (repo: string) => repo.slice(repo.lastIndexOf('/') + 1);

/** How many of the components a diagram describes a card names; the rest is a count. */
const NAMED = 2;

/**
 * The diagrams of the workspace as a grid of cards, with a search and a menu of projects; a card
 * opens the diagram on a page of its own, which moves to the next and the previous of the ones
 * found. In a project's scope, the project's diagrams only.
 */
export function DiagramsPage({
  site,
  route,
  scope,
}: {
  site: Site;
  route: Extract<Route, { name: 'diagrams' }>;
  scope?: Scope | undefined;
}) {
  const { diagrams } = useMemo(() => contents(site, scope), [site, scope]);
  const [query, setQuery] = useState(route.q ?? '');
  const [picked, setPicked] = useState(route.projects ?? []);
  // A link followed while the page is open (a card, a shared address) brings its own search and
  // projects; what is typed and ticked here only rewrites the address, and leaves the route as it is.
  const [followed, setFollowed] = useState(route);
  if (followed !== route) {
    setFollowed(route);
    setQuery(route.q ?? '');
    setPicked(route.projects ?? []);
  }
  const projects = useMemo(() => (scope ? [] : picked), [scope, picked]);
  const find = useMemo<DiagramFind>(
    () => ({ q: query.trim() || undefined, projects }),
    [query, projects],
  );
  const found = useMemo(() => findDiagrams(site, diagrams, find), [site, diagrams, find]);

  // The search and the projects live in the URL: a narrowed grid can be shared, and the page of a
  // diagram keeps them, to move among the ones found and to lead back to them.
  useEffect(() => {
    replaceHash(href.diagrams(route.diagram, find));
  }, [route.diagram, find]);

  // Back on the grid, the card of the diagram just read is where the reader left off.
  const last = useRef<string | undefined>(undefined);
  const grid = useRef<HTMLUListElement>(null);
  useEffect(() => {
    const scroller = document.querySelector('.page-scroll');
    if (route.diagram) {
      last.current = route.diagram;
      scroller?.scrollTo({ top: 0 });
      return;
    }
    const card = [...(grid.current?.querySelectorAll<HTMLElement>('[data-diagram]') ?? [])].find(
      (el) => el.dataset.diagram === last.current,
    );
    last.current = undefined;
    if (!card) return;
    card.scrollIntoView({ block: 'center' });
    card.querySelector('a')?.focus({ preventScroll: true });
  }, [route.diagram]);

  if (route.diagram)
    return (
      <DiagramSheet
        site={site}
        diagramKey={route.diagram}
        found={found}
        find={find}
        all={diagrams.length}
      />
    );

  const counts = new Map<string, number>();
  for (const d of findDiagrams(site, diagrams, { q: find.q }))
    counts.set(d.project, (counts.get(d.project) ?? 0) + 1);
  const inProjects = new Set(diagrams.map((d) => d.project));
  const options = [...new Set([...inProjects, ...projects])]
    .map((project) => ({
      value: project,
      label: project,
      count: counts.get(project) ?? 0,
      dot: site.projectColor.get(project),
    }))
    .filter((o) => o.count > 0 || projects.includes(o.value))
    .sort((a, b) => a.label.localeCompare(b.label));
  const narrowed = Boolean(find.q) || projects.length > 0;

  return (
    <div className="sheet sheet-wide">
      <header className="title-band" style={{ gridTemplateColumns: '1fr' }}>
        <h1 style={{ fontFamily: 'var(--sans)' }}>Diagrams</h1>
        <span className="tb-sub">
          {diagrams.length === 0 ? (
            scope ? (
              <>
                No diagrams in <strong>{scope.project}</strong> yet.
              </>
            ) : (
              <>
                No diagrams on the <strong>{site.model.workspace.id}</strong> map yet.
              </>
            )
          ) : scope ? (
            <>
              {diagrams.length} {diagrams.length === 1 ? 'diagram' : 'diagrams'} in{' '}
              <strong>{scope.project}</strong>: the flows a graph cannot show.
            </>
          ) : (
            <>
              {diagrams.length} {diagrams.length === 1 ? 'diagram' : 'diagrams'} in{' '}
              {inProjects.size} {inProjects.size === 1 ? 'project' : 'projects'}: the flows a graph
              cannot show.
            </>
          )}
        </span>
      </header>

      {diagrams.length === 0 ? (
        <div className="empty-diagrams">
          <Workflow size={20} aria-hidden />
          <div>
            <p>
              Diagrams live next to the manifest, in{' '}
              <span className="mono">.architecture/diagrams/</span>: a{' '}
              <span className="mono">.mmd</span> file with one Mermaid diagram, or a{' '}
              <span className="mono">.md</span> file with <span className="mono">```mermaid</span>{' '}
              blocks. List each one under <span className="mono">diagrams:</span> with a title and
              the components it describes:
            </p>
            <pre className="code">{`diagrams:
  - file: diagrams/checkout-flow.mmd
    title: Checkout flow
    components: [shop-api, platform/payments]`}</pre>
            <a className="button quiet" href={DIAGRAMS_GUIDE} rel="noreferrer" target="_blank">
              How to add diagrams <ArrowRight size={13} aria-hidden />
            </a>
          </div>
        </div>
      ) : (
        <>
          <div className="dg-tools">
            <label className="search-field dg-search">
              <SearchIcon size={16} aria-hidden />
              <span className="visually-hidden">Search the diagrams</span>
              <input
                type="search"
                value={query}
                placeholder="Search title, component, repo, kind…"
                onChange={(e) => setQuery(e.target.value)}
              />
              <span className="cat-found" role="status">
                {found.length} {found.length === 1 ? 'diagram' : 'diagrams'}
              </span>
            </label>
            {!scope && inProjects.size > 1 && (
              <div className="facets" role="group" aria-label="Filter the diagrams">
                <FacetMenu
                  label="Project"
                  options={options}
                  selected={projects}
                  onChange={setPicked}
                />
              </div>
            )}
          </div>

          {found.length === 0 ? (
            <p className="empty-state">
              {find.q ? `No diagram matches “${find.q}”` : 'No diagram'}
              {projects.length > 0 && ` in ${projects.join(', ')}`}.{' '}
              {narrowed && (
                <button
                  type="button"
                  className="link"
                  onClick={() => {
                    setQuery('');
                    setPicked([]);
                  }}
                >
                  Show every diagram
                </button>
              )}
            </p>
          ) : (
            <ul className="dg-grid" ref={grid}>
              {found.map((d) => (
                <li className="dg-card" key={d.key} data-diagram={d.key}>
                  <span className="dg-tile">
                    <KindIcon diagram={d} size={16} />
                  </span>
                  <h2>
                    {/* A long title is cut at two lines: the pointer shows it whole. */}
                    <a
                      href={href.diagrams(d.key, find)}
                      {...(d.title.length > 40 ? { title: d.title } : {})}
                    >
                      {d.title}
                    </a>
                  </h2>
                  <span className="dg-kind">{diagramKind(d).label}</span>
                  <span className="dg-where">
                    <span
                      className="dot"
                      style={{ background: site.projectColor.get(d.project) }}
                      aria-hidden
                    />
                    {d.project}
                    {/* A repo named after its project would only say it twice. */}
                    {repoName(d.repo) !== d.project && (
                      <span className="mono">{repoName(d.repo)}</span>
                    )}
                  </span>
                  {d.components.length > 0 && (
                    <span className="dg-parts" aria-label="Describes">
                      {d.components.slice(0, NAMED).map((key) => (
                        <span className="tag mono" key={key}>
                          {partLabel(d, key)}
                        </span>
                      ))}
                      {d.components.length > NAMED && (
                        <span className="dg-more">+{d.components.length - NAMED}</span>
                      )}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

/**
 * One diagram on a page of its own: what it is and where it lives, the diagram at the width of
 * the page, the components it describes. j and k move among the diagrams the grid had found.
 */
function DiagramSheet({
  site,
  diagramKey,
  found,
  find,
  all,
}: {
  site: Site;
  diagramKey: string;
  found: ModelDiagram[];
  find: DiagramFind;
  /** How many diagrams the grid holds before any search. */
  all: number;
}) {
  // A link from a part of another project on this map leads to a diagram the scope does not list.
  const diagram =
    found.find((d) => d.key === diagramKey) ??
    site.model.diagrams.find((d) => d.key === diagramKey);
  const index = found.findIndex((d) => d.key === diagramKey);
  const prev = index > 0 ? found[index - 1] : undefined;
  const next = index >= 0 && index < found.length - 1 ? found[index + 1] : undefined;
  const back = href.diagrams(undefined, find);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return;
      // An enlarged diagram has the keys to itself.
      if (event.metaKey || event.ctrlKey || event.altKey || document.querySelector('.viewer'))
        return;
      if (event.key === 'j' && next) go(href.diagrams(next.key, find));
      if (event.key === 'k' && prev) go(href.diagrams(prev.key, find));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [prev, next, find]);

  if (!diagram) {
    return (
      <div className="sheet">
        <div className="empty-state">
          No diagram <span className="mono">{diagramKey}</span> on this map.{' '}
          <a href={back}>Back to the diagrams</a>
        </div>
      </div>
    );
  }

  return (
    <article className="sheet sheet-wide">
      <header className="title-band">
        <span className="tb-ref" aria-hidden>
          <KindIcon diagram={diagram} size={22} />
        </span>
        <h1 style={{ fontFamily: 'var(--sans)' }}>{diagram.title}</h1>
        <nav className="tb-nav" aria-label="Other diagrams">
          <a className="button" href={back} title="Back to the grid of diagrams">
            <ArrowLeft size={14} aria-hidden /> Diagrams
          </a>
          <a
            className="button"
            href={prev ? href.diagrams(prev.key, find) : undefined}
            aria-disabled={!prev}
            title="Previous (k)"
          >
            <ArrowLeft size={14} aria-hidden /> k
          </a>
          <a
            className="button"
            href={next ? href.diagrams(next.key, find) : undefined}
            aria-disabled={!next}
            title="Next (j)"
          >
            j <ArrowRight size={14} aria-hidden />
          </a>
        </nav>
        <span className="tb-sub dg-meta">
          <span>{diagramKind(diagram).label}</span>
          <a href={href.project(diagram.project)}>
            <span
              className="dot"
              style={{ background: site.projectColor.get(diagram.project) }}
              aria-hidden
            />
            {diagram.project}
          </a>
          <span className="mono">
            {diagram.repo} · .architecture/{diagram.file}
          </span>
          {index >= 0 && (
            <span>
              {index + 1} of {found.length}
              {found.length < all && ' found'}
            </span>
          )}
        </span>
      </header>

      {/* Each diagram draws from scratch: nothing of the one before it, an error included. */}
      <Diagram key={diagram.key} diagram={diagram} head={false}>
        {diagram.components.length > 0 && (
          <figcaption className="diagram-parts">
            <span>Describes</span>
            {diagram.components.map((key) => (
              <PeekLink key={key} className="tag mono" componentKey={key}>
                {key}
              </PeekLink>
            ))}
          </figcaption>
        )}
      </Diagram>
    </article>
  );
}
