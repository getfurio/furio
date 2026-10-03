import { join } from 'node:path';
import { buildModel } from '@getfurio/core';
import { describe, expect, it } from 'vitest';
import { codeUrl, facet, impact, indexModel, matchesFilter, revision, search } from '../src/model';
import {
  changeMarks,
  changeOptions,
  extensionCatalog,
  extensionNav,
  extensionHealth,
  extensionIcon,
  extensionSections,
  safeHref,
} from '../src/extensions';
import { readable } from '../src/graph/parts';
import { splitMarkdown } from '../src/markdown';
import { href, parseHash, parseView, serializeView } from '../src/router';

const EXAMPLES = join(import.meta.dirname, '../../../examples/demo');
const site = indexModel(
  buildModel(
    ['shop-api', 'shop-web', 'platform'].map((name) => ({
      id: `acme/${name}`,
      dir: join(EXAMPLES, name),
    })),
    { workspace: 'acme', generatorVersion: 'test', now: new Date('2026-01-01') },
  ).model,
);

describe('impact', () => {
  it('lists who is affected when a component goes down, transitively', () => {
    const { distance } = impact(site, 'platform/users-api', 'up');
    expect(Object.fromEntries(distance)).toEqual({
      'platform/users-api': 0,
      'shop/shop-api': 1,
      'shop/storefront': 1,
    });
  });

  it('lists what a component needs, and stops at the requested depth', () => {
    const all = impact(site, 'shop/storefront', 'down');
    expect(all.distance.get('platform/users-db')).toBe(2);
    const one = impact(site, 'shop/storefront', 'down', 1);
    expect([...one.distance.keys()].sort()).toEqual([
      'platform/users-api',
      'shop/shop-api',
      'shop/storefront',
    ]);
  });

  it('treats consumers as depending on their queue', () => {
    const { distance } = impact(site, 'shop/orders-events', 'up');
    expect(distance.get('shop/invoice-worker')).toBe(1);
  });
});

describe('site helpers', () => {
  it('gives designators per project and type', () => {
    expect(site.designator.get('shop/shop-api')).toBe('SVC1');
    expect(site.designator.get('platform/users-db')).toBe('DB1');
  });

  it('searches by id, owner and type', () => {
    expect(search(site, 'users api')[0]?.component.key).toBe('platform/users-api');
    expect(search(site, 'team-platform').map((h) => h.component.project)).toContain('platform');
  });

  it('lists filter values with counts, most common first', () => {
    expect(facet(site, 'provider').map((f) => f.value)).toContain('aws.sqs');
    const types = facet(site, 'type');
    expect(types[0]!.count).toBeGreaterThanOrEqual(types.at(-1)!.count);
    expect(facet(site, 'status')).toEqual([{ value: 'active', count: 9 }]);
  });

  it('matches OR within a facet and AND across facets, never ghosts', () => {
    const api = site.byKey.get('shop/shop-api')!;
    expect(matchesFilter(api, { type: ['service', 'database'] })).toBe(true);
    expect(matchesFilter(api, { type: ['service'], owner: ['nobody'] })).toBe(false);
    expect(matchesFilter(api, {})).toBe(true);
    const ghost = site.model.components.find((c) => c.ghost);
    if (ghost) expect(matchesFilter(ghost, { status: ['active'] })).toBe(false);
  });

  it('marks a model built from folders as local', () => {
    expect(revision(site.model)).toBe('local');
  });
});

describe('router', () => {
  it('round-trips a shared view', () => {
    const view = parseView(
      'sel=shop/shop-db&mode=impact&depth=2&owner=team-shop&type=service,database&only=1',
    );
    expect(view).toEqual({
      sel: 'shop/shop-db',
      mode: 'impact',
      depth: 2,
      filter: { owner: ['team-shop'], type: ['service', 'database'] },
      only: true,
    });
    expect(serializeView(view)).toBe(
      '?sel=shop/shop-db&mode=impact&depth=2&type=service,database&owner=team-shop&only=1',
    );
  });

  it('parses routes and keeps the old repos link working', () => {
    expect(parseHash('#/c/shop/shop-api')).toEqual({ name: 'component', key: 'shop/shop-api' });
    expect(parseHash('#/repos')).toEqual({ name: 'health' });
    expect(parseHash('#/p/shop?type=service')).toMatchObject({
      name: 'project',
      project: 'shop',
      view: { filter: { type: ['service'] } },
    });
  });

  it('routes the catalog, with a type and a search', () => {
    expect(parseHash('#/catalog')).toEqual({ name: 'catalog' });
    expect(parseHash(href.catalog('database', 'maria db'))).toEqual({
      name: 'catalog',
      type: 'database',
      q: 'maria db',
    });
  });

  it('routes the diagrams page, scrolled to one diagram', () => {
    expect(parseHash('#/diagrams')).toEqual({ name: 'diagrams' });
    const key = 'acme/shop-api:diagrams/checkout-flow.mmd';
    expect(parseHash(href.diagrams(key))).toEqual({ name: 'diagrams', diagram: key });
  });

  it('ignores bad modes and depths', () => {
    expect(parseView('mode=nope&depth=-3&only=1')).toEqual({ mode: 'nets', depth: 0, filter: {} });
  });
});

describe('extensions', () => {
  const component = site.byKey.get('shop/shop-api')!;
  const withExtensions = async (ext: unknown, fn: () => Promise<void> | void) => {
    (globalThis as { window?: unknown }).window = { furioExtensions: ext };
    try {
      await fn();
    } finally {
      delete (globalThis as { window?: unknown }).window;
    }
  };

  it('works without any extension', async () => {
    expect(extensionIcon(component)).toBeUndefined();
    expect(await extensionSections(component, site.model)).toEqual([]);
  });

  it('takes icons and panel sections from window.furioExtensions', async () => {
    await withExtensions(
      {
        iconFor: (c: { id: string }) => `./icons/${c.id}.svg`,
        panel: async () => [{ title: 'Last upload', items: [{ label: 'Commit', value: 'abc' }] }],
      },
      async () => {
        expect(extensionIcon(component)).toEqual({ src: './icons/shop-api.svg' });
        expect(await extensionSections(component, site.model)).toEqual([
          { title: 'Last upload', items: [{ label: 'Commit', value: 'abc' }] },
        ]);
      },
    );
  });

  it('takes a brand colour with the icon, and paints it only where it stands out', async () => {
    await withExtensions(
      { iconFor: () => ({ src: 'data:image/svg+xml,x', color: '#635BFF' }) },
      () => {
        expect(extensionIcon(component)).toEqual({ src: 'data:image/svg+xml,x', color: '#635BFF' });
      },
    );
    await withExtensions({ iconFor: () => ({ src: './a.svg', color: 'red;}' }) }, () => {
      expect(extensionIcon(component)).toEqual({ src: './a.svg' });
    });
    expect(readable('#000000', 'dark')).toBe(false);
    expect(readable('#000000', 'light')).toBe(true);
    expect(readable('#FFFFFF', 'light')).toBe(false);
    expect(readable('#635BFF', 'dark')).toBe(true);
  });

  it('takes sidebar links and catalog columns from the extension, safe ones only', async () => {
    expect(await extensionNav(site.model)).toEqual([]);
    await withExtensions(
      {
        nav: () => [
          { label: 'Workspace', href: '/app/w/acme', icon: 'settings' },
          { label: 'Evil', href: 'javascript:alert(1)' },
          { label: 'Elsewhere', href: '//evil.test' },
        ],
        catalog: () => ({ columns: [{ id: 'exp', label: 'Expires' }], cells: {} }),
      },
      async () => {
        expect((await extensionNav(site.model)).map((l) => l.label)).toEqual(['Workspace']);
        expect((await extensionCatalog(site.model))?.columns).toEqual([
          { id: 'exp', label: 'Expires' },
        ]);
      },
    );
  });

  it('adds health sections from the extension', async () => {
    expect(await extensionHealth(site.model)).toEqual([]);
    await withExtensions({ health: () => [{ title: 'Domains', items: [] }, null] }, async () => {
      expect(await extensionHealth(site.model)).toEqual([{ title: 'Domains', items: [] }]);
    });
  });

  it('offers the Changes view only with an extension that implements it', async () => {
    expect(changeOptions()).toEqual([]);
    expect(await changeMarks('7', site.model)).toBeUndefined();
    const marks = { label: 'Last 7 days', components: { 'shop/shop-api': 'added' } };
    await withExtensions(
      { changeOptions: [{ value: '7', label: 'Last 7 days' }], changes: async () => marks },
      async () => {
        expect(changeOptions()).toEqual([{ value: '7', label: 'Last 7 days' }]);
        expect(await changeMarks('7', site.model)).toEqual(marks);
      },
    );
    expect(parseView('since=7').since).toBe('7');
    expect(parseView('since=<script>').since).toBeUndefined();
    expect(serializeView({ mode: 'nets', depth: 0, filter: {}, since: 'last' })).toBe(
      '?since=last',
    );
  });

  it('ignores unsafe or failing extensions', async () => {
    await withExtensions(
      {
        iconFor: () => 'javascript:alert(1)',
        panel: () => {
          throw new Error('boom');
        },
      },
      async () => {
        expect(extensionIcon(component)).toBeUndefined();
        expect(await extensionSections(component, site.model)).toEqual([]);
      },
    );
    expect(safeHref('javascript:alert(1)')).toBeUndefined();
    expect(safeHref('#/c/shop/shop-api')).toBe('#/c/shop/shop-api');
    expect(safeHref('https://github.com/acme/a/commit/abc')).toBe(
      'https://github.com/acme/a/commit/abc',
    );
  });
});

describe('codeUrl', () => {
  it('links a component path to its folder on GitHub, at the uploaded commit', () => {
    const model = structuredClone(site.model);
    model.repos = model.repos.map((r) =>
      r.id === 'acme/shop-api'
        ? { ...r, url: 'https://github.com/acme/shop-api', commit: 'abc1234' }
        : r,
    );
    const local = indexModel(model);
    const api = { ...local.byKey.get('shop/shop-api')!, path: 'apps/api' };
    expect(codeUrl(local, api)).toBe('https://github.com/acme/shop-api/tree/abc1234/apps/api');
    expect(codeUrl(local, { ...api, path: undefined })).toBeUndefined();
    expect(codeUrl(site, api)).toBeUndefined(); // no repo URL
  });

  it('keeps the address of a repo only if it is a web address: the map links to it', () => {
    const model = structuredClone(site.model);
    const urls = ['javascript:alert(1)', 'https://github.com/acme/shop-api', '//example.com'];
    model.repos = model.repos.map((r, i) => ({ ...r, url: urls[i]! }));
    expect(indexModel(model).model.repos.map((r) => r.url)).toEqual([
      undefined,
      'https://github.com/acme/shop-api',
      undefined,
    ]);
  });
});

describe('markdown diagrams', () => {
  it('splits prose and mermaid blocks, in order', () => {
    expect(
      splitMarkdown(
        '# Refund\n\nIntro.\n\n```mermaid\ngraph LR\n  a-->b\n```\n\nBetween.\n~~~ mermaid\nsequenceDiagram\n~~~  \nEnd',
      ),
    ).toEqual([
      { kind: 'md', text: '# Refund\n\nIntro.\n\n' },
      { kind: 'mermaid', text: 'graph LR\n  a-->b\n' },
      { kind: 'md', text: '\nBetween.\n' },
      { kind: 'mermaid', text: 'sequenceDiagram\n' },
      { kind: 'md', text: 'End' },
    ]);
  });

  it('leaves other code blocks and unclosed fences to the prose', () => {
    const code = '```js\nconst a = 1;\n```\n';
    expect(splitMarkdown(code)).toEqual([{ kind: 'md', text: code }]);
    const open = 'Text\n```mermaid\ngraph LR\n';
    expect(splitMarkdown(open)).toEqual([{ kind: 'md', text: open }]);
    // A ~~~ line does not close a ``` block.
    expect(splitMarkdown('```mermaid\na\n~~~\nb\n```\n')).toEqual([
      { kind: 'mermaid', text: 'a\n~~~\nb\n' },
    ]);
    expect(splitMarkdown('```mermaid\r\ngraph LR\r\n```\r\n')).toEqual([
      { kind: 'mermaid', text: 'graph LR\r\n' },
    ]);
  });

  it('takes a time that grows with the size of the file', () => {
    const start = performance.now();
    expect(splitMarkdown('```mermaid\nA-->B\n'.repeat(60_000))).toHaveLength(1);
    // Quadratic, it took half a minute and froze the page; linear, a few milliseconds.
    expect(performance.now() - start).toBeLessThan(3000);
  });
});

describe('catalog CSV', () => {
  it('quotes cells and defuses formulas', async () => {
    const { csvCell } = await import('../src/views/CatalogPage');
    expect(csvCell('shop "api"')).toBe('"shop ""api"""');
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell('-2+3')).toBe(`"'-2+3"`);
  });
});
