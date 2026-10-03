import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { Site } from '../model';
import { go, href } from '../router';
import { DetailPanel } from './DetailPanel';

const PeekContext = createContext<(key: string) => void>((key) => go(href.component(key)));

/**
 * A quick look at a component from any page, in the same panel as the map, without leaving the
 * page: links to components open it, and its relations move it along. Esc, the close button or
 * a click elsewhere closes it; ⌘/Ctrl-click still opens the full page.
 */
export function PeekProvider({ site, children }: { site: Site; children: ReactNode }) {
  const [key, setKey] = useState<string | null>(null);
  const panel = useRef<HTMLDivElement>(null);
  const component = key ? site.byKey.get(key) : undefined;

  useEffect(() => {
    if (!key) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setKey(null);
    const onDown = (e: PointerEvent) => {
      const target = e.target as Element;
      if (!panel.current?.contains(target) && !target.closest?.('[data-peek]')) setKey(null);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', onDown);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerdown', onDown);
    };
  }, [key]);

  // A navigation closes it.
  useEffect(() => {
    const close = () => setKey(null);
    window.addEventListener('hashchange', close);
    return () => window.removeEventListener('hashchange', close);
  }, []);

  return (
    <PeekContext.Provider value={setKey}>
      {children}
      {component && (
        <div className="peek" ref={panel}>
          <DetailPanel
            site={site}
            component={component}
            onSelect={setKey}
            onClose={() => setKey(null)}
          />
        </div>
      )}
    </PeekContext.Provider>
  );
}

/** A link to a component: a quick look in the panel, or its page with ⌘/Ctrl or a middle click. */
export function PeekLink({
  componentKey,
  className,
  children,
}: {
  componentKey: string;
  className?: string;
  children: ReactNode;
}) {
  const peek = useContext(PeekContext);
  return (
    <a
      className={className}
      href={href.component(componentKey)}
      data-peek
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
        e.preventDefault();
        peek(componentKey);
      }}
    >
      {children}
    </a>
  );
}
