export interface MarkdownPart {
  kind: 'md' | 'mermaid';
  text: string;
}

const OPENING = /^(```|~~~)\s*mermaid\s*$/;

const closes = (line: string, fence: string) =>
  line.startsWith(fence) && !line.slice(fence.length).trim();

/**
 * Splits Markdown into prose and ```mermaid blocks, in order. It reads line by line, so the time
 * it takes grows with the size of the file, whatever the file contains: diagrams come from any
 * repo of the workspace, and one crafted file must not freeze the page of whoever opens the map.
 */
export function splitMarkdown(content: string): MarkdownPart[] {
  const lines = content.split('\n');
  const parts: MarkdownPart[] = [];
  let prose = '';
  const flush = () => {
    if (prose.trim()) parts.push({ kind: 'md', text: prose });
    prose = '';
  };
  // A fence with no closing line below has none for any later block either: looked for once.
  const unclosed = new Set<string>();
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const fence = OPENING.exec(line)?.[1];
    if (fence && !unclosed.has(fence)) {
      let end = i + 1;
      while (end < lines.length && !closes(lines[end]!, fence)) end++;
      if (end < lines.length) {
        flush();
        const source = lines.slice(i + 1, end).map((l) => `${l}\n`);
        parts.push({ kind: 'mermaid', text: source.join('') });
        i = end;
        continue;
      }
      unclosed.add(fence);
    }
    prose += i < lines.length - 1 ? `${line}\n` : line;
  }
  flush();
  return parts;
}
