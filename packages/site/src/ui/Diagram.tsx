import { Maximize2 } from 'lucide-react';
import { marked } from 'marked';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { splitMarkdown } from '../markdown';
import type { Model } from '../model';
import { useAppearance, type Theme } from '../theme';
import { DiagramViewer } from './DiagramViewer';
import { sanitizeDiagram, sanitizeProse } from './sanitize';

type ModelDiagram = Model['diagrams'][number];

let mermaidReady: Promise<typeof import('mermaid').default> | null = null;

/** Mermaid is heavy: loaded on the first diagram. */
function loadMermaid() {
  mermaidReady ??= import('mermaid').then(({ default: mermaid }) => mermaid);
  return mermaidReady;
}

/** The map's colours, read from its CSS variables: diagrams follow the theme and the palette. */
function colors() {
  const css = getComputedStyle(document.documentElement);
  const v = (name: string) => css.getPropertyValue(name).trim();
  return {
    surface: v('--surface'),
    card: v('--surface-2'),
    card2: v('--surface-3'),
    border: v('--border-solid'),
    text: v('--text'),
    text2: v('--text-2'),
    accent: v('--accent-2'),
  };
}

/**
 * What a diagram cannot change from its own source (%%{init}%% or frontmatter): the map draws
 * every diagram its way. HTML labels could embed remote images; a theme, CSS or a font of its
 * own could make the page fetch from another host.
 */
const LOCKED = [
  'secure securityLevel startOnLoad maxTextSize maxEdges suppressErrorRendering',
  'htmlLabels theme themeCSS themeVariables darkMode fontFamily altFontFamily',
].flatMap((line) => line.split(' '));

/** The map's look, in the current theme: cards, hairline borders, accent connections. */
function configure(mermaid: typeof import('mermaid').default, theme: Theme) {
  const c = colors();
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'strict',
    secure: LOCKED,
    // Plain SVG text labels (no HTML in foreignObject), so the output can be sanitized as SVG.
    htmlLabels: false,
    flowchart: { htmlLabels: false },
    theme: 'base',
    look: 'classic',
    fontFamily: "'Inter Variable', system-ui, sans-serif",
    themeVariables: {
      darkMode: theme === 'dark',
      background: c.surface,
      primaryColor: c.card,
      primaryTextColor: c.text,
      primaryBorderColor: c.border,
      secondaryColor: c.card2,
      tertiaryColor: c.surface,
      lineColor: c.accent,
      textColor: c.text,
      actorBkg: c.card,
      actorTextColor: c.text,
      actorBorder: c.border,
      actorLineColor: c.border,
      signalColor: c.text2,
      signalTextColor: c.text2,
      noteBkgColor: c.card2,
      noteTextColor: c.text2,
      noteBorderColor: c.border,
      edgeLabelBackground: c.surface,
      fontSize: '13px',
    },
    themeCSS: `
      .node rect, .node polygon, .node circle, .node path, .actor, rect.actor { filter: none !important; rx: 8px; }
      .flowchart-link, .messageLine0, .messageLine1 { stroke: ${c.accent} !important; }
      marker path, #arrowhead path { fill: ${c.accent} !important; stroke: ${c.accent} !important; }
      .edgeLabel, .edgeLabel p, .edgeLabel rect { background: ${c.surface} !important; fill: ${c.surface} !important; color: ${c.text2} !important; }
    `,
  });
}

function MermaidBlock({ source, title }: { source: string; title: string }) {
  const id = useId().replace(/[^a-zA-Z0-9]/g, '');
  const host = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [{ theme, palette }] = useAppearance();

  useEffect(() => {
    let live = true;
    loadMermaid()
      .then((mermaid) => {
        configure(mermaid, theme);
        return mermaid.render(`m${id}${theme}${palette}`, source);
      })
      .then(({ svg }) => {
        // Diagrams come from any repo of the workspace: sanitized again, as SVG only.
        if (live && host.current) host.current.innerHTML = sanitizeDiagram(svg);
      })
      .catch((e: unknown) => live && setError((e as Error).message));
    return () => {
      live = false;
    };
  }, [id, source, theme, palette]);

  const [enlarged, setEnlarged] = useState<string | null>(null);

  if (error)
    return <pre className="diagram-error">This Mermaid diagram does not render: {error}</pre>;
  return (
    <div className="mermaid-wrap">
      <div className="mermaid-out" ref={host} aria-busy={!host.current?.innerHTML} />
      <button
        className="icon-button enlarge"
        type="button"
        onClick={() => host.current?.innerHTML && setEnlarged(host.current.innerHTML)}
        aria-label={`Enlarge ${title}`}
        data-tip="Enlarge"
      >
        <Maximize2 size={15} aria-hidden />
      </button>
      {enlarged && <DiagramViewer svg={enlarged} title={title} onClose={() => setEnlarged(null)} />}
    </div>
  );
}

/** Markdown as prose and ```mermaid blocks, each rendered in order. */
function MarkdownDiagram({ content, title }: { content: string; title: string }) {
  const parts = useMemo(() => {
    const out = splitMarkdown(content);
    // The panel already shows the title: drop a leading heading that repeats it.
    const first = out[0];
    if (first?.kind === 'md') {
      first.text = first.text.replace(/^\s*#{1,6}\s+(.+)\n/, (line, heading: string) =>
        heading.trim().toLowerCase() === title.trim().toLowerCase() ? '' : line,
      );
    }
    return out;
  }, [content, title]);

  return (
    <>
      {parts.map((part, i) =>
        part.kind === 'mermaid' ? (
          <MermaidBlock key={i} source={part.text} title={title} />
        ) : (
          <div
            key={i}
            className="prose"
            // Markdown comes from any repo of the workspace: reduced to prose before the DOM.
            dangerouslySetInnerHTML={{
              __html: sanitizeProse(marked.parse(part.text, { async: false })),
            }}
          />
        ),
      )}
    </>
  );
}

export function Diagram({
  diagram,
  id,
  children,
}: {
  diagram: ModelDiagram;
  id?: string;
  /** Shown under the diagram, e.g. the components it describes. */
  children?: React.ReactNode;
}) {
  return (
    <figure className="diagram" style={{ margin: '0 0 20px' }} id={id}>
      <div className="diagram-head">
        <h3>{diagram.title}</h3>
        <span className="mono">
          {diagram.repo} · .architecture/{diagram.file}
        </span>
      </div>
      <div className={`diagram-body ${diagram.format === 'markdown' ? 'prose' : ''}`}>
        {diagram.format === 'markdown' ? (
          <MarkdownDiagram content={diagram.content} title={diagram.title} />
        ) : (
          <MermaidBlock source={diagram.content} title={diagram.title} />
        )}
      </div>
      {children}
    </figure>
  );
}
