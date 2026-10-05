import { join } from 'node:path';
import { buildModel } from '@getfurio/core';
import { describe, expect, it } from 'vitest';
import { codeUrl, facet, impact, indexModel, matchesFilter, revision, search } from '../src/model';
import {
  changeMarks,
  changeOptions,
  changeSummary,
  extensionArrange,
  extensionBadges,
  extensionCatalog,
  extensionNav,
  extensionHealth,
  extensionIcon,
  extensionSections,
  safeHref,
} from '../src/extensions';
import {
  arrangeAround,
  between,
  CARD,
  groupsOf,
  levelsAround,
  mostConnected,
  tiersOf,
  type Box,
} from '../src/graph/arrange';
import { readable } from '../src/graph/parts';
import { splitMarkdown } from '../src/markdown';
import {
  currentScope,
  flowOnly,
  href,
  inScope,
  linksIn,
  pageIn,
  parseHash,
  parseView,
  routeScope,
  serializeView,
} from '../src/router';
import { contents, mapWith, marksIn, projectScope } from '../src/scope';
import { makeRepo, manifest } from '../../core/test/helpers';

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

describe('non-critical relations', () => {
  // A made-up system: the shop keeps selling when its collector is down, the dashboards do not.
  const orders = indexModel(
    buildModel(
      [
        {
          id: 'acme/orders',
          dir: makeRepo(
            manifest(`version: 1
project: orders
owner: team-orders
components:
  - { id: storefront, type: frontend }
  - { id: orders-api, type: service }
  - { id: orders-db, type: database }
  - { id: collector, type: service }
  - { id: dashboards, type: frontend }
relations:
  - { from: storefront, to: orders-api, type: calls }
  - { from: orders-api, to: orders-db, type: reads_writes, critical: true }
  - { from: storefront, to: collector, type: calls, critical: false }
  - { from: orders-api, to: collector, type: calls, critical: false }
  - { from: collector, to: orders-db, type: reads }
  - { from: dashboards, to: collector, type: reads }
`),
          ),
        },
      ],
      { workspace: 'acme', generatorVersion: 'test', now: new Date('2026-01-01') },
    ).model,
  );
  const reached = (origin: string, direction: 'up' | 'down') =>
    Object.fromEntries(
      [...impact(orders, `orders/${origin}`, direction).distance]
        .filter(([, hops]) => hops > 0)
        .map(([key, hops]) => [key.replace('orders/', ''), hops]),
    );

  it('are not followed by the blast radius', () => {
    expect(reached('collector', 'up')).toEqual({ dashboards: 1 });
  });

  it('are not followed by what a component depends on', () => {
    expect(reached('storefront', 'down')).toEqual({ 'orders-api': 1, 'orders-db': 2 });
    expect(reached('orders-api', 'down')).toEqual({ 'orders-db': 1 });
  });

  it('leave the critical relations around them as they were', () => {
    expect(reached('orders-db', 'up')).toEqual({
      'orders-api': 1,
      collector: 1,
      storefront: 2,
      dashboards: 2,
    });
    expect(reached('dashboards', 'down')).toEqual({ collector: 1, 'orders-db': 2 });
    for (const direction of ['up', 'down'] as const)
      for (const key of orders.order)
        for (const r of impact(orders, key, direction).relations)
          expect(r.critical).toBeUndefined();
  });

  it('stay on the map and in the lists of their two ends', () => {
    expect(orders.outgoing.get('orders/storefront')).toHaveLength(2);
    expect(
      orders.incoming.get('orders/collector')!.filter((r) => r.critical === false),
    ).toHaveLength(2);
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

  it('keeps the arrangement in the link, and only what applies to it', () => {
    const around = parseView('sel=platform/users-api&arrange=around&around=platform/users-api');
    expect(around).toMatchObject({ arrange: 'around', around: 'platform/users-api' });
    expect(serializeView(around)).toBe(
      '?sel=platform/users-api&arrange=around&around=platform/users-api',
    );
    expect(serializeView(parseView('dir=down&group=host'))).toBe('?dir=down&group=host');
    expect(serializeView(parseView('arrange=tiers&dir=right'))).toBe('?arrange=tiers&dir=right');
    // Tiers have their own bands, and a map around a component has no direction.
    expect(parseView('arrange=tiers&group=host').group).toBeUndefined();
    expect(parseView('arrange=around&dir=down').dir).toBeUndefined();
    expect(parseView('around=platform/users-api').around).toBeUndefined();
    expect(parseView('arrange=spiral&dir=up&group=colour')).toEqual(parseView(''));
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

describe('project scope', () => {
  // A made-up workspace: a shop that calls billing and a payments project nobody declares, a repo
  // without a manifest and one whose manifest Furio cannot read.
  const acme = indexModel(
    buildModel(
      [
        {
          id: 'acme/shop-api',
          dir: makeRepo({
            ...manifest(`version: 1
project: shop
owner: team-shop
components:
  - { id: api, type: service, tech: node }
  - { id: db, type: database, tech: postgres }
relations:
  - { from: api, to: db, type: reads_writes }
  - { from: api, to: billing/invoices, type: calls }
  - { from: api, to: payments/gateway, type: calls }
diagrams:
  - { file: diagrams/checkout.mmd, title: Checkout, components: [api, billing/invoices] }
`),
            '.architecture/diagrams/checkout.mmd': 'flowchart LR\n  api --> invoices\n',
          }),
        },
        {
          id: 'acme/shop-web',
          dir: makeRepo(
            manifest(`version: 1
project: shop
components:
  - { id: web, type: frontend, tech: reactt }
relations:
  - { from: web, to: api, type: calls }
  - { from: web, to: search, type: calls }
`),
          ),
        },
        {
          id: 'acme/billing',
          dir: makeRepo({
            ...manifest(`version: 1
project: billing
owner: team-billing
components:
  - { id: invoices, type: service, tech: go }
  - { id: invoices-db, type: database, tech: postgrez }
  - { id: reports, type: job, status: deprecated }
relations:
  - { from: invoices, to: invoices-db, type: writes }
  - { from: reports, to: invoices-db, type: reads }
  - { from: invoices, to: tax, type: calls }
diagrams:
  - { file: diagrams/run.mmd, title: Billing run, components: [invoices] }
`),
            '.architecture/diagrams/run.mmd': 'flowchart LR\n  invoices --> db\n',
          }),
        },
        { id: 'acme/wiki', dir: makeRepo({ 'README.md': '# Wiki\n' }) },
        { id: 'acme/broken', dir: makeRepo(manifest('version: 1\nproject: [shop]\n')) },
      ],
      { workspace: 'acme', generatorVersion: 'test', now: new Date('2026-01-01') },
    ).model,
  );
  const shop = projectScope(acme, 'shop');
  const billing = projectScope(acme, 'billing');
  const keys = (list: { key: string }[]) => list.map((c) => c.key).sort();
  const withHash = (hash: string, fn: () => void) => {
    (globalThis as { window?: unknown }).window = { location: { hash } };
    try {
      fn();
    } finally {
      delete (globalThis as { window?: unknown }).window;
    }
  };

  it('puts on the map the project and the parts of other projects it touches, nothing more', () => {
    expect([...shop.own].sort()).toEqual(['shop/api', 'shop/db', 'shop/search', 'shop/web']);
    expect([...shop.map].sort()).toEqual([
      'billing/invoices',
      'payments/gateway',
      'shop/api',
      'shop/db',
      'shop/search',
      'shop/web',
    ]);
    // What billing does behind the part the shop calls stays out.
    for (const key of ['billing/invoices-db', 'billing/reports', 'billing/tax'])
      expect(shop.map.has(key)).toBe(false);
  });

  it('lists in the catalog the components of the project only', () => {
    expect(keys(contents(acme, shop).components)).toEqual(['shop/api', 'shop/db', 'shop/web']);
    expect(keys(contents(acme, billing).components)).toEqual([
      'billing/invoices',
      'billing/invoices-db',
      'billing/reports',
    ]);
    expect(contents(acme).components).toHaveLength(6);
  });

  it('keeps on the health page the repos, issues and ghosts of the project', () => {
    const page = contents(acme, shop);
    expect(page.repos.map((r) => r.id).sort()).toEqual(['acme/shop-api', 'acme/shop-web']);
    expect(page.issues.length).toBeGreaterThan(0);
    expect(new Set(page.issues.map((i) => i.repo))).toEqual(
      new Set(['acme/shop-api', 'acme/shop-web']),
    );
    // The ghosts on its map: its own, and the undeclared parts it calls; not billing's.
    expect(keys(page.ghosts)).toEqual(['payments/gateway', 'shop/search']);
    expect(keys(contents(acme, billing).ghosts)).toEqual(['billing/tax']);
    // The repos in no project are the workspace's: counted, never listed in a scope.
    expect(page.unassigned).toBe(2);
    expect(page.repos.some((r) => !r.project)).toBe(false);
    const all = contents(acme);
    expect(all.repos).toHaveLength(5);
    expect(all.issues.some((i) => i.repo === 'acme/billing')).toBe(true);
    expect(keys(all.ghosts)).toEqual(['billing/tax', 'payments/gateway', 'shop/search']);
  });

  it('shows on the diagrams page the diagrams of the project only', () => {
    expect(contents(acme, shop).diagrams.map((d) => d.title)).toEqual(['Checkout']);
    expect(contents(acme, billing).diagrams.map((d) => d.title)).toEqual(['Billing run']);
    expect(contents(acme).diagrams).toHaveLength(2);
  });

  it('searches and offers filter values among the parts on its map', () => {
    const found = (query: string) => search(acme, query, 12, shop.map).map((h) => h.component.key);
    expect(found('invoices')).toEqual(['billing/invoices']);
    expect(found('db')).toEqual(['shop/db']);
    expect(facet(acme, 'tech', shop.map).map((f) => f.value)).toEqual([
      'go',
      'node',
      'postgres',
      'reactt',
    ]);
    expect(facet(acme, 'tech').map((f) => f.value)).toContain('postgrez');
  });

  it('counts in the Changes banner only what is on its map', () => {
    const marks = {
      label: 'Last 7 days',
      components: { 'shop/api': 'changed', 'billing/reports': 'added' } as const,
      removed: ['shop/cart', 'billing/old'],
      relations: { added: 2, removed: 0 },
    };
    expect(marksIn(marks, shop)).toEqual({
      label: 'Last 7 days',
      components: { 'shop/api': 'changed' },
      removed: ['shop/cart'],
      relations: { added: 2, removed: 0 },
    });
  });

  it('keeps the scope in the URL of every page', () => {
    expect(parseHash('#/p/shop')).toMatchObject({ name: 'project', project: 'shop' });
    expect(parseHash('#/p/shop/catalog?type=database&q=pg')).toEqual({
      name: 'catalog',
      type: 'database',
      q: 'pg',
      scope: 'shop',
    });
    expect(parseHash('#/p/shop/health')).toEqual({ name: 'health', scope: 'shop' });
    expect(parseHash('#/p/shop/diagrams?d=acme/shop-api:diagrams/checkout.mmd')).toEqual({
      name: 'diagrams',
      diagram: 'acme/shop-api:diagrams/checkout.mmd',
      scope: 'shop',
    });
    expect(parseHash('#/p/shop/c/billing/invoices')).toEqual({
      name: 'component',
      key: 'billing/invoices',
      scope: 'shop',
    });
    const to = linksIn('shop');
    for (const link of [
      to.map(),
      to.map({ sel: 'shop/api', mode: 'impact' }),
      to.catalog('service', 'node'),
      to.health(),
      to.diagrams('acme/shop-api:diagrams/checkout.mmd'),
      to.component('billing/invoices'),
    ])
      expect(routeScope(parseHash(link))).toBe('shop');
    expect(to.map({ sel: 'shop/api', mode: 'impact' })).toBe('#/p/shop?sel=shop/api&mode=impact');
    expect(to.catalog('service')).toBe('#/p/shop/catalog?type=service');
  });

  it('opens the links made before it as they were, without a scope', () => {
    expect(parseHash('#/?sel=shop/api&mode=impact')).toEqual({
      name: 'workspace',
      view: { sel: 'shop/api', mode: 'impact', depth: 0, filter: {} },
    });
    expect(parseHash('#/p/shop?type=service&only=1')).toEqual({
      name: 'project',
      project: 'shop',
      view: { mode: 'nets', depth: 0, filter: { type: ['service'] }, only: true },
    });
    for (const hash of ['#/', '#/catalog?type=service', '#/health', '#/diagrams', '#/c/shop/api'])
      expect(routeScope(parseHash(hash))).toBeUndefined();
    expect(href.catalog('service')).toBe('#/catalog?type=service');
    expect(currentScope()).toBeUndefined();
  });

  it('carries the scope from page to page, and leaves it with what the page shows', () => {
    withHash('#/p/shop/catalog?type=database', () => {
      expect(currentScope()).toBe('shop');
      expect(href.health()).toBe('#/p/shop/health');
      expect(href.component('billing/invoices')).toBe('#/p/shop/c/billing/invoices');
      expect(href.map()).toBe('#/p/shop');
      // A map link from an extension stays in the scope; other links are left alone.
      expect(inScope('#/c/shop/api')).toBe('#/p/shop/c/shop/api');
      expect(inScope('#/?sel=shop/api')).toBe('#/p/shop?sel=shop/api');
      expect(inScope('#/')).toBe('#/p/shop');
      expect(inScope('#/p/billing')).toBe('#/p/billing');
      expect(inScope('https://example.com/#/c/x')).toBe('https://example.com/#/c/x');
      // Show on the map: the scope's map when the part is on it, the workspace's otherwise.
      expect(mapWith(acme, 'billing/invoices')).toBe('#/p/shop?sel=billing/invoices');
      expect(mapWith(acme, 'billing/invoices-db', { mode: 'impact' })).toBe(
        '#/?sel=billing/invoices-db&mode=impact',
      );
    });
    // Leaving keeps what the page shows; another project keeps the page.
    const catalog = parseHash('#/p/shop/catalog?type=database&q=pg');
    expect(pageIn(catalog)).toBe('#/catalog?type=database&q=pg');
    expect(pageIn(catalog, 'billing')).toBe('#/p/billing/catalog?type=database&q=pg');
    const map = parseHash('#/p/shop?sel=shop/api&mode=impact');
    expect(pageIn(map)).toBe('#/?sel=shop/api&mode=impact');
    expect(pageIn(map, 'billing')).toBe('#/p/billing');
    expect(pageIn(parseHash('#/p/shop/c/shop/api'))).toBe('#/c/shop/api');
    expect(pageIn(parseHash('#/p/shop/c/shop/api'), 'billing')).toBe('#/p/billing');
    expect(pageIn(parseHash('#/p/shop/diagrams?d=x'))).toBe('#/diagrams?d=x');
    expect(pageIn(parseHash('#/health'), 'shop')).toBe('#/p/shop/health');
  });

  it('tells the extensions which project the page is scoped to', async () => {
    const seen: unknown[] = [];
    (globalThis as { window?: unknown }).window = {
      furioExtensions: {
        health: (context: { project?: string }) => (seen.push(context.project), []),
        catalog: (context: { project?: string }) => (
          seen.push(context.project),
          { columns: [], cells: {} }
        ),
        changes: (context: { project?: string }) => (
          seen.push(context.project),
          { label: 'x', components: {} }
        ),
      },
    };
    try {
      await extensionHealth(acme.model, 'shop');
      await extensionCatalog(acme.model, 'shop');
      await changeMarks('7', acme.model, 'shop');
      await extensionHealth(acme.model);
      expect(seen).toEqual(['shop', 'shop', 'shop', undefined]);
    } finally {
      delete (globalThis as { window?: unknown }).window;
    }
  });
});

describe('arranging the map', () => {
  const { components, relations } = site.model;

  it('gathers the boards of the flow by project, owner, host or type', () => {
    expect(groupsOf(components, 'project').map((g) => [g.label, g.project])).toEqual([
      ['platform', 'platform'],
      ['shop', 'shop'],
    ]);
    expect(groupsOf(components, 'owner').map((g) => [g.label, g.members.length])).toEqual([
      ['team-payments', 1],
      ['team-platform', 3],
      ['team-shop', 4],
      ['team-shop-web', 1],
    ]);
    const types = groupsOf(components, 'type');
    expect(types.find((g) => g.label === 'Services')?.members).toHaveLength(3);
    expect(types.every((g) => g.project === undefined)).toBe(true);
    // What has no value closes the list, and what no repo declares comes after it.
    const ghost = { ...components[0]!, key: 'x/ghost', ghost: true, owner: undefined };
    const loose = { ...components[0]!, key: 'x/loose', owner: undefined };
    expect(
      groupsOf([ghost, loose, ...components], 'owner')
        .map((g) => g.label)
        .slice(-2),
    ).toEqual(['No owner', 'Not declared']);
  });

  it('puts the tiers in the order of the classic picture, without the empty ones', () => {
    expect(tiersOf(components).map((t) => [t.label, t.members.length])).toEqual([
      ['Entry points', 1],
      ['Services', 4],
      ['Messaging', 1],
      ['Data', 2],
      ['External', 1],
    ]);
  });

  it('arranges the map around a component: what uses it on the left, what it uses on the right', () => {
    expect(mostConnected(components, relations)).toBe('platform/users-api');
    const around = arrangeAround(components, relations, 'platform/users-api');
    const x = (key: string) => around.at.get(key)!.x;
    expect([...around.at.keys()].sort()).toEqual([
      'platform/email',
      'platform/users-api',
      'platform/users-db',
      'shop/shop-api',
      'shop/storefront',
    ]);
    expect(Math.max(x('shop/shop-api'), x('shop/storefront'))).toBeLessThan(
      x('platform/users-api'),
    );
    expect(Math.min(x('platform/email'), x('platform/users-db'))).toBeGreaterThan(
      x('platform/users-api'),
    );
    expect(around).toMatchObject({ usedBy: 2, dependsOn: 2, hidden: 4 });
    expect(around.rings).toEqual([expect.objectContaining({ parts: 4 })]);
  });

  it('stacks the map for narrow screens: what uses the centre above, what it uses below', () => {
    const { levels, hidden } = levelsAround(components, relations, 'shop/shop-api');
    expect(levels.map((level) => [level.label, level.kind, level.members.length])).toEqual([
      ['Used by · 1 hop', 'level', 1],
      ['Centre', 'centre', 1],
      ['Depends on · 1 hop', 'level', 4],
      ['Depends on · 2 hops', 'level', 2],
    ]);
    expect(hidden).toBe(1);
    // The farthest of what uses the centre comes first: the stack reads down the chain.
    const chain = levelsAround(components, relations, 'platform/users-db').levels;
    expect(chain.map((level) => level.id)).toEqual(['before:2', 'before:1', 'centre']);
    // Inside a level too: the storefront calls the shop API, and both use the users API.
    const users = levelsAround(components, relations, 'platform/users-api').levels[0]!;
    expect(users.members.map((c) => c.key)).toEqual(['shop/storefront', 'shop/shop-api']);
    // The same parts as the rings, whichever way the map is drawn.
    const rings = arrangeAround(components, relations, 'shop/shop-api');
    expect(levels.flatMap((level) => level.members.map((c) => c.key)).sort()).toEqual(
      [...rings.at.keys()].sort(),
    );
  });

  it('says what a view around a component can open on, from the whole map to the centre', () => {
    const around = arrangeAround(components, relations, 'shop/shop-api');
    const [whole, cards, near, centre] = around.frames;
    const inside = (inner: Box, outer: Box) =>
      inner.x >= outer.x &&
      inner.y >= outer.y &&
      inner.x + inner.width <= outer.x + outer.width &&
      inner.y + inner.height <= outer.y + outer.height;
    expect(inside(cards!, whole!)).toBe(true);
    expect(inside(near!, cards!)).toBe(true);
    expect(centre).toEqual({ ...around.at.get('shop/shop-api')!, ...CARD });
    // The cards two hops away are on one side only: framing the cards alone is narrower.
    expect(cards!.width).toBeLessThan(whole!.width - CARD.width);
    for (const [key, at] of around.at) expect(inside({ ...at, ...CARD }, cards!), key).toBe(true);
  });

  it('keeps the cards of every ring apart, however many there are', () => {
    // A hub used by thirty parts, each used by two more.
    const part = (key: string) => ({ ...components[0]!, key, id: key, ghost: false });
    const users = Array.from({ length: 30 }, (_, i) => `a/u${i}`);
    const outer = users.flatMap((u) => [`${u}x`, `${u}y`]);
    const all = ['a/hub', ...users, ...outer].map(part);
    const rel = (from: string, to: string) => ({ ...relations[0]!, from, to });
    const around = arrangeAround(
      all,
      [...users.map((u) => rel(u, 'a/hub')), ...outer.map((o) => rel(o, o.slice(0, -1)))],
      'a/hub',
    );
    expect(around.at.size).toBe(all.length);
    const boxes = [...around.at.values()];
    const overlap = boxes.some((p, i) =>
      boxes.some(
        (q, j) => j > i && Math.abs(p.x - q.x) < CARD.width && Math.abs(p.y - q.y) < CARD.height,
      ),
    );
    expect(overlap).toBe(false);
    expect(Math.min(...boxes.map((p) => Math.min(p.x, p.y)))).toBeGreaterThanOrEqual(0);
  });

  it('draws a straight line from the edge of a card to the edge of the other', () => {
    const a = { x: 0, y: 0, ...CARD };
    const line = between(a, { x: 400, y: 0, ...CARD });
    expect(line.from).toEqual({ x: 216, y: 38, side: 'right' });
    expect(line.to).toEqual({ x: 400, y: 38, side: 'left' });
    expect(between(a, { x: 0, y: 300, ...CARD }).to).toMatchObject({ y: 300, side: 'top' });
    // Two relations between the same cards run side by side.
    expect(between(a, { x: 400, y: 0, ...CARD }, 6).from.y).toBe(44);
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

  it('offers the other arrangements of the map only when the host says so', async () => {
    expect(extensionArrange()).toBe(false);
    await withExtensions({ arrange: 'yes' }, () => expect(extensionArrange()).toBe(false));
    await withExtensions({ arrange: true }, () => expect(extensionArrange()).toBe(true));
    // Without them a link keeps the rest of its view and opens on the flow.
    const link = parseView('sel=shop/shop-api&mode=impact&type=service&arrange=tiers&dir=right');
    expect(serializeView(flowOnly(link))).toBe('?sel=shop/shop-api&mode=impact&type=service');
    expect(flowOnly(parseView('arrange=around&around=shop/shop-api'))).toEqual(parseView(''));
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

  it('takes card badges from the extension, as plain short text', async () => {
    expect(await extensionBadges(site.model)).toEqual({});
    await withExtensions(
      {
        badges: async () => ({
          'shop/shop-api': {
            label: 'Incident',
            tone: 'error',
            detail: 'Stripe reports elevated API errors.',
          },
          'shop/storefront': { label: 'A label that goes on and on', tone: 'red', detail: 7 },
          'shop/worker': { label: '  ' },
          'shop/db': null,
        }),
      },
      async () => {
        expect(await extensionBadges(site.model)).toEqual({
          'shop/shop-api': {
            label: 'Incident',
            tone: 'error',
            detail: 'Stripe reports elevated API errors.',
          },
          'shop/storefront': { label: 'A label that goes o…' },
        });
      },
    );
    await withExtensions(
      {
        badges: () => {
          throw new Error('boom');
        },
      },
      async () => expect(await extensionBadges(site.model)).toEqual({}),
    );
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

  it('says in the banner what changed, relations that changed included', () => {
    expect(
      changeSummary({
        label: 'Last 7 days',
        components: { 'shop/shop-api': 'added', 'shop/storefront': 'changed' },
        removed: ['shop/legacy'],
        relations: { added: 2, removed: 1, changed: 1 },
      }),
    ).toEqual([
      '1 added',
      '1 changed',
      '1 removed',
      '+2 relations',
      '−1 relations',
      '1 relation changed',
    ]);
    // A period in which relations only became non-critical (or critical again) is a change.
    expect(
      changeSummary({
        label: 'Last change',
        components: {},
        relations: { added: 0, removed: 0, changed: 2 },
      }),
    ).toEqual(['2 relations changed']);
    expect(changeSummary({ label: 'Last 7 days', components: {} })).toEqual([]);
    expect(changeSummary(undefined)).toEqual([]);
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
