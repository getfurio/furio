import type { Model, ModelComponent } from './model';

/**
 * The map's extension point: a host serving the map can add details it knows and the model does
 * not. A script loaded before the map (e.g. `<script src="./extensions.js"></script>` in
 * index.html) sets `window.furioExtensions`. Everything is optional; without it the map is
 * complete on its own. Extensions return data, never HTML: the map renders it in its own style.
 */
export interface FurioExtensions {
  /**
   * An icon for a component's card instead of the one of its type: an image URL, or the URL and
   * a colour (#rrggbb) to paint it with, e.g. the provider's brand colour.
   */
  iconFor?(component: ModelComponent): string | { src: string; color?: string } | null | undefined;
  /** Extra sections for the detail panel of a component. */
  panel?(
    component: ModelComponent,
    context: { model: Model },
  ): PanelSection[] | undefined | Promise<PanelSection[] | undefined>;
  /**
   * What changed on the map over a period chosen among `changeOptions`: the map marks those
   * cards and dims the rest.
   */
  changes?(context: {
    since: string;
    model: Model;
  }): ChangeMarks | null | undefined | Promise<ChangeMarks | null | undefined>;
  /** The periods offered for `changes`, e.g. { value: '7', label: 'Last 7 days' }. */
  changeOptions?: { value: string; label: string }[];
  /** Extra columns for the catalog table, with a value per component. */
  catalog?(context: { model: Model }): CatalogExtra | undefined | Promise<CatalogExtra | undefined>;
  /** Links to the host's own pages, shown in the sidebar (e.g. back to the workspace settings). */
  nav?(context: { model: Model }): NavLink[] | undefined | Promise<NavLink[] | undefined>;
  /** Extra sections at the top of the health page. */
  health?(context: {
    model: Model;
  }): PanelSection[] | undefined | Promise<PanelSection[] | undefined>;
}

export interface CatalogExtra {
  /** `types`: only on those tabs (e.g. ["domain"]); otherwise on every tab. */
  columns: { id: string; label: string; types?: string[] }[];
  /** Component key → column id → cell. */
  cells: Record<
    string,
    Record<
      string,
      { value: string; tone?: 'ok' | 'warning' | 'error'; href?: string; sort?: number }
    >
  >;
}

export interface NavLink {
  label: string;
  /** A path on this site ("/app") or an https URL. */
  href: string;
  icon?: 'settings' | 'home' | 'external';
}

export interface ChangeMarks {
  /** Shown on the map, e.g. "Last 7 days". */
  label: string;
  components: Record<string, 'added' | 'changed'>;
  /** Components that are gone: no card to mark, listed in the banner. */
  removed?: string[];
  relations?: { added: number; removed: number };
}

export interface PanelSection {
  title: string;
  items?: PanelItem[];
  /** A short line under the items, e.g. where the data comes from. */
  note?: string;
}

export interface PanelItem {
  label: string;
  value: string;
  /** http(s) or a map link (#/...). */
  href?: string;
  tone?: 'ok' | 'warning' | 'error';
  /** Smaller text under the value. */
  detail?: string;
}

declare global {
  interface Window {
    furioExtensions?: FurioExtensions;
  }
}

export function extensions(): FurioExtensions {
  return (typeof window !== 'undefined' && window.furioExtensions) || {};
}

/** An extension's icon, if its URL is safe to load (http(s), same-origin path or data image). */
export function extensionIcon(
  component: ModelComponent,
): { src: string; color?: string } | undefined {
  try {
    const icon = extensions().iconFor?.(component);
    const src = typeof icon === 'string' ? icon : icon?.src;
    if (typeof src !== 'string' || !src) return undefined;
    if (!/^(https?:|data:image\/|\.?\/|[a-z0-9_-]+\/)/i.test(src) || /^javascript:/i.test(src))
      return undefined;
    const color = typeof icon === 'object' ? icon?.color : undefined;
    return {
      src,
      ...(typeof color === 'string' && /^#[0-9a-f]{6}$/i.test(color) ? { color } : {}),
    };
  } catch {
    return undefined;
  }
}

/** Extension sections for a component; a failing extension adds nothing. */
export async function extensionSections(
  component: ModelComponent,
  model: Model,
): Promise<PanelSection[]> {
  try {
    const sections = await extensions().panel?.(component, { model });
    return Array.isArray(sections) ? sections.filter((s) => s && typeof s.title === 'string') : [];
  } catch {
    return [];
  }
}

/** Extension sections for the health page; a failing extension adds nothing. */
export async function extensionHealth(model: Model): Promise<PanelSection[]> {
  try {
    const sections = await extensions().health?.({ model });
    return Array.isArray(sections) ? sections.filter((s) => s && typeof s.title === 'string') : [];
  } catch {
    return [];
  }
}

/** The periods the extension offers for the Changes view, or none. */
export function changeOptions(): { value: string; label: string }[] {
  const ext = extensions();
  if (typeof ext.changes !== 'function' || !Array.isArray(ext.changeOptions)) return [];
  return ext.changeOptions.filter(
    (o) => o && typeof o.value === 'string' && typeof o.label === 'string',
  );
}

/** Marks for the Changes view; nothing when there is no extension or it fails. */
export async function changeMarks(since: string, model: Model): Promise<ChangeMarks | undefined> {
  try {
    const marks = await extensions().changes?.({ since, model });
    return marks && typeof marks.label === 'string' && marks.components ? marks : undefined;
  } catch {
    return undefined;
  }
}

/** Extra catalog columns; nothing when there is no extension or it fails. */
export async function extensionCatalog(model: Model): Promise<CatalogExtra | undefined> {
  try {
    const extra = await extensions().catalog?.({ model });
    return extra && Array.isArray(extra.columns) && extra.cells && typeof extra.cells === 'object'
      ? extra
      : undefined;
  } catch {
    return undefined;
  }
}

/** The host's sidebar links; only same-site paths and https URLs. */
export async function extensionNav(model: Model): Promise<NavLink[]> {
  try {
    const links = await extensions().nav?.({ model });
    return Array.isArray(links)
      ? links.filter(
          (l) =>
            l &&
            typeof l.label === 'string' &&
            typeof l.href === 'string' &&
            /^(\/(?!\/)|https:\/\/)/.test(l.href),
        )
      : [];
  } catch {
    return [];
  }
}

/** Only links the map can follow safely. */
export function safeHref(href: string | undefined): string | undefined {
  return href && /^(https?:\/\/|#\/)/i.test(href) ? href : undefined;
}
