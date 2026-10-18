# Changelog

Changes to `@getfurio/cli`, the GitHub Action (`getfurio/furio`), the manifest schema and the
map, newest first. The map ships inside the CLI (`furio build --site`) and the Action
(`command: build` with `site: true`), so a change to the map reaches both with the same version.

## Unreleased

### Added

- Manifest: `status: maintenance` for a component that is supported but takes no new consumers,
  `replaced_by` on a component in maintenance or deprecated, and `status: deprecated` on a
  relation that is being migrated away.
- `furio validate` and `furio build` warn about a relation to a deprecated component that is not
  marked deprecated itself (`relation-to-deprecated`, with the replacement in the hint), and
  about `replaced_by` on an active component (`replaced-by-unused`). With `--model`, `validate`
  also knows the deprecated components of other repos.
- Map: relations on their way out are drawn faded, with a row in the legend; the panel, the
  component page and the health page show what replaces a component and mark deprecated
  relations.
- The coding-agent skill tells agents not to add dependencies on deprecated components.

## 0.6.4 — 2026-10-09

### Changed

- The Action is listed on the GitHub Marketplace as "Furio Architecture Map" (the `name` in
  `action.yml`, previously "Furio"); workflows keep `uses: getfurio/furio@…`, and the CLI and
  the map do not change.

## 0.6.3 — 2026-10-06

### Fixed

- The projects in the map's sidebar are packed at the top again, instead of spread down to the
  foot of the sidebar; the list still scrolls when there are more projects than fit.

## 0.6.2 — 2026-10-06

### Fixed

- The search results in the map's sidebar open whole, over the main column, instead of being
  cut at the sidebar's edge; the list of projects is now the part of the sidebar that scrolls.

## 0.6.1 — 2026-10-06

### Changed

- The map and its favicon show Furio's new mark, in Furio's indigo in every palette.

## 0.6.0 — 2026-10-06

### Added

- Catalog: a menu per field (`project`, `owner`, `tech`, `host`, `provider`, `status`, `tag`)
  next to the search, listing the values the rows have and how many rows have each; values in
  one menu add up, different menus narrow down.
- The catalog URL keeps the search and the filters, as in
  `#/catalog?type=service&owner=team-shop,team-web&tag=critical`, and the CSV download holds the
  rows on screen.
- Diagrams: the page is a grid of cards (title, kind such as flowchart or sequence, project,
  repo, components described), with a search and a menu of projects kept in the URL as `q` and
  `project`.
- Each diagram opens on a page of its own, with links to the components it describes; `j` / `k`
  move among the diagrams found, and **Diagrams** leads back to the grid. `#/diagrams?d=<key>`
  opens that page.

### Changed

- The diagrams grid draws no diagram: a diagram is drawn only on its own page.
- On phones (760px wide and below) the zoom buttons form a row at the top beside the filter,
  every control in that band is 44px, and the PNG, SVG and JSON downloads are not shown.
- The third text colour of the Furio palette (card types, counts, hints, placeholders) now reads
  at 4.5:1 or better on every surface, in both themes.

### Fixed

- A comma inside a filter value, such as an owner named "Payments, Billing", no longer splits it
  in two, in the map's filter and in the catalog.
- The map removes from a diagram's SVG any style that points at another host (from `style`
  statements, a `classDef` or the colour of a box); references inside the diagram itself stay.
- The **Enlarge** button no longer covers the corner of a diagram as wide as its frame, on
  screens 861px wide and above.

## 0.5.1 — 2026-10-05

### Added

- `window.furioExtensions.badges`: a host serving the map can put a badge on cards by component
  key, with a `label` (cut at 20 characters), a `tone` and a `detail` shown on hover (cut at 200).

### Fixed

- The top bar of narrow screens (860px and below) fits a phone: the sections take a row of their
  own that scrolls sideways, and **Appearance** moves to the workspace row.
- On a phone, a map too large to fit opens where its flow starts, with every board name in view,
  instead of centred with the boards cut on both sides.

## 0.5.0 — 2026-10-05

### Added

- Project scope: in a workspace with several projects, `#/p/<project>` holds on every page
  (`#/p/<project>/catalog`, `/health`, `/diagrams`, `/c/<project>/<component>`), and the
  catalog, health, diagrams, sidebar counts, search and filter show that project only.
- A plate under the workspace name in the sidebar shows the current project; its **×** returns
  to the whole workspace on the same page.
- `window.furioExtensions.catalog`, `health` and `changes` receive `project` when the reader is
  in one project.
- `window.furioExtensions.changes` can return `relations.changed`, and the Changes banner counts
  it (for example "1 relation changed").
- A host serving the map can offer **Arrange**, above the zoom buttons: the flow, tiers by kind,
  or one component with the rest around it in rings, with a direction (Auto, Right, Down) and a
  grouping of boards (Project, Owner, Host, Type), kept in the URL as `arrange`, `dir`, `group`
  and `around`. Where it is not offered, such a link opens on the flow and keeps the rest of
  its view.

### Changed

- A map too large to read whole opens at a readable zoom where its flow starts: a flow that runs
  right now opens with its first board by the left edge instead of centred.
- The Blueprint and Circuit palettes are redrawn as complete palettes in both themes: Blueprint
  as a drafted sheet (squared grid, square corners, open arrowheads), Circuit as a printed board
  (copper pins, traces cut at 45 degrees).

### Fixed

- A board with one part says "1 part".

## 0.4.0 — 2026-10-04

### Added

- Manifest: a relation can say `critical: false` when its `from` keeps working without its `to`
  (telemetry, logs, audit trails, analytics). `version` stays `1`, and existing manifests behave
  as before.
- The map draws a non-critical relation dotted, in the colour of its type, shows it in the
  legend, and marks it "Non-critical" in the detail panel and on the component page.
- The `furio-architecture` skill, installed by `furio init` and the Claude Code plugin, says when
  to use `critical: false`.

### Changed

- **Blast radius** and **Depends on** do not follow a relation with `critical: false`, in either
  direction.
- A map link with `mode=impact` or `mode=depends` frames every lit card, the selected one
  included, in the space the panel leaves free; changing the mode or the **Depth** frames them
  again.

Versions of the CLI and the Action before 0.4.0 reject `critical`: update them before a manifest
uses it.

## 0.3.2 — 2026-10-03

Security fixes.

### Fixed

- The Action's job summary for `command: build` shows repo ids, file names and messages as plain
  text (Markdown and HTML escaped) and links a repo only to an http(s) address.
- With `output: furio`, the Action uploads only on `push`, `workflow_dispatch` and `schedule`
  events of the default branch; any other event only validates.
- `furio upload` refuses a `--url` or `FURIO_URL` that is not https (plain http only for
  localhost), and so does the Action's `furio-url` input.
- `furio build --github` removes its temporary copy of the collected manifests also when the
  collection fails.
- `furio build --github` follows the API's next-page links only on the API's own host, skips
  files whose path would leave the repo's folder, and stops with an error on a repo name that is
  a path.
- The map keeps a repo's address only if it is an http(s) address, and the **Enlarge** viewer
  shows a copy of the rendered diagram instead of parsing its HTML again.
- The bundled map uses lodash-es 4.18.1: a dependency of Mermaid pinned a version with known
  advisories.
- `SECURITY.md` explains how to report a vulnerability privately.

## 0.3.1 — 2026-10-03

- The first 0.3 release on npm: publishing 0.3.0 failed, and 0.3.1 carries the same CLI, Action,
  schema and map.

## 0.3.0 — 2026-10-03

Tagged but not published to npm (use 0.3.1). The history before this release is not kept in the
repo, so this entry lists what 0.3.0 contains rather than what changed.

- CLI: `furio init` (starts `.architecture/architecture.yaml` and installs the
  `furio-architecture` skill for coding agents), `furio validate`, `furio build` (from
  checkouts, or from a GitHub owner with `--github`, with the map via `--site`) and
  `furio upload` (to Furio Cloud, with `--dry-run` and `--preview`).
- Action: `command: validate` on pull requests and pushes, `command: build` to collect every repo
  of the owner and write `model.json` and the map, and `output: furio` to send the manifest to
  Furio Cloud.
- Manifest schema v1: `project`, `owner`, `closed`, `components`, `relations` and `diagrams`; 13
  component types, 9 relation types, and the optional `tech`, `path`, `host` and `status` fields.
- Map: the workspace map, a map per project, component pages, Health, Catalog and Diagrams; a
  detail panel with **Blast radius**, **Depends on** and **Depth**; a filter with **Only these**;
  shareable URLs; light and dark themes with the Furio, Blueprint and Circuit palettes; PNG, SVG
  and JSON export; and `window.furioExtensions` for hosts.

## 0.1.0 and 0.2.0

The first public versions, published to npm on 2026-10-02 and 2026-10-03. Their history is not
kept in this repo.
