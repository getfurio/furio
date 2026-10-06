import {
  Activity,
  ExternalLink,
  LayoutGrid,
  Map as MapIcon,
  Monitor,
  Moon,
  Settings,
  Sun,
  Table2,
  Workflow,
  X,
} from 'lucide-react';
import { extensionNav, type NavLink } from './extensions';
import { PALETTE_LABEL, PALETTES, useAppearance } from './theme';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { BoardView } from './graph/BoardView';
import { indexModel, loadModel, revision, type Site } from './model';
import {
  href,
  linksIn,
  pageIn,
  routeScope,
  serializeView,
  useHere,
  useRoute,
  type Route,
} from './router';
import { contents, projectScope, type Scope } from './scope';
import { PeekProvider } from './ui/Peek';
import { Search } from './ui/Search';
import { CatalogPage } from './views/CatalogPage';
import { ComponentPage } from './views/ComponentPage';
import { DiagramsPage } from './views/DiagramsPage';
import { HealthPage } from './views/HealthPage';

export function App() {
  const [site, setSite] = useState<Site | null>(null);
  const [error, setError] = useState<string | null>(null);
  const route = useRoute();

  useEffect(() => {
    loadModel()
      .then((model) => setSite(indexModel(model)))
      .catch((e: unknown) => setError((e as Error).message));
  }, []);

  useEffect(() => {
    if (!site) return;
    const page =
      route.name === 'component'
        ? route.key
        : route.name === 'health'
          ? 'Health'
          : route.name === 'diagrams'
            ? (site.model.diagrams.find((d) => d.key === route.diagram)?.title ?? 'Diagrams')
            : route.name === 'catalog'
              ? 'Catalog'
              : '';
    const where = [page, routeScope(route), site.model.workspace.id].filter(Boolean);
    document.title = `${where.join(' · ')} · Furio map`;
  }, [site, route]);

  if (error) {
    return (
      <div className="load-state" role="alert">
        <div>
          <h1>Furio could not read model.json</h1>
          <p>
            {error}. The map is built by <span className="mono">furio build</span> into a{' '}
            <span className="mono">model.json</span> next to this page.
          </p>
        </div>
      </div>
    );
  }
  if (!site) {
    return (
      <div className="load-state" aria-live="polite">
        <p className="mono">Loading the map…</p>
      </div>
    );
  }

  return (
    <div className="shell">
      <Sidebar site={site} route={route} />
      <main className="main" id="main">
        <PeekProvider site={site}>
          <View site={site} route={route} />
        </PeekProvider>
      </main>
    </div>
  );
}

function View({ site, route }: { site: Site; route: Route }) {
  const project = routeScope(route);
  const scope = project ? projectScope(site, project) : undefined;
  switch (route.name) {
    case 'project':
      return (
        <BoardView
          key={`${route.project}${serializeView(route.view)}`}
          site={site}
          project={route.project}
          view={route.view}
        />
      );
    case 'component':
      return (
        <div className="page-scroll">
          <ComponentPage site={site} componentKey={route.key} scope={scope} />
        </div>
      );
    case 'health':
      return (
        <div className="page-scroll">
          <HealthPage site={site} scope={scope} />
        </div>
      );
    case 'catalog':
      return (
        <div className="page-scroll">
          <CatalogPage site={site} route={route} scope={scope} />
        </div>
      );
    case 'diagrams':
      return (
        <div className="page-scroll">
          <DiagramsPage site={site} route={route} scope={scope} />
        </div>
      );
    default:
      return (
        <BoardView key={`workspace${serializeView(route.view)}`} site={site} view={route.view} />
      );
  }
}

/**
 * Linear-style sidebar: workspace, the project the pages are scoped to, search, sections,
 * projects. In a scope the sections link inside it and count what it shows.
 */
function Sidebar({ site, route }: { site: Site; route: Route }) {
  const project = routeScope(route);
  const scope = useMemo(() => (project ? projectScope(site, project) : undefined), [site, project]);
  const shown = useMemo(() => contents(site, scope), [site, scope]);
  const counts = useMemo(() => {
    const out = new Map<string, number>();
    for (const c of site.model.components)
      if (!c.ghost) out.set(c.project, (out.get(c.project) ?? 0) + 1);
    return out;
  }, [site]);
  const current = project ?? (route.name === 'component' ? route.key.split('/')[0] : undefined);
  const issues = shown.issues.length + shown.ghosts.length;
  const to = linksIn(project);
  // The way out and the other projects take the page as it is now: a search, a selection.
  const here = useHere();

  return (
    <aside className="sidebar">
      <a className="workspace" href={href.workspace()} aria-label="Furio: workspace map">
        <Mark />
        <span className="ws-text">
          <span className="ws-name">{site.model.workspace.id}</span>
          <span className="ws-sub">
            Furio · rev <span className="mono">{revision(site.model)}</span>
          </span>
        </span>
      </a>
      {scope && (
        <ScopePlate
          site={site}
          scope={scope}
          parts={shown.components.length}
          leave={pageIn(here)}
        />
      )}
      <Search site={site} {...(scope ? { within: scope.map } : {})} />
      <nav className="nav sections" aria-label="Sections">
        <a
          href={to.map()}
          aria-current={route.name === 'workspace' || route.name === 'project' ? 'page' : undefined}
        >
          <MapIcon size={16} strokeWidth={1.75} aria-hidden />
          Map
        </a>
        <a href={to.health()} aria-current={route.name === 'health' ? 'page' : undefined}>
          <Activity size={16} strokeWidth={1.75} aria-hidden />
          Health
          {issues > 0 && <span className="nav-count">{issues}</span>}
        </a>
        <a href={to.catalog()} aria-current={route.name === 'catalog' ? 'page' : undefined}>
          <Table2 size={16} strokeWidth={1.75} aria-hidden />
          Catalog
          <span className="nav-count">{shown.components.length}</span>
        </a>
        <a href={to.diagrams()} aria-current={route.name === 'diagrams' ? 'page' : undefined}>
          <Workflow size={16} strokeWidth={1.75} aria-hidden />
          Diagrams
          {shown.diagrams.length > 0 && <span className="nav-count">{shown.diagrams.length}</span>}
        </a>
      </nav>
      <HostNav site={site} />
      <div className="nav-section">Projects</div>
      <nav className="nav projects" aria-label="Projects">
        {site.model.projects.map((p) => {
          const count = counts.get(p.id) ?? 0;
          return (
            <a
              key={p.id}
              href={pageIn(here, p.id)}
              aria-current={current === p.id ? 'page' : undefined}
              className={p.ghost ? 'is-ghost' : ''}
            >
              <span
                className="dot"
                style={{ background: site.projectColor.get(p.id) }}
                aria-hidden
              />
              {p.id}
              <span className="nav-count">{p.ghost ? 'ghost' : count}</span>
            </a>
          );
        })}
      </nav>
      <div className="sidebar-foot">
        <a href="https://getfurio.com">getfurio.com</a>
        <AppearanceMenu />
      </div>
    </aside>
  );
}

/**
 * The project the pages are scoped to, labelled like its board on the map, and the way back to
 * the whole workspace (the same page, without the scope).
 */
function ScopePlate({
  site,
  scope,
  parts,
  leave,
}: {
  site: Site;
  scope: Scope;
  parts: number;
  leave: string;
}) {
  return (
    <div className="scope-plate" role="group" aria-label="Scope">
      <span
        className="dot"
        style={{ background: site.projectColor.get(scope.project) ?? 'var(--ghost)' }}
        aria-hidden
      />
      <span className="scope-name" title={scope.project}>
        {scope.project}
      </span>
      <span className="scope-count mono">{parts === 1 ? '1 part' : `${parts} parts`}</span>
      <a
        className="scope-leave"
        href={leave}
        aria-label="Show the whole workspace"
        title="Show the whole workspace"
      >
        <X size={14} aria-hidden />
      </a>
    </div>
  );
}

const NAV_ICON = { settings: Settings, home: LayoutGrid, external: ExternalLink } as const;

/** The host's own pages (the workspace settings on Furio Cloud), when an extension gives them. */
function HostNav({ site }: { site: Site }) {
  const [links, setLinks] = useState<NavLink[]>([]);
  useEffect(() => {
    let live = true;
    void extensionNav(site.model).then((l) => live && setLinks(l));
    return () => {
      live = false;
    };
  }, [site]);
  if (!links.length) return null;
  return (
    <nav className="nav host-nav" aria-label="Workspace">
      {links.map((link) => {
        const Icon = NAV_ICON[link.icon ?? 'external'] ?? ExternalLink;
        return (
          <a key={link.href} href={link.href}>
            <Icon size={16} strokeWidth={1.75} aria-hidden />
            {link.label}
          </a>
        );
      })}
    </nav>
  );
}

/**
 * Furio's mark: a disc cut by a relation that turns at a right angle and ends in a component.
 * The cut is a real hole (a mask), so the mark sits on any surface; its id is unique per mark.
 */
function Mark() {
  const cut = useId();
  return (
    <svg className="mark" width="28" height="28" viewBox="0 0 120 120" aria-hidden>
      <defs>
        <mask id={cut} maskUnits="userSpaceOnUse" x="0" y="0" width="120" height="120">
          <circle cx="60" cy="60" r="56" fill="#fff" />
          <path
            d="M-4 44H50A14 14 0 0 1 64 58V70"
            stroke="#000"
            strokeWidth="11"
            strokeLinecap="round"
            fill="none"
          />
          <circle cx="64" cy="82" r="13" fill="#000" />
          <circle cx="64" cy="82" r="5.5" fill="#fff" />
        </mask>
      </defs>
      <circle cx="60" cy="60" r="56" fill="currentColor" mask={`url(#${cut})`} />
    </svg>
  );
}

/** Theme (system, light, dark) and palette of the map and its diagrams, in a small popover. */
function AppearanceMenu() {
  const [appearance, set] = useAppearance();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => {
      if (
        e instanceof KeyboardEvent ? e.key === 'Escape' : !box.current?.contains(e.target as Node)
      )
        setOpen(false);
    };
    window.addEventListener('pointerdown', close);
    window.addEventListener('keydown', close);
    return () => {
      window.removeEventListener('pointerdown', close);
      window.removeEventListener('keydown', close);
    };
  }, [open]);
  const ModeIcon =
    appearance.mode === 'system' ? Monitor : appearance.theme === 'dark' ? Moon : Sun;
  return (
    <div className="appearance" ref={box}>
      <button
        className="theme-toggle"
        type="button"
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen(!open)}
      >
        <ModeIcon size={14} aria-hidden />
        Appearance
      </button>
      {open && (
        <div className="appearance-menu" role="dialog" aria-label="Appearance">
          <span className="appearance-label">Theme</span>
          <div className="segmented" role="radiogroup" aria-label="Theme">
            {(
              [
                ['system', 'System', Monitor],
                ['light', 'Light', Sun],
                ['dark', 'Dark', Moon],
              ] as const
            ).map(([mode, label, Icon]) => (
              <button
                key={mode}
                type="button"
                role="radio"
                aria-checked={appearance.mode === mode}
                onClick={() => set({ mode })}
              >
                <Icon size={13} aria-hidden /> {label}
              </button>
            ))}
          </div>
          <span className="appearance-label">Palette</span>
          <div className="palettes" role="radiogroup" aria-label="Palette">
            {PALETTES.map((palette) => (
              <button
                key={palette}
                type="button"
                role="radio"
                aria-checked={appearance.palette === palette}
                className={`palette-swatch palette-${palette}`}
                onClick={() => set({ palette })}
              >
                <span className="swatch" aria-hidden>
                  <i />
                  <i />
                  <i />
                </span>
                {PALETTE_LABEL[palette]}
              </button>
            ))}
          </div>
          <span className="appearance-note">
            Applies to the map and its diagrams, in this browser.
          </span>
        </div>
      )}
    </div>
  );
}
