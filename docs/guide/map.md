# Reading the map

The map shows every component of your workspace and what depends on what.

This page starts from the questions people bring to it, then goes through each part of the
screen. Every example opens on the [live demo](https://furio-demo.github.io/catalog/), a small
shop of three repos.

## Questions the map answers

### What breaks if this goes down?

Click the card, then **Blast radius** in the panel. Every part that stops working with it lights
up, with how many hops away it is.

On the demo, if `users-db` goes down, three parts go with it: the Users API, the Shop API and
the storefront.
[See it](https://furio-demo.github.io/catalog/#/?sel=platform/users-db&mode=impact).

Ask it before maintenance on a database, during an incident, or to see how far a risky change
can reach. **Depth** stops it after a number of hops. It does not follow
[non-critical relations](manifest.md#telemetry-logs-and-analytics) such as telemetry and logs.

### What does this need to work?

**Depends on** lights everything the component needs, directly or through other parts. It is the
list of suspects when something is slow or failing.

On the demo, the storefront needs seven parts.
[See it](https://furio-demo.github.io/catalog/#/?sel=shop/storefront&mode=depends).

### Who owns what?

**Catalog** lists every component in a table: a tab per type, a search over every field,
sortable columns, and a menu per field (project, owner, tech, host, provider, status, tag). Pick
an owner to see what a team answers for, then download the rows as CSV for an audit or an
on-call review.

On the demo, the platform team owns three components.
[See them](https://furio-demo.github.io/catalog/#/catalog?owner=team-platform).

### What runs on this server? Where are all our databases?

**Filter**, at the top left of the map (on phones, behind the Filter button), takes a host, a
technology, a team, a type, a provider or a status, and shows how many parts have each value.
Matching cards stay lit and the rest are dimmed; **Only these** hides the rest and
lays the map out again.

Values of the same kind add up: tech `node` or `nginx`. Different kinds narrow down: tech `node`
and host `vps-1`.
[Every database of the demo](https://furio-demo.github.io/catalog/#/?type=database&only=1).

### Is anything broken or missing?

**Health** lists what needs a look: repos whose manifest is invalid, repos without a manifest,
references that no repo declares, components without an owner, deprecated and dev-only
components, and every issue Furio found.
[The demo's health](https://furio-demo.github.io/catalog/#/health).

### How does it work, step by step?

The graph shows who depends on whom; diagrams show the order of things. **Diagrams** shows every
diagram of the workspace, with a search and a menu by project. Each one also appears on the
pages of the components it describes.
[The demo's diagrams](https://furio-demo.github.io/catalog/#/diagrams).
[The manifest](manifest.md#diagrams) shows how to add one.

### What should I send a colleague?

The address. Every state lives in the URL: the selected card, the question, the depth, the
filter, the project, the catalog tab. Copy it and the other person sees the same view:

```
#/?sel=platform/users-db&mode=impact&depth=2
#/p/shop?type=service,database&host=vps-1&only=1
#/catalog?type=service&owner=team-shop,team-web&tag=critical
```

A link with `mode=impact` or `mode=depends` opens on its answer, with every lit card in view.

### Can I look at one project only?

Yes. Click a project in the sidebar, or open a link that starts with `#/p/<project>`. Every page
then shows that project:

- **Map**: the project, plus the parts of other projects it touches.
- **Catalog**: its components.
- **Health**: its repos and their issues, its components without an owner, and the parts on its
  map that no repo declares. Repos in no project yet (without a manifest, or with one Furio could
  not read) belong to the workspace: the page says how many and links to the workspace's health.
- **Diagrams**: its diagrams.

The counts in the sidebar, the search and the filter follow the project too. A plate under the
workspace name shows the project you are in; its **×** goes back to the whole workspace, on the
same page. A click on another project keeps the page: from the catalog of one project to the
catalog of the other.

The project is a prefix of the URL, so a shared link opens on it:

```
#/p/shop
#/p/shop/catalog?type=database
#/p/shop/health
#/p/shop/c/platform/users-api
```

Links without the prefix show the whole workspace.

## The screen

### Cards and edges

Each project is a group of cards. Each component is a card with an icon for its type, and each
relation is an edge coloured by kind:

| Relation                      | Colour       |
| ----------------------------- | ------------ |
| calls                         | indigo       |
| publishes · consumes          | green        |
| reads · writes · reads_writes | amber        |
| serves                        | cyan         |
| depends on · spawns           | grey, dashed |

- A **dotted** edge, in any colour, is a non-critical relation
  ([`critical: false`](manifest.md#telemetry-logs-and-analytics)): the part at its start keeps
  working without the one at its end.
- A **dashed** card marked **Not declared** is referenced by some repo but declared by none.
- A card drawn quieter, labelled **Deprecated** or **Dev only**, has that `status`.
- Cards show the `tech` next to the type; a domain shows its name.

**Appearance**, at the bottom of the sidebar, sets the theme (system, light, dark) and the
palette (Furio, Blueprint, Circuit) of the map and its diagrams, in this browser.

### Pages

| Page      | Address                     | What it shows                                                |
| --------- | --------------------------- | ------------------------------------------------------------ |
| Map       | `#/`                        | Every project and the dependencies between them              |
| Project   | `#/p/<project>`             | One project, plus the parts of other projects it touches     |
| Component | `#/c/<project>/<component>` | Owner, repo, links, every relation, impact, diagrams         |
| Health    | `#/health`                  | What needs a look                                            |
| Catalog   | `#/catalog`                 | Every component in a table, with filters and a CSV download  |
| Diagrams  | `#/diagrams`                | Every diagram, as cards; each one opens on a page of its own |

A map too large to read whole opens where it starts, at a readable size, and pans from there:
the top of a flow that runs down, the left of one that runs right.

### The detail panel

Click a card to select it: its relations light up and a panel opens on the right (a sheet from
the bottom on phones). It shows the type, provider, runtime, owner, project and repo, the
description and links, what the component depends on and what uses it, and its diagrams. Choose
there what to light: **Relations**, **Blast radius** or **Depends on**.

Click a related component in the panel to move to it. **Open page**, a double click on the card
or `Enter` open the full component page. `Esc`, or a click off the cards, closes the panel.

On the catalog, health, diagrams and component pages, a link to a component opens a **quick
look**: the same panel, without leaving the page (⌘/Ctrl-click opens the full page). The
component page has **Back** to the page you came from.

Each diagram has an **Enlarge** button: full screen, zoom with the wheel, a pinch or `+` `-`,
drag to move, `0` to fit, `Esc` to close.

### Keyboard

| Key     | Action                                                                 |
| ------- | ---------------------------------------------------------------------- |
| `/`     | Search: Enter selects the part on the map, ⌘/Ctrl+Enter opens its page |
| `Enter` | Open the page of the selected card                                     |
| `Esc`   | Close the panel and clear the selection                                |
| `j` `k` | Next / previous component (component page) or diagram (its page)       |
| `⌫`     | In the filter: remove the last value                                   |

### Export

The buttons under the zoom controls download the whole map as PNG or SVG, and the model as JSON.
`model.json` is also published next to the map.

## Extending the map

This part is for whoever hosts the map. A host can add what it knows and the model does not,
without changing the bundle. A script loaded before the map sets `window.furioExtensions`; add
it to `index.html` next to the map, for example `<script src="./extensions.js"></script>`:

```js
window.furioExtensions = {
  // An icon for a card instead of the one of its type (or null to keep it). The image is used as
  // a mask, so monochrome SVGs work best; give a colour (#rrggbb) to paint it with, such as the
  // brand's, or leave it out to use the colour of the component's type.
  iconFor(component) {
    return component.provider === 'stripe' ? { src: './icons/stripe.svg', color: '#635bff' } : null;
  },
  // Extra sections in the detail panel: data only, the map renders them in its own style.
  async panel(component, { model }) {
    return [
      {
        title: 'Runbook',
        items: [{ label: 'On call', value: 'team-payments', href: 'https://example.com/oncall' }],
      },
    ];
  },

  // The Changes view: what changed over a period chosen among changeOptions. Marked cards get a
  // New or Changed badge and the others are dimmed. `relations` is optional: how many were added,
  // removed, or stayed and changed (became non-critical, or critical again).
  changeOptions: [{ value: '7', label: 'Last 7 days' }],
  async changes({ since, model }) {
    return {
      label: 'Last 7 days',
      components: { 'shop/shop-api': 'changed' },
      removed: [],
      relations: { added: 1, removed: 0, changed: 1 },
    };
  },

  // Links to the host's own pages, in the sidebar.
  nav: ({ model }) => [{ label: 'Settings', href: '/settings', icon: 'settings' }],

  // Extra catalog columns (on some tabs only, with types) and a cell per component.
  catalog: ({ model }) => ({
    columns: [{ id: 'oncall', label: 'On call' }],
    cells: { 'shop/shop-api': { oncall: { value: 'team-payments' } } },
  }),

  // Extra sections at the top of the health page, same shape as panel sections. `project` is
  // set when the reader is in one project: return only what concerns it.
  health({ model, project }) {
    return [];
  },

  // A badge on some cards, by component key: a short label (cut at 20 characters), a tone, and a
  // detail shown on hover (cut at 200).
  badges: ({ model }) => ({
    'shop/shop-api': { label: 'On call', tone: 'warning', detail: 'Paged at 09:12 UTC' },
  }),
};
```

Every member is optional and may fail without breaking the map. Items take `label`, `value`,
an optional `href` (http(s) or a map link such as `#/c/shop/shop-api`), `detail` and `tone`
(`ok`, `warning` or `error`).

When the reader is in [one project](#can-i-look-at-one-project-only), `catalog`, `health` and
`changes` also receive `project` (absent for the whole workspace) and are asked again when it
changes:

- `catalog`: the table shows only the project's rows, whatever the cells.
- `health`: the sections are shown as returned, so give only what concerns `project`.
- `changes`: the banner counts the marked parts on the project's map and the project's removed
  parts; the relation counts are shown as returned.

Map links in items (`#/c/shop/shop-api`, `#/health`) stay in the project the reader is in.

The map's `index.html` carries a Content-Security-Policy: images, fonts and styles load only
from the map's own host or inline (`data:`), nothing is embedded and no form is posted. It is
there because diagrams come from every repo of the workspace, and none of them should make the
page of whoever opens the map call another server. If your extension shows icons or fonts from
another host, add that host to `img-src` or `font-src` in the `<meta>` tag.
