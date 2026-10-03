import { ChevronUp, Filter as FilterIcon, History, X } from 'lucide-react';
import { useId, useMemo, useRef, useState } from 'react';
import { changeOptions } from '../extensions';
import { facet, STATUS_LABEL, TYPE_LABEL, type FacetKey, type Site } from '../model';
import { FILTERS, hasFilter, type Filter, type ViewState } from '../router';

const FACET_LABEL: Record<FacetKey, string> = {
  type: 'Type',
  tech: 'Tech',
  owner: 'Owner',
  host: 'Host',
  provider: 'Provider',
  status: 'Status',
};

const valueLabel = (key: FacetKey, value: string) =>
  key === 'type'
    ? (TYPE_LABEL[value] ?? value)
    : key === 'status'
      ? (STATUS_LABEL[value] ?? 'Active')
      : value;

interface Option {
  key: FacetKey;
  value: string;
  count: number;
}

/**
 * One field for every facet: type a team, a technology, a host... and pick from what the map
 * actually contains, with counts. Picked values become chips; matching cards are highlighted and
 * the rest dimmed, so the map keeps its shape. "Only these" hides the rest instead.
 */
export function FilterBox({
  site,
  view,
  matches,
  onChange,
  collapsible,
}: {
  site: Site;
  view: ViewState;
  /** How many declared components match the filter. */
  matches: number;
  onChange: (patch: Partial<ViewState>) => void;
  /** Phones: a single button until opened, so the toolbar does not cover the board. */
  collapsible: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [listOpen, setListOpen] = useState(false);
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const listId = useId();
  const periods = useMemo(() => changeOptions(), []);
  const facets = useMemo(
    () =>
      FILTERS.map((key) => ({ key, values: facet(site, key) })).filter(
        // A facet with a single value filters nothing.
        (f) => f.values.length > 1,
      ),
    [site],
  );
  const filter = view.filter;
  const chips = FILTERS.flatMap((key) => (filter[key] ?? []).map((value) => ({ key, value })));
  const active_ = hasFilter(filter);

  const options = useMemo<Option[]>(() => {
    const q = query.trim().toLowerCase();
    const picked = (key: FacetKey, value: string) => filter[key]?.includes(value) ?? false;
    const out: Option[] = [];
    for (const { key, values } of facets) {
      const fits = values.filter(
        ({ value }) =>
          !picked(key, value) &&
          (!q ||
            value.toLowerCase().includes(q) ||
            valueLabel(key, value).toLowerCase().includes(q) ||
            FACET_LABEL[key].toLowerCase().startsWith(q)),
      );
      out.push(...fits.slice(0, q ? 8 : 4).map(({ value, count }) => ({ key, value, count })));
    }
    return out.slice(0, 30);
  }, [facets, query, filter]);

  const setFilter = (next: Filter, only = view.only) =>
    onChange({
      filter: next,
      only: hasFilter(next) ? only : undefined,
      sel: undefined,
      mode: 'nets',
    });

  const add = (o: Option) => {
    setFilter({ ...filter, [o.key]: [...(filter[o.key] ?? []), o.value] });
    setQuery('');
    setActive(0);
    input.current?.focus();
  };

  const remove = (key: FacetKey, value: string) => {
    const left = (filter[key] ?? []).filter((v) => v !== value);
    const next = { ...filter };
    if (left.length) next[key] = left;
    else delete next[key];
    setFilter(next);
  };

  if (collapsible && !open) {
    const count = chips.length + (view.since ? 1 : 0);
    return (
      <button
        className="overlay filter-toggle"
        type="button"
        onClick={() => setOpen(true)}
        aria-expanded={false}
      >
        <FilterIcon size={14} aria-hidden />
        Filter
        {count > 0 && <span className="nav-count">{count}</span>}
      </button>
    );
  }

  const showList = listOpen && options.length > 0;
  // Options are grouped by facet in the list; the index runs across groups.
  let index = -1;

  return (
    <div className="overlay filter-bar" role="group" aria-label="Filter the map">
      <div className="filter-field">
        <FilterIcon size={14} aria-hidden />
        {chips.map(({ key, value }) => (
          <span className="chip" key={`${key}:${value}`}>
            <span className="chip-key">{FACET_LABEL[key]}</span>
            {valueLabel(key, value)}
            <button
              type="button"
              onClick={() => remove(key, value)}
              aria-label={`Remove ${FACET_LABEL[key]} ${value}`}
            >
              <X size={12} aria-hidden />
            </button>
          </span>
        ))}
        <input
          ref={input}
          type="text"
          role="combobox"
          aria-expanded={showList}
          aria-controls={listId}
          aria-label="Filter by type, tech, owner, host, provider or status"
          aria-activedescendant={showList ? `${listId}-${active}` : undefined}
          autoComplete="off"
          spellCheck={false}
          placeholder={chips.length ? 'Add…' : 'Filter: type, tech, owner, host…'}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
            setListOpen(true);
          }}
          onFocus={() => setListOpen(true)}
          onBlur={() => setTimeout(() => setListOpen(false), 120)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setActive((i) => Math.min(i + 1, options.length - 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setActive((i) => Math.max(i - 1, 0));
            } else if (e.key === 'Enter' && options[active]) {
              e.preventDefault();
              add(options[active]);
            } else if (e.key === 'Backspace' && !query && chips.length) {
              const last = chips.at(-1)!;
              remove(last.key, last.value);
            } else if (e.key === 'Escape') {
              setQuery('');
              input.current?.blur();
            }
          }}
        />
        {showList && (
          <ul className="filter-options" id={listId} role="listbox" aria-label="Filter values">
            {facets.map(({ key }) => {
              const group = options.filter((o) => o.key === key);
              if (!group.length) return null;
              return (
                <li key={key} role="presentation">
                  <span className="filter-group">{FACET_LABEL[key]}</span>
                  <ul role="presentation">
                    {group.map((o) => {
                      index++;
                      const i = index;
                      return (
                        <li
                          key={o.value}
                          id={`${listId}-${i}`}
                          role="option"
                          aria-selected={i === active}
                          onMouseEnter={() => setActive(i)}
                          onMouseDown={(e) => {
                            e.preventDefault();
                            add(o);
                          }}
                        >
                          <span>{valueLabel(o.key, o.value)}</span>
                          <span className="count">{o.count}</span>
                        </li>
                      );
                    })}
                  </ul>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {active_ && (
        <>
          <span className="filter-count" role="status">
            {matches} {matches === 1 ? 'part' : 'parts'}
          </span>
          <label className="filter-only" title="Hide the parts that do not match">
            <input
              type="checkbox"
              checked={!!view.only}
              onChange={(e) => setFilter(filter, e.target.checked || undefined)}
            />
            Only these
          </label>
          <button
            className="icon-button"
            type="button"
            onClick={() => setFilter({})}
            aria-label="Clear the filter"
            data-tip="Clear"
          >
            <X size={14} aria-hidden />
          </button>
        </>
      )}

      {periods.length > 0 && (
        <label className={`filter-changes ${view.since ? 'is-set' : ''}`}>
          <History size={13} aria-hidden />
          <span className="visually-hidden">Changes</span>
          <select
            value={view.since ?? ''}
            aria-label="Show what changed"
            onChange={(e) =>
              onChange({ since: e.target.value || undefined, sel: undefined, mode: 'nets' })
            }
          >
            <option value="">Changes: off</option>
            {periods.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
        </label>
      )}

      {collapsible && (
        <button
          className="icon-button"
          type="button"
          onClick={() => setOpen(false)}
          aria-label="Hide the filter bar"
          data-tip="Hide"
        >
          <ChevronUp size={16} aria-hidden />
        </button>
      )}
    </div>
  );
}
