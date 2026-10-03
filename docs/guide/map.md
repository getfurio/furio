# Reading the map

Each project is a group of cards, each component a card with an icon for its type, and each
relation an edge coloured by kind. The map follows your system's light or dark theme. **Appearance**, at the bottom of the
sidebar, sets the theme (system, light, dark) and the palette (Furio, Blueprint, Circuit) of the
map and its diagrams, in this browser. Each card's icon tile has the colour of its type.

| Relation                      | Colour       |
| ----------------------------- | ------------ |
| calls                         | indigo       |
| publishes · consumes          | green        |
| reads · writes · reads_writes | amber        |
| serves                        | cyan         |
| depends on · spawns           | grey, dashed |

A dashed card marked **Not declared** is referenced by some repo but declared by none. A card
drawn quieter with a **Deprecated** or **Dev only** label has that `status`. Cards show the
`tech` next to the type; a domain shows its name.

## Views

- **Map** (`#/`): every project of the workspace and the dependencies between them.
- **Project** (`#/p/<project>`): one project, plus the parts of other projects it touches.
- **Component** (`#/c/<project>/<component>`): owner, repo, links, every relation (pins), what it
  affects and what it needs (impact), and its diagrams. `j` / `k` move to the next and previous
  part.
- **Health** (`#/health`): invalid repos, repos without a manifest, ghost references, components
  without an owner, and every issue Furio found.
- **Catalog** (`#/catalog`): every component in a table, a tab per type the workspace has
  (Services, Databases, Domains...), a search over every field, sortable columns and a CSV
  download. A click on a name opens a quick look; the URL keeps the tab and the search.
- **Diagrams** (`#/diagrams`): every diagram of the workspace, grouped by project, each with the
  components it describes. Add them as `.mmd` or `.md` files in `.architecture/diagrams/` and list
  them under `diagrams:` in the manifest ([how](manifest.md#diagrams)).

## Moving around

Links to components on the catalog, health, diagrams and component pages open a **quick look**:
the same panel as on the map, without leaving the page (⌘/Ctrl-click opens the full page). The
component page has **Back** to the page you came from. Each diagram has an **Enlarge** button:
full screen, zoom with the wheel, a pinch or `+` `-`, drag to move, `0` to fit, `Esc` to close.

## The detail panel

Click a card to select it: its relations light up and a panel opens on the right (a sheet from
the bottom on phones) with what Furio knows about it: type, provider, runtime, owner, project and
repo, description, links, what it depends on and what uses it, and its diagrams. Click a related
component in the panel to move to it. **Open page**, a double click on the card or `Enter` open
the full component page; `Esc`, or a click anywhere off the cards, closes the panel.

## Asking the map a question

With a card selected, choose in the panel what to light:

- **Relations**: its direct relations.
- **Blast radius**: everything that is affected if it goes down, following dependents through the
  graph. Each lit card shows how many hops away it is.
- **Depends on**: everything it needs to work.

Set **Depth** to limit how far the blast radius and the dependencies go.

**Filter** (top left; on phones behind the Filter button): type a technology, a team, a host,
a type, a provider or a status and pick from what the map contains, with how many parts have
each value. Values of the same kind add up (tech node or nginx), different kinds narrow down
(tech node and host vps-1). Matching cards stay lit and the rest are dimmed, so the map keeps
its shape; **Only these** hides the rest and lays the map out again. Backspace removes the last
value.

Every one of these states lives in the URL, so a view can be shared as a link, for example:

```
#/?sel=platform/users-db&mode=impact&depth=2
#/p/shop?type=service,database&host=vps-1&only=1
```

## Keyboard

| Key     | Action                                                                 |
| ------- | ---------------------------------------------------------------------- |
| `/`     | Search: Enter selects the part on the map, ⌘/Ctrl+Enter opens its page |
| `Enter` | Open the page of the selected card                                     |
| `Esc`   | Close the panel and clear the selection                                |
| `j` `k` | Next / previous component (component page)                             |

## Export

The buttons under the zoom controls download the whole map as PNG or SVG, and the model as
JSON (`model.json` is also published next to the map).

## Extending the map

A host that serves the map can add what it knows and the model does not, without changing the
bundle. A script loaded before the map sets `window.furioExtensions`; add it to `index.html`
next to the map, for example `<script src="./extensions.js"></script>`:

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
  // New or Changed badge and the others are dimmed.
  changeOptions: [{ value: '7', label: 'Last 7 days' }],
  async changes({ since, model }) {
    return { label: 'Last 7 days', components: { 'shop/shop-api': 'changed' }, removed: [] };
  },

  // Links to the host's own pages, in the sidebar.
  nav: ({ model }) => [{ label: 'Settings', href: '/settings', icon: 'settings' }],

  // Extra catalog columns (on some tabs only, with types) and a cell per component.
  catalog: ({ model }) => ({
    columns: [{ id: 'oncall', label: 'On call' }],
    cells: { 'shop/shop-api': { oncall: { value: 'team-payments' } } },
  }),

  // Extra sections at the top of the health page, same shape as panel sections.
  health({ model }) {
    return [];
  },
};
```

Every member is optional and may fail without breaking the map. Items take `label`, `value`,
an optional `href` (http(s) or a map link such as `#/c/shop/shop-api`), `detail` and `tone`
(`ok`, `warning` or `error`).

The map's `index.html` carries a Content-Security-Policy: images, fonts and styles load only
from the map's own host or inline (`data:`), nothing is embedded and no form is posted. It is
there because diagrams come from every repo of the workspace, and none of them should make the
page of whoever opens the map call another server. If your extension shows icons or fonts from
another host, add that host to `img-src` or `font-src` in the `<meta>` tag.
