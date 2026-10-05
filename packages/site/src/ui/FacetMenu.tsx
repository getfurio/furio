import { Check, ChevronDown } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState } from 'react';

export interface FacetOption {
  value: string;
  label: string;
  /** How many rows have it, with every other filter applied. */
  count: number;
  /** The colour that goes with the value elsewhere on the map (a project's dot). */
  dot?: string | undefined;
}

/** From this many values on, the menu opens with a field to find one. */
const FIND_FROM = 9;
/** The width of the menu, to tell whether it fits to the right of its button. */
const WIDTH = 260;

/**
 * One filter as a menu: a button named after the field opens its values, each with how many rows
 * have it. Several can be ticked (a row with any of them matches); the button then says which.
 */
export function FacetMenu({
  label,
  options,
  selected,
  onChange,
}: {
  label: string;
  options: FacetOption[];
  selected: string[];
  onChange: (next: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [alignEnd, setAlignEnd] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const find = useRef<HTMLInputElement>(null);
  const id = useId();
  const findable = options.length >= FIND_FROM;

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? options.filter((o) => o.label.toLowerCase().includes(q)) : options;
  }, [options, query]);

  const close = (refocus = false) => {
    setOpen(false);
    if (refocus) button.current?.focus();
  };

  useEffect(() => {
    if (!open) return;
    (findable ? find.current : list.current)?.focus();
    const outside = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('pointerdown', outside);
    return () => window.removeEventListener('pointerdown', outside);
  }, [open, findable]);

  useEffect(() => {
    if (open) document.getElementById(`${id}-${active}`)?.scrollIntoView({ block: 'nearest' });
  }, [open, active, id]);

  const toggle = (value: string) =>
    onChange(selected.includes(value) ? selected.filter((v) => v !== value) : [...selected, value]);

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      // Its own Escape: the quick look and the page keep theirs.
      e.stopPropagation();
      close(true);
    }
    // The Clear button under the list answers to its own keys.
    if (e.target !== list.current && e.target !== find.current) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, shown.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Home') {
      e.preventDefault();
      setActive(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      setActive(shown.length - 1);
    } else if (e.key === 'Enter' || (e.key === ' ' && e.target !== find.current)) {
      e.preventDefault();
      const option = shown[active];
      if (option) toggle(option.value);
    }
  };

  const picked = options.filter((o) => selected.includes(o.value));
  const summary = picked[0]?.label ?? selected[0];

  return (
    <div
      className="facet"
      ref={box}
      onBlur={(e) => {
        if (open && !box.current?.contains(e.relatedTarget)) setOpen(false);
      }}
    >
      <button
        ref={button}
        type="button"
        className={`facet-button ${selected.length ? 'is-set' : ''}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => {
          if (!open) {
            const left = button.current?.getBoundingClientRect().left ?? 0;
            setAlignEnd(left + WIDTH > window.innerWidth - 16);
            setQuery('');
            setActive(
              Math.max(
                0,
                options.findIndex((o) => selected.includes(o.value)),
              ),
            );
          }
          setOpen(!open);
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' && !open) {
            e.preventDefault();
            e.currentTarget.click();
          }
        }}
      >
        <span className="facet-name">{label}</span>
        {summary !== undefined && (
          <span className="facet-value">
            {summary}
            {selected.length > 1 && ` +${selected.length - 1}`}
          </span>
        )}
        <ChevronDown size={14} aria-hidden />
      </button>
      {open && (
        <div className={`facet-menu ${alignEnd ? 'is-end' : ''}`} onKeyDown={onKey}>
          {findable && (
            <input
              ref={find}
              className="facet-find"
              type="text"
              role="combobox"
              aria-expanded
              aria-controls={id}
              aria-activedescendant={shown[active] ? `${id}-${active}` : undefined}
              aria-label={`Find a value of ${label}`}
              autoComplete="off"
              spellCheck={false}
              placeholder="Find…"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setActive(0);
              }}
            />
          )}
          <ul
            ref={list}
            id={id}
            role="listbox"
            aria-multiselectable
            aria-label={label}
            aria-activedescendant={!findable && shown[active] ? `${id}-${active}` : undefined}
            tabIndex={findable ? undefined : -1}
          >
            {shown.map((o, i) => {
              const ticked = selected.includes(o.value);
              return (
                <li
                  key={o.value}
                  id={`${id}-${i}`}
                  role="option"
                  aria-selected={ticked}
                  className={i === active ? 'is-active' : ''}
                  onMouseEnter={() => setActive(i)}
                  // The focus stays where it is: a click on a value does not close the menu.
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => toggle(o.value)}
                >
                  <span className="facet-tick" aria-hidden>
                    {ticked && <Check size={12} strokeWidth={2.5} />}
                  </span>
                  {o.dot && <span className="dot" style={{ background: o.dot }} aria-hidden />}
                  <span className="facet-label">{o.label}</span>
                  <span className="count">{o.count}</span>
                </li>
              );
            })}
            {shown.length === 0 && (
              <li className="facet-none" role="presentation">
                {options.length
                  ? `No value matches “${query.trim()}”.`
                  : 'No values among these rows.'}
              </li>
            )}
          </ul>
          {selected.length > 0 && (
            <button
              type="button"
              className="facet-clear"
              onClick={() => {
                onChange([]);
                close(true);
              }}
            >
              Clear
            </button>
          )}
        </div>
      )}
    </div>
  );
}
