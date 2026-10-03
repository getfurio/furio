export type Severity = 'error' | 'warning';

export type DiagnosticCode =
  | 'manifest-not-found'
  | 'manifest-ambiguous'
  | 'manifest-wrong-extension'
  | 'symlink-not-followed'
  | 'file-too-large'
  | 'yaml-syntax'
  | 'yaml-warning'
  | 'schema-unknown-field'
  | 'schema-missing-field'
  | 'schema-invalid-value'
  | 'schema-unsupported-version'
  | 'duplicate-component'
  | 'unknown-from'
  | 'unresolved-reference'
  | 'undeclared-component'
  | 'unknown-tech'
  | 'path-not-found'
  | 'self-relation'
  | 'duplicate-relation'
  | 'missing-owner'
  | 'no-components'
  | 'diagram-not-found'
  | 'diagram-outside-architecture'
  | 'diagram-bad-extension'
  | 'diagram-empty'
  | 'diagram-no-mermaid-block'
  | 'diagram-duplicate'
  | 'diagram-unknown-component'
  | 'diagram-unreferenced';

export interface Diagnostic {
  severity: Severity;
  code: DiagnosticCode;
  /** Complete technical description: what is wrong and where. */
  message: string;
  /** Suggested fix, when Furio has one. */
  hint?: string;
  /** Absolute path of the file the diagnostic is about. */
  file: string;
  /** 1-based. */
  line?: number;
  /** 1-based. */
  column?: number;
  /** Path inside the manifest, e.g. ["relations", 2, "to"]. */
  path?: (string | number)[];
}

export function countBySeverity(diagnostics: readonly Diagnostic[]) {
  let errors = 0;
  let warnings = 0;
  for (const d of diagnostics) {
    if (d.severity === 'error') errors++;
    else warnings++;
  }
  return { errors, warnings };
}

/** New lines, terminal escapes and the marks that reorder text on screen. */
const UNPRINTABLE = /[\p{Cc}\u061c\u200e\u200f\u2028-\u202e\u2066-\u2069]/gu;

/**
 * Text that comes from a manifest, a file name or a server, made safe to print: control
 * characters are shown as escapes instead of being obeyed by the terminal, or by the CI runner
 * that reads commands in the log. Long text is cut.
 */
export function printable(text: string, max = 600): string {
  const escaped = text.replace(UNPRINTABLE, (char) =>
    char === '\n'
      ? '\\n'
      : char === '\r'
        ? '\\r'
        : char === '\t'
          ? '\\t'
          : `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`,
  );
  return escaped.length > max ? `${escaped.slice(0, max - 1)}…` : escaped;
}
