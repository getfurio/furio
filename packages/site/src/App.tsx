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
} from 'lucide-react';
import { extensionNav, type NavLink } from './extensions';
import { PALETTE_LABEL, PALETTES, useAppearance } from './theme';
import { useEffect, useMemo, useRef, useState } from 'react';
import { BoardView } from './graph/BoardView';
import { indexModel, loadModel, revision, type Site } from './model';
import { href, serializeView, useRoute, type Route } from './router';
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
    const where =
      route.name === 'component'
        ? route.key
        : route.name === 'project'
          ? route.project
          : route.name === 'health'
            ? 'Health'
            : route.name === 'diagrams'
              ? 'Diagrams'
              : route.name === 'catalog'
                ? 'Catalog'
                : '';
    document.title = `${where ? `${where} · ` : ''}${site.model.workspace.id} · Furio map`;
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
          <ComponentPage site={site} componentKey={route.key} />
        </div>
      );
    case 'health':
      return (
        <div className="page-scroll">
          <HealthPage site={site} />
        </div>
      );
    case 'catalog':
      return (
        <div className="page-scroll">
          <CatalogPage site={site} route={route} />
        </div>
      );
    case 'diagrams':
      return (
        <div className="page-scroll">
          <DiagramsPage site={site} {...(route.diagram ? { selected: route.diagram } : {})} />
        </div>
      );
    default:
      return (
        <BoardView key={`workspace${serializeView(route.view)}`} site={site} view={route.view} />
      );
  }
}

/** Linear-style sidebar: workspace, search, sections, projects. */
function Sidebar({ site, route }: { site: Site; route: Route }) {
  const counts = useMemo(() => {
    const out = new Map<string, number>();
    for (const c of site.model.components)
      if (!c.ghost) out.set(c.project, (out.get(c.project) ?? 0) + 1);
    return out;
  }, [site]);
  const current =
    route.name === 'project'
      ? route.project
      : route.name === 'component'
        ? route.key.split('/')[0]
        : undefined;
  const issues = site.model.issues.length + site.model.components.filter((c) => c.ghost).length;

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
      <Search site={site} />
      <nav className="nav" aria-label="Sections">
        <a href={href.workspace()} aria-current={route.name === 'workspace' ? 'page' : undefined}>
          <MapIcon size={16} strokeWidth={1.75} aria-hidden />
          Map
        </a>
        <a href={href.health()} aria-current={route.name === 'health' ? 'page' : undefined}>
          <Activity size={16} strokeWidth={1.75} aria-hidden />
          Health
          {issues > 0 && <span className="nav-count">{issues}</span>}
        </a>
        <a href={href.catalog()} aria-current={route.name === 'catalog' ? 'page' : undefined}>
          <Table2 size={16} strokeWidth={1.75} aria-hidden />
          Catalog
          <span className="nav-count">{site.model.components.filter((c) => !c.ghost).length}</span>
        </a>
        <a href={href.diagrams()} aria-current={route.name === 'diagrams' ? 'page' : undefined}>
          <Workflow size={16} strokeWidth={1.75} aria-hidden />
          Diagrams
          {site.model.diagrams.length > 0 && (
            <span className="nav-count">{site.model.diagrams.length}</span>
          )}
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
              href={href.project(p.id)}
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

function Mark() {
  return (
    <svg className="mark" width="28" height="28" viewBox="0 0 28 28" aria-hidden>
      <rect width="28" height="28" rx="8" fill="#7170ff" />
      <path
        d="M9 9.5h4.5M9 18.5h4.5M13.5 9.5v9M13.5 14h5.5"
        stroke="#fff"
        strokeWidth="2"
        strokeLinecap="round"
        fill="none"
      />
      <circle cx="9" cy="9.5" r="2" fill="#fff" />
      <circle cx="9" cy="18.5" r="2" fill="#fff" />
      <circle cx="19.5" cy="14" r="2" fill="#fff" />
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
