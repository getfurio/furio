# The manifest

Every repo describes the part of the architecture it owns in `.architecture/architecture.yaml`
(`.architecture/furio.yaml` works too, but not both). Furio validates it in CI and merges every
repo of the workspace into one map.

```
.architecture/
  architecture.yaml
  diagrams/
    checkout-flow.mmd
    refund-sequence.md
```

Furio reads schema 1.1: every field below added since 1.0 (`tech`, `path`, `host`, `status`,
`closed`, the `client`, `proxy` and `domain` types, the `reads_writes`, `serves` and `spawns`
relations) is optional, and `version` stays `1`. Older manifests stay valid; older versions of
Furio reject the new fields, so update the CLI and the Action (`@v0`) first.

Add this first line to get autocompletion and inline errors in editors that use the YAML
language server (for example VS Code with the Red Hat YAML extension):

```yaml
# yaml-language-server: $schema=https://getfurio.com/schema/v1.json
```

## Concepts

| Concept   | What it is                                                                         |
| --------- | ---------------------------------------------------------------------------------- |
| Workspace | Everything Furio maps together. In the open source version, a GitHub organization. |
| Project   | A piece of software. One repo, or several repos that declare the same `project`.   |
| Component | Something deployable or stateful: a service, a function, a queue, a database...    |
| Relation  | A typed dependency: `from` a component of this repo `to` any component.            |
| Diagram   | A Mermaid diagram that adds the details a graph cannot show.                       |

## Fields

```yaml
version: 1 # required, always 1 for now
project: shop # required, kebab-case
owner: team-shop # default owner of every component below
closed: false # true: this repo is the whole project (see "References")

components:
  - id: shop-api # required, kebab-case, unique within the project
    type: service # required, see the list below
    name: Shop API # how people call it
    description: Catalog, cart and checkout
    owner: team-checkout # overrides the manifest owner
    provider: aws.ecs # who runs it or sells it: aws.sqs, gcp.pubsub, stripe...
    runtime: node22
    tech: node # the concrete technology: postgres, redis, nginx, tauri...
    path: apps/shop-api # its folder in this repo; the map links to the code
    host: aws.eu-west-1 # where it runs: a machine, a cluster, a region
    status: active # active (default), deprecated or dev-only
    tags: [critical, pci]
    links: # http or https only
      docs: https://example.com/shop-api
      dashboard: https://example.com/grafana/shop-api

relations:
  - from: shop-api # required, a component declared in this manifest
    to: orders-events # required: "component" or "project/component"
    type: publishes # required, see the list below
    protocol: sqs
    description: One event per paid order

diagrams:
  - file: diagrams/checkout-flow.mmd # required, relative to .architecture/
    title: Checkout flow # required
    components: [shop-api, platform/stripe] # pages this diagram appears on
```

**Component types:** `service`, `function`, `job`, `frontend`, `queue`, `topic`, `database`,
`cache`, `storage`, `external`, `client` (an app people install: desktop or mobile), `proxy`
(reverse proxy, load balancer, CDN), `domain` (a domain name).

**Relation types:** `calls`, `publishes`, `consumes`, `reads`, `writes`, `reads_writes`,
`serves`, `spawns`, `depends_on`. Every relation reads "from depends on to": a caller depends on
what it calls, a consumer on its queue, a writer on its database. The map's impact analysis
follows them that way.

- `reads_writes`: one relation for a store the component both reads and writes.
- `serves`: a domain or a proxy in front of a component (`example-com serves nginx`, `nginx
serves shop-api`). If the component goes down, what serves it stops working too.
- `spawns`: a process that starts another one (a desktop app starting its local engine).

### Where things run, and what they are made of

`provider` says who runs a component or sells it (`aws.sqs`, `stripe`). For what you run
yourself, use `tech` for the technology (`mariadb`, `nginx`) and `host` for the place
(`vps-1`, `customer-machine`): the map filters by host. `tech` is free text; Furio warns only
when it looks like a typo of a technology it knows (`postgress`).

`path` ties a component to its folder. In a checkout, `furio validate` warns when the folder does
not exist; the map links it to the code on GitHub.

`status: deprecated` (still running, on its way out) and `status: dev-only` (CI, local tools)
keep a component on the map, drawn quieter, and the health page lists them.

### Domains and proxies

```yaml
components:
  - id: example-com
    type: domain
    name: example.com
  - id: edge
    type: proxy
    tech: nginx
    host: vps-1

relations:
  - from: example-com
    to: edge
    type: serves
  - from: edge
    to: shop-api
    type: serves
    protocol: http
```

## Incoming calls: webhooks and OAuth callbacks

A relation always starts from a component of this repo, and reads "from depends on to". When an
outside service calls you (a Stripe webhook, an OAuth provider redirecting back), declare it on
**your** side: the component that receives the call `consumes` the service that sends it.

```yaml
relations:
  # Stripe posts payment events to the license server.
  - from: license-server
    to: stripe
    type: consumes
    protocol: https-webhook
    description: checkout.session.completed, customer.subscription.*

  # Users sign in with GitHub; GitHub redirects back to /auth/callback.
  - from: web-app
    to: github-oauth
    type: calls
    protocol: oauth2
    description: Authorization code flow, callback at /auth/callback
```

The impact analysis then reads correctly: if Stripe goes down, the license server stops getting
payment events.

## References

- `orders-events` is a component of the same project. It can be declared in another repo of the
  same project.
- `platform/users-api` is a component of another project.
- A reference that no repo declares is not an error: the map shows it as a ghost (DNP) and the
  health page lists it until some repo declares it.
- When one repo is the whole project, set `closed: true`: a reference to a component of the same
  project that the manifest does not declare is then an error (`undeclared-component`), so a
  typo fails the check instead of becoming a ghost.
- Declare a component once, in the repo that owns it. A component declared by two repos is an
  error: the second one is left out of the map.

## Diagrams

- `.mmd` files hold one Mermaid diagram.
- `.md` files can mix prose with any number of fenced ` ```mermaid ` blocks.
- A diagram file that exists in `.architecture/` but is not listed under `diagrams:` gets a
  warning, since the map would ignore it.
- The prose is shown as prose: headings, lists, tables, code, links. The map drops what could
  change the page for everyone who opens it (styles, forms, scripts, classes) and shows an image
  hosted elsewhere as a link to it, so nothing is fetched until someone clicks.
- The map draws every diagram in its own style. A diagram cannot switch on HTML labels, bring
  its own theme, CSS or font (`%%{init}%%` and frontmatter settings for those are ignored), or
  load images from another host.
- Furio reads regular files inside `.architecture/`, up to 1 MB each. It does not follow
  symbolic links: on the machine that runs it, a link could point at anything.

## What Furio checks

`furio validate` reports errors (the CI fails) and warnings (the CI passes, the map notes them).
Every message names the file, line and column, and suggests a fix when it can.

| Code                           | Severity | Meaning                                                               |
| ------------------------------ | -------- | --------------------------------------------------------------------- |
| `manifest-not-found`           | error    | No `.architecture/architecture.yaml` (or `furio.yaml`)                |
| `manifest-ambiguous`           | error    | Both file names exist                                                 |
| `manifest-wrong-extension`     | error    | `.yml` instead of `.yaml`                                             |
| `symlink-not-followed`         | both     | A link in `.architecture/`: an error when the manifest points at it   |
| `file-too-large`               | error    | A manifest or a listed diagram over 1 MB                              |
| `yaml-syntax`                  | error    | The file is not valid YAML                                            |
| `yaml-warning`                 | warning  | The YAML parser noticed something odd                                 |
| `schema-unsupported-version`   | error    | `version` is not 1                                                    |
| `schema-unknown-field`         | error    | A field Furio does not know (often a typo: it suggests the right one) |
| `schema-missing-field`         | error    | A required field is missing                                           |
| `schema-invalid-value`         | error    | Wrong type, unknown type value, bad id or bad link                    |
| `duplicate-component`          | error    | The same id twice in the project                                      |
| `unknown-from`                 | error    | A relation starts from a component this manifest does not declare     |
| `unresolved-reference`         | warning  | A reference that may be a typo, or that no repo declares              |
| `undeclared-component`         | error    | In a `closed` project, a reference the manifest does not declare      |
| `unknown-tech`                 | warning  | A `tech` that looks like a typo of a known technology                 |
| `path-not-found`               | warning  | A `path` that does not exist in the checkout                          |
| `self-relation`                | warning  | A component related to itself                                         |
| `duplicate-relation`           | warning  | The same relation twice                                               |
| `missing-owner`                | warning  | Components without an owner                                           |
| `no-components`                | warning  | The manifest declares nothing                                         |
| `diagram-not-found`            | error    | A listed diagram file does not exist                                  |
| `diagram-outside-architecture` | error    | A diagram path leaves `.architecture/`                                |
| `diagram-bad-extension`        | error    | Not `.mmd` or `.md`                                                   |
| `diagram-empty`                | error    | An empty `.mmd` file                                                  |
| `diagram-no-mermaid-block`     | error    | A `.md` diagram without a ` ```mermaid ` block                        |
| `diagram-duplicate`            | warning  | Two entries for the same file                                         |
| `diagram-unreferenced`         | warning  | A diagram file the manifest does not list                             |

Run `furio validate --strict` to fail on warnings too, and `--model <url>` to check references
against the published map of the workspace.
