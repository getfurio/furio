import { ControlButton, getViewportForBounds, useReactFlow } from '@xyflow/react';
import { toPng, toSvg } from 'html-to-image';
import { FileJson, ImageDown, Maximize, Minus, PenTool, Plus } from 'lucide-react';
import type { Site } from '../model';

const PADDING = 48;

/** Downloads the whole board (not only what is on screen) as PNG or SVG, or the model as JSON. */
export function ExportButtons({ site }: { site: Site }) {
  const flow = useReactFlow();

  const render = async (format: 'png' | 'svg') => {
    const viewport = document.querySelector<HTMLElement>('.board-canvas .react-flow__viewport');
    if (!viewport) return;
    // The instance method resolves child nodes (footprints inside boards) to absolute positions.
    const bounds = flow.getNodesBounds(flow.getNodes());
    const width = Math.ceil(bounds.width + PADDING * 2);
    const height = Math.ceil(bounds.height + PADDING * 2);
    const { x, y, zoom } = getViewportForBounds(bounds, width, height, 1, 1, `${PADDING}px`);
    const options = {
      backgroundColor:
        getComputedStyle(document.documentElement).getPropertyValue('--canvas').trim() || '#0d0e10',
      width,
      height,
      pixelRatio: 2,
      style: {
        width: `${width}px`,
        height: `${height}px`,
        transform: `translate(${x}px, ${y}px) scale(${zoom})`,
      },
    };
    const url = format === 'png' ? await toPng(viewport, options) : await toSvg(viewport, options);
    download(url, `${fileName(site)}.${format}`);
  };

  const json = () => {
    const blob = new Blob([JSON.stringify(site.model, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    download(url, `${fileName(site)}.json`);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <>
      <ControlButton
        className="export-button"
        onClick={() => void render('png')}
        data-tip="Download as PNG"
        aria-label="Download as PNG"
      >
        <ImageDown size={15} aria-hidden />
      </ControlButton>
      <ControlButton
        className="export-button"
        onClick={() => void render('svg')}
        data-tip="Download as SVG"
        aria-label="Download as SVG"
      >
        <PenTool size={15} aria-hidden />
      </ControlButton>
      <ControlButton
        className="export-button"
        onClick={json}
        data-tip="Download the model (JSON)"
        aria-label="Download the model as JSON"
      >
        <FileJson size={15} aria-hidden />
      </ControlButton>
    </>
  );
}

function fileName(site: Site): string {
  return `furio-${site.model.workspace.id}-${site.model.generatedAt.slice(0, 10)}`;
}

function download(url: string, name: string) {
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
}

/** Zoom and fit, with labels that show on hover (React Flow's own only have native titles). */
export function ZoomButtons({
  fitPadding,
}: {
  fitPadding: Parameters<ReturnType<typeof useReactFlow>['fitView']>[0];
}) {
  const flow = useReactFlow();
  return (
    <>
      <ControlButton
        onClick={() => void flow.zoomIn({ duration: 150 })}
        data-tip="Zoom in"
        aria-label="Zoom in"
      >
        <Plus size={15} aria-hidden />
      </ControlButton>
      <ControlButton
        onClick={() => void flow.zoomOut({ duration: 150 })}
        data-tip="Zoom out"
        aria-label="Zoom out"
      >
        <Minus size={15} aria-hidden />
      </ControlButton>
      <ControlButton
        className="export-button"
        onClick={() => void flow.fitView({ ...fitPadding, duration: 200 })}
        data-tip="Fit the whole map"
        aria-label="Fit the whole map"
      >
        <Maximize size={14} aria-hidden />
      </ControlButton>
    </>
  );
}
