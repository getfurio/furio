import { ArrowDown, ArrowUp, Download, Search as SearchIcon } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import {
  CATALOG_FACETS,
  catalogOptions,
  hasCatalogFilter,
  matchesCatalog,
  narrows,
} from '../catalog';
import { extensionCatalog, safeHref, type CatalogExtra } from '../extensions';
import { ComponentIcon } from '../graph/parts';
import {
  codeUrl,
  displayName,
  STATUS_LABEL,
  TYPE_LABEL,
  TYPE_PLURAL,
  type ModelComponent,
  type Site,
} from '../model';
import {
  CATALOG_FILTERS,
  href,
  inScope,
  replaceHash,
  type CatalogFilter,
  type Route,
} from '../router';
import { contents, type Scope } from '../scope';
import { FacetMenu } from '../ui/FacetMenu';
import { PeekLink } from '../ui/Peek';

interface Column {
  id: string;
  label: string;
  value: (c: ModelComponent) => string;
  /** Rendered cell; the text value when absent. */
  cell?: (c: ModelComponent) => React.ReactNode;
  sort?: (c: ModelComponent) => string | number;
  /** Shown only on these tabs. */
  types?: string[];
}

/**
 * One CSV cell. Manifests come from any repo: a value a spreadsheet would read as a formula gets
 * a leading quote, so opening the file never runs anything.
 */
export function csvCell(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return `"${safe.replace(/"/g, '""')}"`;
}

/**
 * Every declared component in a table: a tab per type the workspace has, a search over every
 * field, a menu per field to filter on its values, sortable columns, and the columns a host adds
 * (e.g. domain expiries on Furio Cloud). In a project's scope, the project's components only.
 */
export function CatalogPage({
  site,
  route,
  scope,
}: {
  site: Site;
  route: Extract<Route, { name: 'catalog' }>;
  scope?: Scope | undefined;
}) {
  const [query, setQuery] = useState(route.q ?? '');
  const [picked, setPicked] = useState<CatalogFilter>(route.filter ?? {});
  // A link followed while the page is open (a tab, a shared address) brings its own search and
  // filters; what is typed and ticked here only rewrites the address, and leaves the route as it is.
  const [followed, setFollowed] = useState(route);
  if (followed !== route) {
    setFollowed(route);
    setQuery(route.q ?? '');
    setPicked(route.filter ?? {});
  }
  const [sort, setSort] = useState<{ id: string; desc: boolean }>({ id: 'name', desc: false });
  const [extra, setExtra] = useState<CatalogExtra | undefined>();
  const type = route.type;

  useEffect(() => {
    let live = true;
    void extensionCatalog(site.model, scope?.project).then((e) => live && setExtra(e));
    return () => {
      live = false;
    };
  }, [site, scope]);

  // In a scope every row is the project's: its menu is not offered, and what it held does not apply.
  const filter = useMemo<CatalogFilter>(() => {
    const { project, ...rest } = picked;
    return scope || !project ? rest : picked;
  }, [picked, scope]);
  const filtered = hasCatalogFilter(filter);

  // The search and the filters live in the URL, so a filtered table can be shared.
  useEffect(() => {
    replaceHash(href.catalog(type, query.trim() || undefined, filter));
  }, [type, query, filter]);

  const declared = useMemo(() => contents(site, scope).components, [site, scope]);

  const columns = useMemo<Column[]>(() => {
    const relations = (c: ModelComponent) =>
      (site.incoming.get(c.key)?.length ?? 0) + (site.outgoing.get(c.key)?.length ?? 0);
    const base: Column[] = [
      {
        id: 'name',
        label: 'Component',
        value: (c) => `${displayName(c)} ${c.key}`,
        sort: (c) => displayName(c).toLowerCase(),
        cell: (c) => (
          <span className="cat-name">
            <span className="cat-icon" data-type={c.type} aria-hidden>
              <ComponentIcon component={c} size={14} />
            </span>
            <span>
              <PeekLink componentKey={c.key}>{displayName(c)}</PeekLink>
              <span className="cat-key mono">{c.key}</span>
            </span>
          </span>
        ),
      },
      { id: 'type', label: 'Type', value: (c) => TYPE_LABEL[c.type ?? ''] ?? c.type ?? '' },
      { id: 'tech', label: 'Tech', value: (c) => c.tech ?? c.runtime ?? '' },
      { id: 'owner', label: 'Owner', value: (c) => c.owner ?? '' },
      { id: 'host', label: 'Host', value: (c) => c.host ?? '' },
      { id: 'provider', label: 'Provider', value: (c) => c.provider ?? '' },
      {
        id: 'repo',
        label: 'Repo',
        value: (c) => `${c.repo ?? ''} ${c.path ?? ''}`,
        cell: (c) => {
          const code = codeUrl(site, c);
          return (
            <span className="mono cat-repo">
              {c.repo}
              {c.path &&
                (code ? (
                  <a href={code} rel="noreferrer" target="_blank">
                    {c.path}
                  </a>
                ) : (
                  <span>{c.path}</span>
                ))}
            </span>
          );
        },
      },
      {
        id: 'relations',
        label: 'Relations',
        value: (c) => String(relations(c)),
        sort: relations,
      },
      {
        id: 'status',
        label: 'Status',
        value: (c) => (c.status ? STATUS_LABEL[c.status]! : ''),
      },
    ];
    for (const col of extra?.columns ?? []) {
      const cell = (c: ModelComponent) => extra?.cells[c.key]?.[col.id];
      base.push({
        id: `x:${col.id}`,
        label: col.label,
        ...(col.types ? { types: col.types } : {}),
        value: (c) => cell(c)?.value ?? '',
        sort: (c) => cell(c)?.sort ?? cell(c)?.value ?? '',
        cell: (c) => {
          const x = cell(c);
          if (!x) return null;
          const safe = safeHref(x.href);
          const link = safe && inScope(safe);
          const text = <span className={x.tone ? `tone-${x.tone}` : ''}>{x.value}</span>;
          return link ? (
            <a
              href={link}
              {...(link.startsWith('http') ? { rel: 'noreferrer', target: '_blank' } : {})}
            >
              {text}
            </a>
          ) : (
            text
          );
        },
      });
    }
    return base;
  }, [site, extra]);

  /** What the search finds, on every tab and before the menus. */
  const searched = useMemo(() => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return declared;
    const fields = (c: ModelComponent) =>
      [c.key, c.name, c.description, c.tags.join(' '), ...columns.map((col) => col.value(c))]
        .join(' ')
        .toLowerCase();
    return declared.filter((c) => {
      const text = fields(c);
      return words.every((w) => text.includes(w));
    });
  }, [declared, query, columns]);

  /** The tabs of the workspace, each with how many of its components the search and the menus keep. */
  const { tabs, matching } = useMemo(() => {
    const matching = searched.filter((c) => matchesCatalog(c, filter));
    const counts = new Map<string, number>();
    for (const c of matching) counts.set(c.type ?? '', (counts.get(c.type ?? '') ?? 0) + 1);
    const present = new Set<string>(declared.map((c) => c.type ?? ''));
    const tabs = Object.keys(TYPE_PLURAL)
      .filter((t) => present.has(t))
      .map((t) => ({ type: t, count: counts.get(t) ?? 0 }));
    return { tabs, matching };
  }, [declared, searched, filter]);

  /** A menu per field that can narrow the tab, its values counted with every other filter applied. */
  const menus = useMemo(() => {
    const inTab = (list: ModelComponent[]) => list.filter((c) => !type || c.type === type);
    const tab = inTab(declared);
    const found = inTab(searched);
    return CATALOG_FILTERS.filter(
      (key) => !(key === 'project' && scope) && (filter[key]?.length || narrows(tab, key)),
    ).map((key) => ({
      key,
      options: catalogOptions(
        found.filter((c) => matchesCatalog(c, filter, key)),
        key,
        filter[key],
      ).map((o) => (key === 'project' ? { ...o, dot: site.projectColor.get(o.value) } : o)),
    }));
  }, [site, scope, declared, searched, filter, type]);

  const rows = useMemo(() => {
    const col = columns.find((c) => c.id === sort.id) ?? columns[0]!;
    const key = col.sort ?? col.value;
    return matching
      .filter((c) => !type || c.type === type)
      .sort((a, b) => {
        const x = key(a);
        const y = key(b);
        const order =
          typeof x === 'number' && typeof y === 'number'
            ? x - y
            : String(x).localeCompare(String(y), undefined, { numeric: true });
        return (sort.desc ? -order : order) || a.key.localeCompare(b.key);
      });
  }, [matching, type, columns, sort]);

  const visible = columns.filter(
    (col) =>
      (!col.types || (type && col.types.includes(type))) &&
      // A column empty on every row of the tab says nothing.
      (col.id === 'name' || rows.some((r) => col.value(r))),
  );

  const csv = () => {
    const quote = csvCell;
    const lines = [
      ['key', ...visible.map((c) => c.label)].map(quote).join(','),
      ...rows.map((r) =>
        [r.key, ...visible.map((c) => (c.id === 'name' ? displayName(r) : c.value(r)))]
          .map(quote)
          .join(','),
      ),
    ];
    const url = URL.createObjectURL(new Blob([lines.join('\n') + '\n'], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `furio-${[site.model.workspace.id, scope?.project, type ?? 'all'].filter(Boolean).join('-')}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <div className="sheet sheet-wide">
      <header className="title-band" style={{ gridTemplateColumns: '1fr auto' }}>
        <h1 style={{ fontFamily: 'var(--sans)' }}>Catalog</h1>
        <button className="button quiet" type="button" onClick={csv}>
          <Download size={14} aria-hidden /> CSV
        </button>
        <span className="tb-sub">
          {scope ? (
            <>
              {declared.length} {declared.length === 1 ? 'component' : 'components'} in{' '}
              <strong>{scope.project}</strong>.
            </>
          ) : (
            <>
              {declared.length} components in {site.model.projects.filter((p) => !p.ghost).length}{' '}
              projects.
            </>
          )}{' '}
          Click a name for a quick look.
        </span>
      </header>

      <nav className="cat-tabs" aria-label="Component types">
        <a
          href={href.catalog(undefined, query || undefined, filter)}
          aria-current={!type ? 'page' : undefined}
        >
          All <span className="count">{matching.length}</span>
        </a>
        {tabs.map((t) => (
          <a
            key={t.type}
            href={href.catalog(t.type, query || undefined, filter)}
            aria-current={type === t.type ? 'page' : undefined}
            className={t.count ? undefined : 'is-empty'}
          >
            {TYPE_PLURAL[t.type]} <span className="count">{t.count}</span>
          </a>
        ))}
      </nav>

      <div className="cat-tools">
        <label className="search-field cat-search">
          <SearchIcon size={16} aria-hidden />
          <span className="visually-hidden">Search the catalog</span>
          <input
            type="search"
            value={query}
            placeholder="Search name, repo, description, any field…"
            onChange={(e) => setQuery(e.target.value)}
          />
          <span className="cat-found" role="status">
            {rows.length} {rows.length === 1 ? 'row' : 'rows'}
          </span>
        </label>
        {menus.length > 0 && (
          <div className="facets" role="group" aria-label="Filter the catalog">
            {menus.map(({ key, options }) => (
              <FacetMenu
                key={key}
                label={CATALOG_FACETS[key].label}
                options={options}
                selected={filter[key] ?? []}
                onChange={(values) => setPicked({ ...filter, [key]: values })}
              />
            ))}
            {filtered && (
              <button type="button" className="link facets-clear" onClick={() => setPicked({})}>
                Clear filters
              </button>
            )}
          </div>
        )}
      </div>

      <div className="table-wrap">
        <table className="table cat-table">
          <thead>
            <tr>
              {visible.map((col) => (
                <th
                  key={col.id}
                  scope="col"
                  aria-sort={sort.id === col.id ? (sort.desc ? 'descending' : 'ascending') : 'none'}
                >
                  <button
                    type="button"
                    className="th-sort"
                    onClick={() =>
                      setSort((s) => ({ id: col.id, desc: s.id === col.id ? !s.desc : false }))
                    }
                  >
                    {col.label}
                    {sort.id === col.id &&
                      (sort.desc ? (
                        <ArrowDown size={12} aria-hidden />
                      ) : (
                        <ArrowUp size={12} aria-hidden />
                      ))}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key}>
                {visible.map((col) => (
                  <td key={col.id} className={col.id === 'relations' ? 'num mono' : ''}>
                    {col.cell ? col.cell(r) : col.value(r)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && (
          <p className="empty-state">
            {!filtered
              ? `Nothing matches “${query}”.`
              : query.trim()
                ? `Nothing matches “${query}” with these filters.`
                : 'No component matches these filters.'}
            {filtered && (
              <>
                {' '}
                <button type="button" className="link" onClick={() => setPicked({})}>
                  Clear filters
                </button>
              </>
            )}
          </p>
        )}
      </div>
    </div>
  );
}
