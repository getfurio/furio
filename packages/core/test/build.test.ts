import { mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildModel, type RepoSource } from '../src/index.js';
import { makeRepo, manifest } from './helpers.js';

const EXAMPLES = join(import.meta.dirname, '../../../examples/demo');
const OPTIONS = { workspace: 'acme', generatorVersion: '0.0.0-test', now: new Date('2026-01-01') };

const examples = (): RepoSource[] =>
  ['shop-api', 'shop-web', 'platform'].map((name) => ({
    id: `acme/${name}`,
    dir: join(EXAMPLES, name),
  }));

describe('buildModel', () => {
  it('merges the example repos into one model', () => {
    const { model } = buildModel(examples(), OPTIONS);
    expect(model.modelVersion).toBe(1);
    expect(model.generatedAt).toBe('2026-01-01T00:00:00.000Z');
    expect(model.workspace).toEqual({ id: 'acme' });
    expect(model.projects.map((p) => [p.id, p.repos])).toEqual([
      ['platform', ['acme/platform']],
      ['shop', ['acme/shop-api', 'acme/shop-web']],
    ]);
    expect(model.repos.every((r) => r.status === 'valid')).toBe(true);
    expect(model.components.some((c) => c.ghost)).toBe(false);
    expect(model.issues).toEqual([]);
  });

  it('qualifies relations and resolves references across repos of the same project', () => {
    const { model } = buildModel(examples(), OPTIONS);
    expect(model.relations).toContainEqual({
      from: 'shop/storefront',
      to: 'shop/shop-api',
      type: 'calls',
      protocol: 'http',
      repo: 'acme/shop-web',
    });
  });

  it('inherits the manifest owner and keeps component owners', () => {
    const { model } = buildModel(examples(), OPTIONS);
    const byKey = new Map(model.components.map((c) => [c.key, c]));
    expect(byKey.get('platform/users-api')?.owner).toBe('team-platform');
    expect(byKey.get('platform/stripe')?.owner).toBe('team-payments');
  });

  it('embeds diagrams with their format and qualified components', () => {
    const { model } = buildModel(examples(), OPTIONS);
    const refund = model.diagrams.find((d) => d.file === 'diagrams/refund-sequence.md');
    expect(refund).toMatchObject({
      key: 'acme/shop-api:diagrams/refund-sequence.md',
      format: 'markdown',
      project: 'shop',
      components: ['shop/shop-api'],
    });
    expect(refund?.content).toContain('```mermaid');
    const checkout = model.diagrams.find((d) => d.file === 'diagrams/checkout-flow.mmd');
    expect(checkout?.components).toContain('platform/stripe');
  });

  it('turns unresolved references into ghosts and warns the referencing repo', () => {
    const repo = makeRepo(
      manifest(
        'version: 1\nproject: billing\nowner: t\ncomponents:\n  - id: api\n    type: service\nrelations:\n  - from: api\n    to: ledger/core\n    type: calls\n',
      ),
    );
    const { model } = buildModel([{ id: 'acme/billing', dir: repo }], OPTIONS);
    expect(model.components.find((c) => c.key === 'ledger/core')).toMatchObject({
      ghost: true,
      project: 'ledger',
      id: 'core',
    });
    expect(model.projects.find((p) => p.id === 'ledger')?.ghost).toBe(true);
    expect(model.issues).toMatchObject([
      { repo: 'acme/billing', severity: 'warning', code: 'unresolved-reference', line: 9 },
    ]);
    expect(model.repos[0]?.status).toBe('valid');
  });

  it('suggests the right component across repos', () => {
    const repo = makeRepo(
      manifest(
        'version: 1\nproject: billing\nowner: t\ncomponents:\n  - id: api\n    type: service\nrelations:\n  - from: api\n    to: platform/user-api\n    type: calls\n',
      ),
    );
    const { model } = buildModel([...examples(), { id: 'acme/billing', dir: repo }], OPTIONS);
    expect(model.issues[0]?.hint).toContain('Did you mean "platform/users-api"?');
  });

  it('leaves invalid repos out of the map and explains why', () => {
    const broken = makeRepo(
      manifest('version: 1\nproject: shop\ncomponents:\n  - id: cart\n    type: servce\n'),
    );
    const { model } = buildModel([...examples(), { id: 'acme/cart', dir: broken }], OPTIONS);
    expect(model.repos.find((r) => r.id === 'acme/cart')).toMatchObject({
      status: 'invalid',
      errors: 1,
    });
    expect(model.components.some((c) => c.key === 'shop/cart')).toBe(false);
    expect(
      model.issues.find((i) => i.repo === 'acme/cart' && i.severity === 'error'),
    ).toMatchObject({
      code: 'schema-invalid-value',
      file: '.architecture/architecture.yaml',
      line: 5,
    });
  });

  it('goes on with the other repos when one manifest is built to exhaust the parser', () => {
    const bomb = makeRepo(
      manifest(
        'version: 1\nproject: bomb\na: &a [x, x, x, x, x, x, x, x, x, x]\nb: &b [*a, *a, *a, *a, *a, *a, *a, *a, *a, *a]\nc: &c [*b, *b, *b, *b, *b, *b, *b, *b, *b, *b]\nd: [*c, *c, *c, *c, *c, *c, *c, *c, *c, *c]\n',
      ),
    );
    const { model } = buildModel([...examples(), { id: 'acme/bomb', dir: bomb }], OPTIONS);
    expect(model.repos.find((r) => r.id === 'acme/bomb')).toMatchObject({ status: 'invalid' });
    expect(model.repos.filter((r) => r.status === 'valid')).toHaveLength(3);
    expect(model.issues.find((i) => i.repo === 'acme/bomb')?.code).toBe('yaml-syntax');
  });

  it('never puts on the map what a symbolic link points to', () => {
    const secrets = mkdtempSync(join(tmpdir(), 'furio-outside-'));
    writeFileSync(join(secrets, 'env.mmd'), 'TOKEN=not-for-the-map');
    const repo = makeRepo(
      manifest(
        'version: 1\nproject: leak\nowner: t\ncomponents:\n  - id: api\n    type: service\ndiagrams:\n  - file: env.mmd\n    title: Env\n',
      ),
    );
    symlinkSync(join(secrets, 'env.mmd'), join(repo, '.architecture/env.mmd'));
    const { model } = buildModel([{ id: 'acme/leak', dir: repo }], OPTIONS);
    expect(JSON.stringify(model)).not.toContain('not-for-the-map');
    expect(model.diagrams).toEqual([]);
    expect(model.repos[0]).toMatchObject({ status: 'invalid' });
    expect(model.issues[0]?.code).toBe('symlink-not-followed');
  });

  it('rejects a component declared by two repos, keeping the first by repo id', () => {
    const copy = makeRepo(
      manifest(
        'version: 1\nproject: platform\nowner: t\ncomponents:\n  - id: users-api\n    type: service\n',
      ),
    );
    const { model } = buildModel([...examples(), { id: 'acme/zz-copy', dir: copy }], OPTIONS);
    expect(model.components.find((c) => c.key === 'platform/users-api')?.repo).toBe(
      'acme/platform',
    );
    expect(model.repos.find((r) => r.id === 'acme/zz-copy')?.status).toBe('invalid');
    expect(model.issues.find((i) => i.repo === 'acme/zz-copy')).toMatchObject({
      code: 'duplicate-component',
      message: 'Component "platform/users-api" is also declared by acme/platform.',
    });
  });

  it('lists skipped repos', () => {
    const { model } = buildModel(examples(), {
      ...OPTIONS,
      skipped: [
        { id: 'acme/legacy', url: 'https://github.com/acme/legacy', reason: 'no-manifest' },
      ],
    });
    expect(model.repos.find((r) => r.id === 'acme/legacy')).toMatchObject({
      status: 'skipped',
      skipReason: 'no-manifest',
    });
  });

  it('carries the 1.1 fields to the model, leaving out the default status', () => {
    const repo = makeRepo(
      manifest(
        'version: 1\nproject: desk\nowner: t\ncomponents:\n  - id: desktop\n    type: client\n    tech: tauri\n    path: apps/desktop/\n    host: customer-machine\n    status: active\n  - id: sim\n    type: job\n    status: dev-only\nrelations:\n  - from: desktop\n    to: sim\n    type: spawns\n',
      ),
    );
    const { model } = buildModel([{ id: 'acme/desk', dir: repo }], OPTIONS);
    expect(model.components[0]).toMatchObject({
      key: 'desk/desktop',
      type: 'client',
      tech: 'tauri',
      path: 'apps/desktop',
      host: 'customer-machine',
    });
    expect(model.components[0]).not.toHaveProperty('status');
    expect(model.components[1]).toMatchObject({ key: 'desk/sim', status: 'dev-only' });
    expect(model.relations[0]).toMatchObject({ type: 'spawns' });
  });

  it('carries critical: false to the model, leaving out the default', () => {
    const repo = makeRepo(
      manifest(
        'version: 1\nproject: shop\nowner: t\ncomponents:\n  - id: api\n    type: service\n  - id: db\n    type: database\n  - id: audit-log\n    type: storage\n  - id: collector\n    type: service\nrelations:\n  - from: api\n    to: audit-log\n    type: writes\n    critical: false\n  - from: api\n    to: db\n    type: reads_writes\n    critical: true\n  - from: collector\n    to: db\n    type: reads\n',
      ),
    );
    const { model } = buildModel([{ id: 'acme/shop', dir: repo }], OPTIONS);
    expect(model.relations[0]).toMatchObject({ to: 'shop/audit-log', critical: false });
    expect(model.relations[1]).not.toHaveProperty('critical');
    expect(model.relations[2]).not.toHaveProperty('critical');
  });
});
