import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ManifestSchema, manifestJsonSchema, SCHEMA_ID } from '../src/index.js';

describe('manifest schema', () => {
  it('keeps the committed JSON Schema in sync with the Zod schema', () => {
    const committed = JSON.parse(
      readFileSync(new URL('../schema/v1.json', import.meta.url), 'utf8'),
    ) as unknown;
    // Run `pnpm --filter @getfurio/schema build` to regenerate it.
    expect(committed).toEqual(manifestJsonSchema());
  });

  it('publishes the schema under its stable id', () => {
    expect(manifestJsonSchema().$id).toBe(SCHEMA_ID);
  });

  it('defaults relations and diagrams to empty lists', () => {
    const parsed = ManifestSchema.parse({ version: 1, project: 'shop', components: [] });
    expect(parsed.relations).toEqual([]);
    expect(parsed.diagrams).toEqual([]);
  });

  it('accepts cross-project references and rejects malformed ones', () => {
    const base = {
      version: 1,
      project: 'shop',
      components: [{ id: 'api', type: 'service' }],
    };
    const relation = (to: string) => ({
      ...base,
      relations: [{ from: 'api', to, type: 'calls' }],
    });
    expect(ManifestSchema.safeParse(relation('platform/users-api')).success).toBe(true);
    expect(ManifestSchema.safeParse(relation('a/b/c')).success).toBe(false);
    expect(ManifestSchema.safeParse(relation('Users API')).success).toBe(false);
  });

  it('accepts the 1.1 fields, types and relations, all optional', () => {
    const parsed = ManifestSchema.safeParse({
      version: 1,
      project: 'desk',
      closed: true,
      components: [
        {
          id: 'desktop',
          type: 'client',
          tech: 'tauri',
          path: 'apps/desktop',
          host: 'customer-machine',
        },
        { id: 'engine', type: 'service', tech: 'node', path: 'apps/server', status: 'active' },
        { id: 'nginx', type: 'proxy', tech: 'nginx', host: 'vps-1' },
        { id: 'example-com', type: 'domain', name: 'example.com' },
        { id: 'simulator', type: 'job', status: 'dev-only' },
        { id: 'db', type: 'database', tech: 'mariadb' },
      ],
      relations: [
        { from: 'desktop', to: 'engine', type: 'spawns' },
        { from: 'engine', to: 'db', type: 'reads_writes' },
        { from: 'example-com', to: 'nginx', type: 'serves' },
        { from: 'nginx', to: 'engine', type: 'serves' },
      ],
    });
    expect(parsed.success).toBe(true);
  });

  it('accepts critical on a relation, as a boolean and optional', () => {
    const withRelation = (extra: object) => ({
      version: 1,
      project: 'shop',
      components: [
        { id: 'api', type: 'service' },
        { id: 'audit-log', type: 'storage' },
      ],
      relations: [{ from: 'api', to: 'audit-log', type: 'writes', ...extra }],
    });
    for (const extra of [{}, { critical: false }, { critical: true }])
      expect(ManifestSchema.safeParse(withRelation(extra)).success).toBe(true);
    expect(ManifestSchema.safeParse(withRelation({ critical: 'no' })).success).toBe(false);
  });

  it('rejects paths that leave the repo and statuses it does not know', () => {
    const withComponent = (extra: object) => ({
      version: 1,
      project: 'desk',
      components: [{ id: 'a', type: 'service', ...extra }],
    });
    for (const path of ['../x', '/etc', 'a/../b', './a'])
      expect(ManifestSchema.safeParse(withComponent({ path })).success).toBe(false);
    expect(ManifestSchema.safeParse(withComponent({ status: 'retired' })).success).toBe(false);
    expect(ManifestSchema.safeParse(withComponent({ tech: 'Node JS' })).success).toBe(false);
  });
});
