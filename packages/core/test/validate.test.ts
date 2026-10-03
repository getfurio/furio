import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { printable, validateRepo, type Diagnostic } from '../src/index.js';
import { MANIFEST, makeRepo, manifest } from './helpers.js';

const EXAMPLES = join(import.meta.dirname, '../../../examples/demo');

const codes = (diagnostics: Diagnostic[]) => diagnostics.map((d) => d.code);
const only = (diagnostics: Diagnostic[], code: string) =>
  diagnostics.filter((d) => d.code === code);

const VALID = `version: 1
project: shop
owner: team-shop
components:
  - id: shop-api
    type: service
  - id: orders
    type: queue
relations:
  - from: shop-api
    to: orders
    type: publishes
`;

describe('validateRepo: examples', () => {
  it.each(['shop-api', 'shop-web', 'platform'])('example repo %s is valid and clean', (repo) => {
    const result = validateRepo(join(EXAMPLES, repo));
    expect(result.diagnostics).toEqual([]);
    expect(result.valid).toBe(true);
    expect(result.manifest?.components.length).toBeGreaterThan(0);
  });
});

describe('validateRepo: locating the manifest', () => {
  it('accepts the repo root, the .architecture folder or the manifest file', () => {
    const root = makeRepo(manifest(VALID));
    for (const target of [root, join(root, '.architecture'), join(root, MANIFEST)]) {
      const result = validateRepo(target);
      expect(result.valid).toBe(true);
      expect(result.root).toBe(root);
    }
  });

  it('accepts furio.yaml as an alias', () => {
    const root = makeRepo({ '.architecture/furio.yaml': VALID });
    expect(validateRepo(root).manifestPath).toBe(join(root, '.architecture/furio.yaml'));
  });

  it('rejects both manifest names in the same repo', () => {
    const root = makeRepo({ [MANIFEST]: VALID, '.architecture/furio.yaml': VALID });
    expect(codes(validateRepo(root).diagnostics)).toEqual(['manifest-ambiguous']);
  });

  it('suggests renaming .yml to .yaml', () => {
    const root = makeRepo({ '.architecture/architecture.yml': VALID });
    const [d] = validateRepo(root).diagnostics;
    expect(d?.code).toBe('manifest-wrong-extension');
    expect(d?.hint).toContain('architecture.yaml');
  });

  it('reports a missing manifest', () => {
    const root = makeRepo({ 'README.md': '# hi' });
    const result = validateRepo(root);
    expect(codes(result.diagnostics)).toEqual(['manifest-not-found']);
    expect(result.valid).toBe(false);
  });
});

describe('validateRepo: YAML and schema errors', () => {
  it('reports YAML syntax errors with their position', () => {
    const root = makeRepo(manifest('version: 1\nproject: [shop\n'));
    const [d] = validateRepo(root).diagnostics;
    expect(d?.code).toBe('yaml-syntax');
    expect(d?.line).toBeGreaterThan(0);
  });

  it('rejects a manifest that is not a mapping', () => {
    const root = makeRepo(manifest('- just\n- a list\n'));
    expect(codes(validateRepo(root).diagnostics)).toEqual(['schema-invalid-value']);
  });

  it('rejects unsupported versions without further noise', () => {
    const root = makeRepo(manifest('version: 2\nproject: shop\nwhatever: true\n'));
    const diagnostics = validateRepo(root).diagnostics;
    expect(codes(diagnostics)).toEqual(['schema-unsupported-version']);
    expect(diagnostics[0]?.line).toBe(1);
  });

  it('points at unknown fields and suggests the right one', () => {
    const root = makeRepo(manifest(`${VALID}relation: []\n`));
    const [d] = validateRepo(root).diagnostics;
    expect(d).toMatchObject({
      code: 'schema-unknown-field',
      line: 13,
      column: 1,
      hint: 'Did you mean "relations"?',
    });
  });

  it('suggests unknown fields inside components', () => {
    const root = makeRepo(
      manifest(
        'version: 1\nproject: shop\nowner: t\ncomponents:\n  - id: a\n    type: service\n    descripton: x\n',
      ),
    );
    const [d] = validateRepo(root).diagnostics;
    expect(d).toMatchObject({ code: 'schema-unknown-field', line: 7, column: 5 });
    expect(d?.hint).toBe('Did you mean "description"?');
  });

  it('reports missing required fields at the item that misses them', () => {
    const root = makeRepo(manifest('version: 1\nowner: t\ncomponents:\n  - id: a\n'));
    const diagnostics = validateRepo(root).diagnostics;
    expect(diagnostics.map((d) => d.message)).toEqual([
      'The manifest is missing the required field "project".',
      'components[0] (a) is missing the required field "type".',
    ]);
    expect(diagnostics[1]?.line).toBe(4);
  });

  it('reports reference warnings together with schema errors', () => {
    const root = makeRepo(
      manifest(
        'version: 1\nproject: shop\nowner: t\ncomponents:\n  - id: shop-api\n    type: servce\n  - id: orders\n    type: queue\nrelations:\n  - from: shop-api\n    to: ordrs\n    type: publishes\n  - from: shop-api\n    to: orders\n    type: publishes\n',
      ),
    );
    const result = validateRepo(root);
    // shop-api fails the schema but keeps its id: its relations are still checked, not flagged.
    expect(codes(result.diagnostics)).toEqual(['schema-invalid-value', 'unresolved-reference']);
    expect(result.diagnostics[1]).toMatchObject({
      line: 11,
      hint: expect.stringContaining('"orders"'),
    });
    expect(result.valid).toBe(false);
    expect(result.manifest).toBeUndefined();
  });

  it('suggests the closest component and relation type', () => {
    const root = makeRepo(
      manifest(
        'version: 1\nproject: shop\nowner: t\ncomponents:\n  - id: a\n    type: servce\nrelations:\n  - from: a\n    to: b\n    type: call\n',
      ),
    );
    const diagnostics = validateRepo(root).diagnostics;
    expect(diagnostics.map((d) => d.hint?.split('?')[0])).toEqual([
      'Did you mean "service"',
      'Did you mean "calls"',
    ]);
    expect(diagnostics[0]).toMatchObject({ line: 6, column: 11 });
  });

  it('suggests a kebab-case id', () => {
    const root = makeRepo(
      manifest(
        'version: 1\nproject: shop\nowner: t\ncomponents:\n  - id: Payments API\n    type: service\n',
      ),
    );
    expect(validateRepo(root).diagnostics[0]?.hint).toBe('Try "payments-api".');
  });

  it('rejects invalid links', () => {
    const root = makeRepo(
      manifest(
        'version: 1\nproject: shop\nowner: t\ncomponents:\n  - id: a\n    type: service\n    links:\n      docs: nope\n',
      ),
    );
    expect(validateRepo(root).diagnostics[0]?.message).toContain('not a valid URL');
  });

  it('accepts only http and https links', () => {
    const root = makeRepo(
      manifest(
        'version: 1\nproject: shop\nowner: t\ncomponents:\n  - id: a\n    type: service\n    links:\n      docs: javascript:alert(1)\n',
      ),
    );
    expect(validateRepo(root).valid).toBe(false);
  });
});

describe('validateRepo: semantics', () => {
  it('rejects duplicate component ids', () => {
    const root = makeRepo(
      manifest(
        `${VALID}  - from: orders\n    to: shop-api\n    type: calls\n`.replace(
          '  - id: orders',
          '  - id: shop-api',
        ),
      ),
    );
    expect(codes(validateRepo(root).diagnostics)).toContain('duplicate-component');
  });

  it('requires relations to start from a local component', () => {
    const root = makeRepo(manifest(VALID.replace('from: shop-api', 'from: shopapi')));
    const [d] = only(validateRepo(root).diagnostics, 'unknown-from');
    expect(d?.severity).toBe('error');
    expect(d?.hint).toBe('Did you mean "shop-api"?');
    expect(d?.line).toBe(10);
  });

  it('warns about a near-miss of a local id', () => {
    const root = makeRepo(manifest(VALID.replace('to: orders', 'to: order')));
    const result = validateRepo(root);
    expect(result.valid).toBe(true);
    expect(only(result.diagnostics, 'unresolved-reference')[0]?.hint).toContain('"orders"');
  });

  it('trusts references to other repos when the workspace is unknown', () => {
    const root = makeRepo(
      manifest(
        `${VALID}  - from: shop-api\n    to: platform/users-api\n    type: calls\n  - from: shop-api\n    to: catalog-service\n    type: calls\n`,
      ),
    );
    expect(validateRepo(root).diagnostics).toEqual([]);
  });

  it('checks references against the known workspace and suggests the closest', () => {
    const root = makeRepo(
      manifest(
        `${VALID}  - from: shop-api\n    to: platform/user-api\n    type: calls\n  - from: shop-api\n    to: platform/email\n    type: calls\n`,
      ),
    );
    const result = validateRepo(root, {
      knownComponents: ['platform/users-api', 'platform/email'],
    });
    const unresolved = only(result.diagnostics, 'unresolved-reference');
    expect(unresolved).toHaveLength(1);
    expect(unresolved[0]?.severity).toBe('warning');
    expect(unresolved[0]?.message).toContain('"platform/user-api"');
    expect(unresolved[0]?.hint).toContain('Did you mean "platform/users-api"?');
  });

  it('warns about self relations and duplicate relations', () => {
    const root = makeRepo(
      manifest(
        `${VALID}  - from: shop-api\n    to: shop/orders\n    type: publishes\n  - from: orders\n    to: orders\n    type: calls\n`,
      ),
    );
    expect(codes(validateRepo(root).diagnostics).sort()).toEqual([
      'duplicate-relation',
      'self-relation',
    ]);
  });

  it('warns once about ownerless components, or names the single one', () => {
    const many = makeRepo(manifest(VALID.replace('owner: team-shop\n', '')));
    const [grouped] = validateRepo(many).diagnostics;
    expect(grouped?.message).toBe('2 components have no owner: shop-api, orders.');

    const one = makeRepo(
      manifest(
        VALID.replace('owner: team-shop\n', '').replace(
          '    type: queue\n',
          '    type: queue\n    owner: t\n',
        ),
      ),
    );
    expect(validateRepo(one).diagnostics.map((d) => d.message)).toEqual([
      'Component "shop-api" has no owner.',
    ]);
  });

  it('warns about an empty manifest', () => {
    const root = makeRepo(manifest('version: 1\nproject: shop\n'));
    expect(codes(validateRepo(root).diagnostics)).toEqual(['no-components']);
  });

  it('points the empty-manifest warning at components:, when it is there', () => {
    const root = makeRepo(manifest('version: 1\nproject: shop\nowner: t\n\ncomponents: []\n'));
    const [d] = validateRepo(root).diagnostics;
    expect(d).toMatchObject({ code: 'no-components', line: 5, column: 1 });
  });
});

describe('validateRepo: diagrams', () => {
  const withDiagram = (file: string, extra: Record<string, string> = {}) =>
    makeRepo({
      [MANIFEST]: `${VALID}diagrams:\n  - file: ${file}\n    title: Flow\n    components: [shop-api]\n`,
      ...extra,
    });

  it('accepts .mmd files and .md files with mermaid blocks', () => {
    expect(
      validateRepo(
        withDiagram('diagrams/a.mmd', { '.architecture/diagrams/a.mmd': 'graph LR; a-->b' }),
      ).diagnostics,
    ).toEqual([]);
    expect(
      validateRepo(
        withDiagram('a.md', { '.architecture/a.md': '# A\n\n```mermaid\ngraph LR; a-->b\n```\n' }),
      ).diagnostics,
    ).toEqual([]);
  });

  it('reports a missing file and suggests the closest one', () => {
    const [d] = validateRepo(
      withDiagram('diagrams/flw.mmd', { '.architecture/diagrams/flow.mmd': 'graph LR; a-->b' }),
    ).diagnostics.filter((x) => x.severity === 'error');
    expect(d).toMatchObject({
      code: 'diagram-not-found',
      hint: 'Did you mean "diagrams/flow.mmd"?',
    });
  });

  it('rejects paths outside .architecture and other extensions', () => {
    expect(codes(validateRepo(withDiagram('../README.md')).diagnostics)).toEqual([
      'diagram-outside-architecture',
    ]);
    expect(
      codes(validateRepo(withDiagram('flow.png', { '.architecture/flow.png': 'x' })).diagnostics),
    ).toEqual(['diagram-bad-extension']);
  });

  it('rejects empty .mmd files and .md files without mermaid', () => {
    expect(
      codes(validateRepo(withDiagram('a.mmd', { '.architecture/a.mmd': '  \n' })).diagnostics),
    ).toEqual(['diagram-empty']);
    expect(
      codes(validateRepo(withDiagram('a.md', { '.architecture/a.md': '# just text' })).diagnostics),
    ).toEqual(['diagram-no-mermaid-block']);
  });

  it('warns about diagrams that the manifest does not list', () => {
    const root = makeRepo({
      [MANIFEST]: VALID,
      '.architecture/diagrams/forgotten.mmd': 'graph LR; a-->b',
      '.architecture/notes.md': 'plain notes, not a diagram',
    });
    const diagnostics = validateRepo(root).diagnostics;
    expect(codes(diagnostics)).toEqual(['diagram-unreferenced']);
    expect(diagnostics[0]?.file).toBe(join(root, '.architecture/diagrams/forgotten.mmd'));
  });
});

describe('validateRepo: files it does not read', () => {
  const withDiagram = (file: string) =>
    makeRepo(manifest(`${VALID}diagrams:\n  - file: ${file}\n    title: Flow\n`));
  /** A file outside any repo, as a secret on the machine that runs Furio would be. */
  const outside = (content = 'graph LR; secret-->leak') => {
    const dir = mkdtempSync(join(tmpdir(), 'furio-outside-'));
    writeFileSync(join(dir, 'secret.mmd'), content);
    return dir;
  };

  it('does not follow a diagram that is a symbolic link', () => {
    const root = withDiagram('leak.mmd');
    symlinkSync(join(outside(), 'secret.mmd'), join(root, '.architecture/leak.mmd'));
    const result = validateRepo(root);
    expect(result.valid).toBe(false);
    expect(codes(result.diagnostics)).toEqual(['symlink-not-followed']);
    expect(result.diagnostics[0]).toMatchObject({ severity: 'error', line: 14 });
    expect(result.diagnostics[0]?.message).toContain('.architecture/leak.mmd is a symbolic link');
  });

  it('does not follow a linked folder either, and reports it once', () => {
    const root = withDiagram('linked/secret.mmd');
    symlinkSync(outside(), join(root, '.architecture/linked'));
    const result = validateRepo(root);
    expect(codes(result.diagnostics)).toEqual(['symlink-not-followed']);
    expect(result.diagnostics[0]?.message).toContain(
      'inside a symbolic link (.architecture/linked)',
    );
  });

  it('warns about a link the manifest does not list, without reading it', () => {
    const root = makeRepo(manifest(VALID));
    symlinkSync(join(outside('```mermaid\n'), 'secret.mmd'), join(root, '.architecture/note.md'));
    const result = validateRepo(root);
    expect(result.valid).toBe(true);
    expect(result.diagnostics).toMatchObject([
      { severity: 'warning', code: 'symlink-not-followed' },
    ]);
  });

  it('rejects a manifest, or a whole .architecture folder, that is a link', () => {
    const real = makeRepo(manifest(VALID));
    const linkedFile = makeRepo({ 'README.md': '' });
    mkdirSync(join(linkedFile, '.architecture'));
    symlinkSync(join(real, MANIFEST), join(linkedFile, MANIFEST));
    expect(validateRepo(linkedFile)).toMatchObject({ valid: false, manifest: undefined });
    expect(codes(validateRepo(linkedFile).diagnostics)).toEqual(['symlink-not-followed']);

    const linkedFolder = makeRepo({ 'README.md': '' });
    symlinkSync(join(real, '.architecture'), join(linkedFolder, '.architecture'));
    expect(codes(validateRepo(linkedFolder).diagnostics)).toEqual(['symlink-not-followed']);
    expect(validateRepo(linkedFolder).manifestPath).toBeUndefined();
  });

  it('rejects files over 1 MB and folders named like a diagram', () => {
    const big = withDiagram('big.mmd');
    writeFileSync(join(big, '.architecture/big.mmd'), 'graph LR; a-->b\n'.repeat(70_000));
    expect(codes(validateRepo(big).diagnostics)).toEqual(['file-too-large']);

    const folder = withDiagram('flow.mmd');
    mkdirSync(join(folder, '.architecture/flow.mmd'));
    const [d] = validateRepo(folder).diagnostics;
    expect(d).toMatchObject({ code: 'diagram-not-found' });
    expect(d?.message).toContain('is not a file');

    const manifestFolder = makeRepo({ 'README.md': '' });
    mkdirSync(join(manifestFolder, MANIFEST), { recursive: true });
    expect(codes(validateRepo(manifestFolder).diagnostics)).toEqual(['manifest-not-found']);
  });
});

describe('validateRepo: hostile input', () => {
  it('reports aliases that multiply each other as an error, instead of throwing', () => {
    const level = (name: string, of: string) => `${name}: &${name} [${`*${of}, `.repeat(10)}]\n`;
    const root = makeRepo(
      manifest(
        `version: 1\nproject: bomb\na: &a [x, x, x, x, x, x, x, x, x, x]\n${level('b', 'a')}${level('c', 'b')}${level('d', 'c')}`,
      ),
    );
    const result = validateRepo(root);
    expect(result.valid).toBe(false);
    expect(result.diagnostics).toMatchObject([{ code: 'yaml-syntax', line: 1 }]);
    expect(result.diagnostics[0]?.message).toContain('Excessive alias count');
  });

  it('checks a file of blank lines in a time that grows with its size', () => {
    const root = makeRepo({
      [MANIFEST]: VALID,
      '.architecture/blank.md': '\n'.repeat(400_000),
      '.architecture/spaces.md': ' \t\n'.repeat(200_000),
    });
    const start = performance.now();
    expect(validateRepo(root).diagnostics).toEqual([]);
    // Quadratic, it took over a minute; linear, a few milliseconds.
    expect(performance.now() - start).toBeLessThan(5000);
  });

  it('still finds indented and tilde fences', () => {
    for (const block of [
      '  ```mermaid\ngraph LR; a-->b\n  ```\n',
      '~~~ mermaid\ngraph LR\n~~~\n',
    ]) {
      const root = makeRepo({ [MANIFEST]: VALID, '.architecture/extra.md': `# Notes\n\n${block}` });
      expect(codes(validateRepo(root).diagnostics)).toEqual(['diagram-unreferenced']);
    }
  });

  it('never lets a manifest write control characters in a message', () => {
    const root = makeRepo(
      manifest(
        'version: 1\nproject: shop\nowner: t\n"bad\\n::error::key": 1\ncomponents:\n  - id: api\n    type: "x\\n::error file=README.md::Injected\\e[2K\\u202e"\n',
      ),
    );
    const { diagnostics } = validateRepo(root);
    expect(diagnostics).toHaveLength(2);
    for (const d of diagnostics) {
      expect(`${d.message}${d.hint ?? ''}`).not.toMatch(/[\p{Cc}\u202e]/u);
    }
    expect(diagnostics.map((d) => d.message).join(' ')).toContain('"x\\n::error file=README.md');
  });

  it('cuts a long value and shows control characters as escapes', () => {
    const root = makeRepo(
      manifest(
        `version: 1\nproject: shop\nowner: t\ncomponents:\n  - id: api\n    type: ${'x'.repeat(5000)}\n`,
      ),
    );
    const [d] = validateRepo(root).diagnostics;
    expect(d?.message.length).toBeLessThan(200);
    expect(d?.message).toContain(`${'x'.repeat(80)}…`);
    expect(printable('a\nb\tc\u001b[0m\u2028')).toBe('a\\nb\\tc\\u001b[0m\\u2028');
    expect(printable('x'.repeat(50), 10)).toBe(`${'x'.repeat(9)}…`);
  });

  it('stops suggesting after a while, so many mistakes stay quick to check', () => {
    const components = Array.from({ length: 60 }, (_, i) => `  - id: api-${i}\n    type: servce\n`);
    const root = makeRepo(
      manifest(`version: 1\nproject: shop\nowner: t\ncomponents:\n${components.join('')}`),
    );
    const { diagnostics } = validateRepo(root);
    expect(diagnostics).toHaveLength(60);
    expect(diagnostics.filter((d) => d.hint?.startsWith('Did you mean')).length).toBe(25);
  });
});

describe('validateRepo: schema 1.1', () => {
  const desk = (components: string, extra = '') =>
    `version: 1\nproject: desk\nowner: t\n${extra}components:\n${components}`;

  it('flags a tech that looks like a typo of a known one, and accepts anything else', () => {
    const root = makeRepo(
      manifest(
        desk(
          '  - id: db\n    type: database\n    tech: postgress\n  - id: q\n    type: queue\n    tech: beanstalkd\n  - id: c\n    type: cache\n    tech: valkey\n',
        ),
      ),
    );
    const result = validateRepo(root);
    expect(result.valid).toBe(true);
    expect(result.diagnostics.map((d) => [d.code, d.line, d.hint?.split('?')[0]])).toEqual([
      ['unknown-tech', 7, 'Did you mean "postgres"'],
    ]);
  });

  it('checks paths in a checkout, not when only the manifest was received', () => {
    const files = manifest(
      desk(
        '  - id: api\n    type: service\n    path: apps/api\n  - id: web\n    type: frontend\n    path: apps/web/\n',
      ),
    );
    const checkout = makeRepo({ ...files, 'apps/web/index.ts': '' });
    expect(codes(validateRepo(checkout).diagnostics)).toEqual(['path-not-found']);
    expect(validateRepo(checkout).diagnostics[0]).toMatchObject({ line: 7 });
    expect(codes(validateRepo(makeRepo(files)).diagnostics)).toEqual([]);
    expect(codes(validateRepo(checkout, { checkPaths: false }).diagnostics)).toEqual([]);
  });

  it('in a closed project, a reference it does not declare is an error', () => {
    const body = desk(
      '  - id: engine\n    type: service\n  - id: db\n    type: database\nrelations:\n  - from: engine\n    to: dbb\n    type: reads_writes\n  - from: engine\n    to: platform/users-api\n    type: calls\n',
      'closed: true\n',
    );
    const result = validateRepo(makeRepo(manifest(body)));
    expect(result.valid).toBe(false);
    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        severity: 'error',
        code: 'undeclared-component',
        hint: 'Did you mean "db"?',
      }),
    ]);
    // Without closed, the same typo is only a warning.
    const open = validateRepo(makeRepo(manifest(body.replace('closed: true\n', ''))));
    expect(open.valid).toBe(true);
    expect(codes(open.diagnostics)).toEqual(['unresolved-reference']);
  });
});
