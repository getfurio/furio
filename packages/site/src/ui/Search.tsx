import { Search as SearchIcon } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { TypeIcon } from '../graph/parts';
import { search, type Site } from '../model';
import { go, href, selectOnMap } from '../router';

export function Search({ site }: { site: Site }) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const listId = useId();
  const hits = useMemo(() => search(site, query), [site, query]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      const typing = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement;
      if (event.key === '/' && !typing) {
        event.preventDefault();
        input.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => setActive(0), [query]);

  /** Selects the part on the map (its panel opens); with ⌘/Ctrl, opens its page. */
  const choose = (key: string, page = false) => {
    if (page) go(href.component(key));
    else selectOnMap(key);
    setQuery('');
    setOpen(false);
    input.current?.blur();
  };

  const showList = open && query.trim().length > 0;

  return (
    <div className="search">
      <label className="search-field">
        <SearchIcon size={16} aria-hidden />
        <span className="visually-hidden">Search components</span>
        <input
          ref={input}
          type="search"
          role="combobox"
          aria-expanded={showList}
          aria-controls={listId}
          aria-activedescendant={showList && hits[active] ? `${listId}-${active}` : undefined}
          autoComplete="off"
          spellCheck={false}
          placeholder="Search…"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 120)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setActive((i) => Math.min(i + 1, hits.length - 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setActive((i) => Math.max(i - 1, 0));
            } else if (e.key === 'Enter' && hits[active]) {
              e.preventDefault();
              choose(hits[active].component.key, e.metaKey || e.ctrlKey);
            } else if (e.key === 'Escape') {
              setQuery('');
              input.current?.blur();
            }
          }}
        />
        <kbd aria-hidden>/</kbd>
      </label>
      {showList && (
        <ul className="search-results" id={listId} role="listbox" aria-label="Matching components">
          {hits.length === 0 && (
            <li className="empty" role="option" aria-selected="false" aria-disabled="true">
              No part matches “{query.trim()}”.
            </li>
          )}
          {hits.map(({ component }, i) => (
            <li
              key={component.key}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              onMouseEnter={() => setActive(i)}
              onMouseDown={(e) => {
                e.preventDefault();
                choose(component.key, e.metaKey || e.ctrlKey);
              }}
            >
              <span className="ref" data-type={component.ghost ? undefined : component.type}>
                <TypeIcon type={component.ghost ? undefined : component.type} />
              </span>
              <span className="name">{component.name ?? component.id}</span>
              <span className="key">{component.key}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
