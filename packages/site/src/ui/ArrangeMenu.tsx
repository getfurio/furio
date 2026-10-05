import { ArrowDown, ArrowRight, LayoutDashboard, Orbit, Rows3, Workflow } from 'lucide-react';
import { useEffect, useRef } from 'react';
import type { Arrangement, Flow, Grouping, ViewState } from '../router';

const ARRANGEMENT = [
  ['flow', 'Flow', Workflow],
  ['tiers', 'Tiers', Rows3],
  ['around', 'Around', Orbit],
] as const;

const DIRECTION = [
  [undefined, 'Auto', null],
  ['right', 'Right', ArrowRight],
  ['down', 'Down', ArrowDown],
] as const;

const GROUPING: [Grouping, string][] = [
  ['project', 'Project'],
  ['owner', 'Owner'],
  ['host', 'Host'],
  ['type', 'Type'],
];

/**
 * How the map is arranged: the flow of what depends on what, with boards that gather projects,
 * owners, hosts or types; bands by kind; or one component with the rest in rings around it. The
 * choice lives in the link, like the selection and the filter.
 */
export function ArrangeMenu({
  view,
  around,
  open,
  onOpen,
  onChange,
}: {
  view: ViewState;
  /**
   * Arranged around a component: which one, how many parts of the view are left out, and whether
   * its two sides are above and below it (narrow screens).
   */
  around?: { centre: string; hidden: number; upright: boolean } | undefined;
  open: boolean;
  onOpen: (open: boolean) => void;
  onChange: (patch: Partial<ViewState>) => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) onOpen(false);
    };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [open]);

  const arrange: Arrangement = view.arrange ?? 'flow';
  const set = (next: Arrangement) =>
    onChange(
      next === 'flow'
        ? { arrange: undefined, around: undefined }
        : next === 'tiers'
          ? { arrange: 'tiers', group: undefined, around: undefined }
          : { arrange: 'around', dir: undefined, group: undefined, around: view.sel },
    );

  return (
    <div
      className="arrange"
      ref={root}
      onKeyDown={(event) => {
        if (event.key !== 'Escape' || !open) return;
        // Escape closes the menu, not the selection behind it.
        event.stopPropagation();
        onOpen(false);
      }}
    >
      <button
        className="overlay arrange-toggle"
        type="button"
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label="Arrange the map"
        data-tip={open ? undefined : 'Arrange'}
        onClick={() => onOpen(!open)}
      >
        <LayoutDashboard size={15} aria-hidden />
      </button>
      {open && (
        <div className="overlay arrange-menu" role="dialog" aria-label="Arrange the map">
          <div className="segmented" role="radiogroup" aria-label="Arrangement">
            {ARRANGEMENT.map(([id, label, Icon]) => (
              <button
                key={id}
                type="button"
                role="radio"
                aria-checked={arrange === id}
                onClick={() => set(id)}
              >
                <Icon size={13} aria-hidden /> {label}
              </button>
            ))}
          </div>
          <p className="arrange-hint">
            {arrange === 'flow' && 'Layers follow the relations: a part sits before what it uses.'}
            {arrange === 'tiers' &&
              'Bands by kind: entry points, services, messaging, data, external.'}
            {arrange === 'around' && (
              <>
                {around ? <span className="mono">{around.centre}</span> : 'One part'} at the centre:{' '}
                {around?.upright
                  ? 'what uses it above, what it uses below.'
                  : 'what uses it on the left, what it uses on the right.'}{' '}
                Select a card to move the centre.
                {around && around.hidden > 0 && (
                  <>
                    {' '}
                    {around.hidden === 1
                      ? '1 part is not connected to it and is not shown.'
                      : `${around.hidden} parts are not connected to it and are not shown.`}
                  </>
                )}
              </>
            )}
          </p>
          {arrange !== 'around' && (
            <>
              <span className="arrange-label" id="arrange-direction">
                Direction
              </span>
              <div className="segmented" role="radiogroup" aria-labelledby="arrange-direction">
                {DIRECTION.map(([id, label, Icon]) => (
                  <button
                    key={label}
                    type="button"
                    role="radio"
                    aria-checked={view.dir === id}
                    title={id ? undefined : 'Whichever fits the window best'}
                    onClick={() => onChange({ dir: id as Flow | undefined })}
                  >
                    {Icon && <Icon size={13} aria-hidden />} {label}
                  </button>
                ))}
              </div>
            </>
          )}
          {arrange === 'flow' && (
            <>
              <span className="arrange-label" id="arrange-group">
                Group by
              </span>
              <div className="segmented" role="radiogroup" aria-labelledby="arrange-group">
                {GROUPING.map(([id, label]) => (
                  <button
                    key={id}
                    type="button"
                    role="radio"
                    aria-checked={(view.group ?? 'project') === id}
                    onClick={() => onChange({ group: id === 'project' ? undefined : id })}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
