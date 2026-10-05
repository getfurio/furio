import { splitMarkdown } from './markdown';
import { displayName, type Model, type Site } from './model';
import type { DiagramFind } from './router';

export type ModelDiagram = Model['diagrams'][number];

export interface DiagramKind {
  id: string;
  label: string;
}

/** The opening word of a Mermaid diagram, and what the map calls that kind. */
const KINDS: [RegExp, string, string][] = [
  [/^(flowchart|graph)\b/, 'flowchart', 'Flowchart'],
  [/^sequenceDiagram\b/, 'sequence', 'Sequence'],
  [/^stateDiagram\b/, 'state', 'State'],
  [/^erDiagram\b/, 'entities', 'Entities'],
  [/^classDiagram\b/, 'class', 'Class'],
  [/^journey\b/, 'journey', 'Journey'],
  [/^gantt\b/, 'gantt', 'Gantt'],
  [/^timeline\b/, 'timeline', 'Timeline'],
  [/^gitGraph\b/, 'git', 'Git graph'],
  [/^mindmap\b/, 'mindmap', 'Mind map'],
  [/^C4[A-Z]\w*\b/, 'c4', 'C4'],
  [/^architecture\b/, 'architecture', 'Architecture'],
  [/^requirementDiagram\b/, 'requirements', 'Requirements'],
  [/^kanban\b/, 'kanban', 'Kanban'],
  [/^(pie|quadrantChart|xychart|sankey|radar)\b/, 'chart', 'Chart'],
];

const DIAGRAM: DiagramKind = { id: 'diagram', label: 'Diagram' };

function mermaidKind(source: string): DiagramKind {
  let frontmatter = false;
  for (const [index, raw] of source.split('\n', 200).entries()) {
    const line = raw.trim();
    if (line === '---' && (index === 0 || frontmatter)) {
      frontmatter = !frontmatter;
      continue;
    }
    // Blank lines, comments and %%{init}%% directives come before the diagram itself.
    if (frontmatter || !line || line.startsWith('%%')) continue;
    const kind = KINDS.find(([opening]) => opening.test(line));
    return kind ? { id: kind[1], label: kind[2] } : DIAGRAM;
  }
  return DIAGRAM;
}

const kinds = new WeakMap<ModelDiagram, DiagramKind>();

/**
 * What a diagram is, read from its source: the kind of a Mermaid file, or a document (prose with
 * any number of diagrams) for a Markdown one.
 */
export function diagramKind(diagram: ModelDiagram): DiagramKind {
  let kind = kinds.get(diagram);
  if (!kind) {
    if (diagram.format === 'markdown') {
      const blocks = splitMarkdown(diagram.content).filter((p) => p.kind === 'mermaid').length;
      const label = blocks > 1 ? `Document, ${blocks} diagrams` : 'Document';
      kind = { id: 'document', label };
    } else kind = mermaidKind(diagram.content);
    kinds.set(diagram, kind);
  }
  return kind;
}

/** A described component as a diagram names it: by id inside its project, by key outside it. */
export function partLabel(diagram: ModelDiagram, key: string): string {
  return key.startsWith(`${diagram.project}/`) ? key.slice(diagram.project.length + 1) : key;
}

/**
 * The diagrams the grid shows, by project and then by title: the ones of the picked projects
 * where every word of the search is in the title, the file, the repo, the project, the kind or
 * the components described.
 */
export function findDiagrams(
  site: Site,
  diagrams: ModelDiagram[],
  find: DiagramFind = {},
): ModelDiagram[] {
  const words = (find.q ?? '').toLowerCase().split(/\s+/).filter(Boolean);
  const text = (d: ModelDiagram) =>
    [
      d.title,
      d.file,
      d.repo,
      d.project,
      diagramKind(d).label,
      ...d.components.flatMap((key) => {
        const part = site.byKey.get(key);
        return [key, part ? displayName(part) : ''];
      }),
    ]
      .join(' ')
      .toLowerCase();
  return diagrams
    .filter((d) => !find.projects?.length || find.projects.includes(d.project))
    .filter((d) => {
      if (!words.length) return true;
      const fields = text(d);
      return words.every((word) => fields.includes(word));
    })
    .sort((a, b) => a.project.localeCompare(b.project) || a.title.localeCompare(b.title));
}
