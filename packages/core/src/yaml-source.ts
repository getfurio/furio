import { isMap, isPair, isScalar, LineCounter, parseDocument, type Document } from 'yaml';

export type ManifestPath = (string | number)[];

export interface Position {
  line: number;
  column: number;
}

/** A parsed YAML file that can map manifest paths back to line and column. */
export class YamlSource {
  readonly doc: Document;
  private readonly lines = new LineCounter();

  constructor(readonly text: string) {
    this.doc = parseDocument(text, { lineCounter: this.lines, prettyErrors: false });
  }

  positionOfOffset(offset: number): Position {
    const { line, col } = this.lines.linePos(offset);
    return { line, column: col };
  }

  /**
   * Position of the node at `path`. When the node does not exist (a missing field) it falls back
   * to the closest existing ancestor. With `key`, it points at that key inside the map at `path`.
   */
  positionOf(path: ManifestPath, key?: string): Position | undefined {
    if (key !== undefined) {
      const map = path.length ? this.doc.getIn(path, true) : this.doc.contents;
      if (isMap(map)) {
        const pair = map.items.find(
          (item) => isPair(item) && isScalar(item.key) && item.key.value === key,
        );
        const range = pair && isScalar(pair.key) ? pair.key.range : undefined;
        if (range) return this.positionOfOffset(range[0]);
      }
    }
    const remaining = [...path];
    while (remaining.length) {
      const node = this.doc.getIn(remaining, true) as
        { range?: [number, number, number] } | undefined;
      if (node?.range) return this.positionOfOffset(node.range[0]);
      remaining.pop();
    }
    const root = this.doc.contents;
    return root?.range ? this.positionOfOffset(root.range[0]) : undefined;
  }
}
