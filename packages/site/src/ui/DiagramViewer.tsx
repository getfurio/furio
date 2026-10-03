import { Maximize, Minus, Plus, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

/**
 * A diagram at full screen: zoom with the buttons, the wheel or a pinch, drag to move, Esc or
 * the close button to leave. It shows the SVG already rendered (and sanitized) on the page.
 */
export function DiagramViewer({
  svg,
  title,
  onClose,
}: {
  svg: string;
  title: string;
  onClose: () => void;
}) {
  const stage = useRef<HTMLDivElement>(null);
  const [view, setView] = useState({ x: 0, y: 0, zoom: 1 });
  const drag = useRef<{ x: number; y: number; vx: number; vy: number } | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<number | null>(null);

  const fit = () => {
    const box = stage.current?.getBoundingClientRect();
    const inner = stage.current?.querySelector('svg');
    if (!box || !inner) return;
    const w = inner.viewBox.baseVal?.width || inner.getBoundingClientRect().width;
    const h = inner.viewBox.baseVal?.height || inner.getBoundingClientRect().height;
    inner.setAttribute('width', String(w));
    inner.setAttribute('height', String(h));
    inner.style.maxWidth = 'none';
    const zoom = Math.min((box.width - 48) / w, (box.height - 48) / h, 4);
    setView({ zoom, x: (box.width - w * zoom) / 2, y: (box.height - h * zoom) / 2 });
  };

  useEffect(() => {
    fit();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === '+' || e.key === '=') zoomBy(1.25);
      if (e.key === '-') zoomBy(0.8);
      if (e.key === '0') fit();
    };
    window.addEventListener('keydown', onKey);
    const previous = document.activeElement as HTMLElement | null;
    stage.current?.focus();
    return () => {
      window.removeEventListener('keydown', onKey);
      previous?.focus();
    };
  }, []);

  /** Zooms around a point of the stage (its centre by default). */
  const zoomBy = (factor: number, at?: { x: number; y: number }) =>
    setView((v) => {
      const box = stage.current?.getBoundingClientRect();
      const cx = at?.x ?? (box ? box.width / 2 : 0);
      const cy = at?.y ?? (box ? box.height / 2 : 0);
      const zoom = Math.min(8, Math.max(0.1, v.zoom * factor));
      const k = zoom / v.zoom;
      return { zoom, x: cx - (cx - v.x) * k, y: cy - (cy - v.y) * k };
    });

  const local = (e: { clientX: number; clientY: number }) => {
    const box = stage.current!.getBoundingClientRect();
    return { x: e.clientX - box.left, y: e.clientY - box.top };
  };

  return createPortal(
    <div className="viewer" role="dialog" aria-modal="true" aria-label={`${title}, enlarged`}>
      <header className="viewer-head">
        <h2>{title}</h2>
        <div className="viewer-tools">
          <button
            className="icon-button"
            type="button"
            onClick={() => zoomBy(0.8)}
            aria-label="Zoom out"
            data-tip="Zoom out"
          >
            <Minus size={16} aria-hidden />
          </button>
          <span className="viewer-zoom">{Math.round(view.zoom * 100)}%</span>
          <button
            className="icon-button"
            type="button"
            onClick={() => zoomBy(1.25)}
            aria-label="Zoom in"
            data-tip="Zoom in"
          >
            <Plus size={16} aria-hidden />
          </button>
          <button
            className="icon-button"
            type="button"
            onClick={fit}
            aria-label="Fit to screen"
            data-tip="Fit"
          >
            <Maximize size={15} aria-hidden />
          </button>
          <button
            className="icon-button"
            type="button"
            onClick={onClose}
            aria-label="Close"
            data-tip="Close (Esc)"
          >
            <X size={16} aria-hidden />
          </button>
        </div>
      </header>
      <div
        className="viewer-stage"
        ref={stage}
        tabIndex={-1}
        onWheel={(e) => zoomBy(e.deltaY < 0 ? 1.12 : 0.89, local(e))}
        onPointerDown={(e) => {
          (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
          pointers.current.set(e.pointerId, local(e));
          drag.current = { ...local(e), vx: view.x, vy: view.y };
        }}
        onPointerMove={(e) => {
          if (!pointers.current.has(e.pointerId)) return;
          pointers.current.set(e.pointerId, local(e));
          const points = [...pointers.current.values()];
          if (points.length === 2) {
            const [a, b] = points as [{ x: number; y: number }, { x: number; y: number }];
            const distance = Math.hypot(a.x - b.x, a.y - b.y);
            if (pinch.current)
              zoomBy(distance / pinch.current, { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
            pinch.current = distance;
            return;
          }
          if (!drag.current) return;
          const p = local(e);
          const start = drag.current;
          setView((v) => ({ ...v, x: start.vx + p.x - start.x, y: start.vy + p.y - start.y }));
        }}
        onPointerUp={(e) => {
          pointers.current.delete(e.pointerId);
          if (pointers.current.size < 2) pinch.current = null;
          drag.current = null;
        }}
        onPointerCancel={(e) => {
          pointers.current.delete(e.pointerId);
          drag.current = null;
          pinch.current = null;
        }}
      >
        <div
          className="viewer-content"
          style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.zoom})` }}
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      </div>
    </div>,
    document.body,
  );
}
