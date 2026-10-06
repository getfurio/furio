import { STATUS_LABEL, type ModelComponent } from './model';
import { CATALOG_FILTERS, type CatalogFilter, type CatalogFilterKey } from './router';

const one = (value: string | undefined) => (value ? [value] : []);

/** The menus of the catalog: what each is called, and the values a component has for it. */
export const CATALOG_FACETS: Record<
  CatalogFilterKey,
  { label: string; values: (c: ModelComponent) => string[] }
> = {
  project: { label: 'Project', values: (c) => [c.project] },
  owner: { label: 'Owner', values: (c) => one(c.owner) },
  // As the Tech column reads: the technology, or the runtime when none is declared.
  tech: { label: 'Tech', values: (c) => one(c.tech ?? c.runtime) },
  host: { label: 'Host', values: (c) => one(c.host) },
  provider: { label: 'Provider', values: (c) => one(c.provider) },
  status: { label: 'Status', values: (c) => [c.status ?? 'active'] },
  tag: { label: 'Tag', values: (c) => c.tags },
};

export interface CatalogOption {
  value: string;
  label: string;
  /** How many of the rows have it. */
  count: number;
}

const valueLabel = (key: CatalogFilterKey, value: string) =>
  key !== 'status' ? value : value === 'active' ? 'Active' : (STATUS_LABEL[value] ?? value);

export function hasCatalogFilter(filter: CatalogFilter): boolean {
  return CATALOG_FILTERS.some((key) => filter[key]?.length);
}

/**
 * OR within a menu, AND across menus. `except` leaves one menu out: the rows its own values are
 * counted on, so ticking a value never empties the rest of its list.
 */
export function matchesCatalog(
  c: ModelComponent,
  filter: CatalogFilter,
  except?: CatalogFilterKey,
): boolean {
  return CATALOG_FILTERS.every((key) => {
    const wanted = filter[key];
    if (key === except || !wanted?.length) return true;
    return CATALOG_FACETS[key].values(c).some((value) => wanted.includes(value));
  });
}

/**
 * The values a menu offers among these rows, most common first. A ticked value that no row has
 * stays in the list, at zero, so it can be unticked.
 */
export function catalogOptions(
  rows: ModelComponent[],
  key: CatalogFilterKey,
  ticked: string[] = [],
): CatalogOption[] {
  const counts = new Map<string, number>(ticked.map((value) => [value, 0]));
  for (const c of rows)
    for (const value of new Set(CATALOG_FACETS[key].values(c)))
      counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts.entries()]
    .map(([value, count]) => ({ value, label: valueLabel(key, value), count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

/** Whether a menu can narrow these rows: they do not all share one and the same value. */
export function narrows(rows: ModelComponent[], key: CatalogFilterKey): boolean {
  const options = catalogOptions(rows, key);
  return options.length > 1 || (options.length === 1 && options[0]!.count < rows.length);
}
