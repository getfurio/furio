# Furio

**Furio likes things tidy.** Your architecture map, kept in your repos and checked like code.

Every repo describes the part of the architecture it owns in a `.architecture/` folder. Furio
validates it on every pull request, then merges all repos into one map you can browse and query:
who calls this service, who consumes this queue, what breaks if this database goes down.

- **Docs as code.** The map lives next to the code and goes through code review.
- **Owned by the teams.** Each repo describes only what it owns and references the rest by id.
- **Data, not drawings.** Relations are data you can query; Mermaid diagrams add the details.
- **Nothing to run.** A CLI, a GitHub Action and a static site.

> Furio is in early development. The manifest format may still change before 1.0.

## Guides

- [The manifest](docs/guide/manifest.md): every field, references, diagrams, what Furio checks.
- [Set up Furio](docs/guide/github-action.md): get started, the check on pull requests, a public
  map on GitHub Pages or a private one on your own hosting (S3, SFTP), the Action and the CLI.
- [Furio Cloud](docs/guide/cloud.md): a private map with nothing to run, and its history.
- [Reading the map](docs/guide/map.md): views, blast radius, filters, shareable links, export.
- [Coding agents](docs/guide/agents.md): keep the manifest updated with Claude Code, Codex and others.

## Quick start

In your repo:

```bash
npx @getfurio/cli init
```

It creates `.architecture/architecture.yaml` and teaches your coding agent (Claude Code, Codex
and anything that reads `AGENTS.md`) to keep it updated whenever the code changes. Or write the
manifest by hand:

```yaml
# yaml-language-server: $schema=https://getfurio.com/schema/v1.json
version: 1
project: shop
owner: team-shop

components:
  - id: shop-api
    type: service
    runtime: aws.ecs
  - id: orders-events
    type: queue
    provider: aws.sqs

relations:
  - from: shop-api
    to: orders-events
    type: publishes
  - from: shop-api
    to: platform/users-api # a component of another project
    type: calls

diagrams:
  - file: diagrams/checkout-flow.mmd
    title: Checkout flow
    components: [shop-api]
```

Then check it:

```bash
npx @getfurio/cli validate
```

```
All tidy. Furio approves.
```

A complete example with three repos and two projects lives in [`examples/demo`](examples/demo).

## The manifest

| Field        | What it is                                                                                                                                                  |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `version`    | Always `1` for now.                                                                                                                                         |
| `project`    | The software this repo belongs to. Several repos can share a project.                                                                                       |
| `owner`      | Default owning team for the components below.                                                                                                               |
| `components` | What this repo owns: `id`, `type`, and optionally `name`, `description`, `owner`, `provider`, `runtime`, `tech`, `path`, `host`, `status`, `tags`, `links`. |
| `relations`  | `from` a local component, `to` a component of this project (`users-api`) or another one (`platform/users-api`).                                             |
| `diagrams`   | Mermaid diagrams: `.mmd` files, or `.md` files with ` ```mermaid ` blocks.                                                                                  |

- **Component types:** `service`, `function`, `job`, `frontend`, `queue`, `topic`, `database`,
  `cache`, `storage`, `external`, `client`, `proxy`, `domain`.
- **Relation types:** `calls`, `publishes`, `consumes`, `reads`, `writes`, `reads_writes`,
  `serves`, `spawns`, `depends_on`.
- The manifest can also be named `furio.yaml`, but not both.

[The manifest](docs/guide/manifest.md) explains every field.

The JSON Schema for editor autocompletion is in
[`packages/schema/schema/v1.json`](packages/schema/schema/v1.json).

## Coding agents

Furio ships a skill, [`furio-architecture`](plugins/furio/skills/furio-architecture/SKILL.md), that
tells an AI coding agent when and how to update the manifest, and to run `furio validate`.

- `npx @getfurio/cli init` copies it into the repo, for everyone on the team: `.claude/skills/` (Claude
  Code), `.agents/skills/` (Codex and other Agent Skills readers), plus a short block in
  `AGENTS.md`.
- Claude Code users can also install it as a plugin:

```bash
claude plugin marketplace add getfurio/furio
```

```bash
claude plugin install furio@getfurio
```

## The map

`furio build --site` writes the map next to `model.json`: a static site (no server) with a
workspace view, a view per project, a page per component, a catalog, search and the Mermaid
diagrams. Publish it on
[GitHub Pages](docs/guide/github-action.md#3-a-public-map-on-github-pages) (see the live demo of
the [`furio-demo`](https://furio-demo.github.io/catalog/) workspace), on
[your own hosting](docs/guide/github-action.md#4-a-private-map-on-your-own-hosting), or let
[Furio Cloud](docs/guide/cloud.md) host it.

## CLI

```
furio init [path]          Start a manifest and teach coding agents to keep it updated
furio validate [path...]   Check the .architecture/ manifest of one or more repos
furio build [path...]      Merge many repos into model.json (--github <owner> to collect, --site for the map)
furio upload [path]        Validate, then send the .architecture/ folder to Furio Cloud

--format <pretty|json|github>  Output format (github is the default inside GitHub Actions)
--plain                        No personality, no colors
--strict                       Fail on warnings too
```

Exit codes: `0` valid, `1` invalid, `2` usage or runtime error.
[Set up Furio](docs/guide/github-action.md#5-the-action-and-the-cli) has every option.

## Development

```bash
pnpm install
pnpm check   # typecheck, lint, format, tests
pnpm build
pnpm smoke   # run the built CLI against the examples
```

`pnpm install` also turns on the git hooks in `scripts/hooks`. This repo is public: they stop a
commit that carries a personal email address, a home folder path or one of your private terms
(see `scripts/guard.mjs`).

| Package                              | What it is                                    |
| ------------------------------------ | --------------------------------------------- |
| [`packages/schema`](packages/schema) | The manifest schema (Zod) and its JSON Schema |
| [`packages/core`](packages/core)     | Loading, validation and aggregation           |
| [`packages/cli`](packages/cli)       | The `furio` command, published to npm         |

## License

[MIT](LICENSE)
