# The manifest

Each repo has one YAML file, `.architecture/architecture.yaml`, that says what the repo runs and
what each part talks to.

Furio checks it on every pull request and joins the files of all your repos into one map.

## A first manifest

This is the `shop-api` repo of the [live demo](https://furio-demo.github.io/catalog/), a little
shorter. The repo runs an API, its database and a queue, and the API calls another team's
service:

```yaml
# yaml-language-server: $schema=https://getfurio.com/schema/v1.json
version: 1
project: shop
owner: team-shop

components:
  - id: shop-api
    type: service
    description: Catalog, cart and checkout
  - id: shop-db
    type: database
    provider: aws.rds
  - id: orders-events
    type: queue
    provider: aws.sqs

relations:
  - from: shop-api
    to: shop-db
    type: writes
  - from: shop-api
    to: orders-events
    type: publishes
  - from: shop-api
    to: platform/users-api
    type: calls
```

Read it from the top:

- `project: shop`: the repo belongs to the project `shop`. Several repos can share a project.
- `owner`: the team that answers for the components below.
- `components`: what this repo runs or owns. Each one has an `id` and a `type`.
- `relations`: what depends on what. A relation reads "from depends on to": `shop-api` needs
  `shop-db` to work.
- `platform/users-api`: a component of another project. The repo that owns it declares it;
  here it is only referenced.

That is all a manifest needs. Every other field adds detail to the map. On the demo,
[`shop-api`](https://furio-demo.github.io/catalog/#/c/shop/shop-api) shows what this file
becomes.

The first line turns on autocompletion and inline errors in editors that use the YAML language
server, such as VS Code with the Red Hat YAML extension. `furio init` writes it for you.

The file can also be called `.architecture/furio.yaml`, but not both. Diagrams go next to it:

```
.architecture/
  architecture.yaml
  diagrams/
    checkout-flow.mmd
```

### The words Furio uses

| Word      | What it is                                                                         |
| --------- | ---------------------------------------------------------------------------------- |
| Workspace | Everything Furio maps together. In the open source version, a GitHub organization. |
| Project   | A piece of software. One repo, or several repos that declare the same `project`.   |
| Component | Something deployable or stateful: a service, a function, a queue, a database...    |
| Relation  | A typed dependency: `from` a component of this repo `to` any component.            |
| Diagram   | A Mermaid diagram that adds the details a graph cannot show.                       |

## Examples from real systems

### A web app on one server

A small product: a domain, nginx in front, a Node app, Postgres and Redis, all on one VPS.
Stripe takes the payments and sends webhooks back; an email provider sends the receipts.

```yaml
version: 1
project: acme
owner: team-acme

components:
  - id: example-com
    type: domain
    name: example.com
  - id: edge
    type: proxy
    tech: nginx
    host: vps-1
  - id: app
    type: service
    tech: node
    host: vps-1
    path: apps/web
  - id: db
    type: database
    tech: postgres
    host: vps-1
  - id: cache
    type: cache
    tech: redis
    host: vps-1
  - id: stripe
    type: external
    provider: stripe
  - id: email
    type: external
    provider: resend

relations:
  - from: example-com
    to: edge
    type: serves
  - from: edge
    to: app
    type: serves
    protocol: http
  - from: app
    to: db
    type: reads_writes
  - from: app
    to: cache
    type: reads_writes
  - from: app
    to: stripe
    type: calls
    protocol: https
    description: Checkout sessions and refunds
  - from: app
    to: stripe
    type: consumes
    protocol: https-webhook
    description: Payment events, posted to /webhooks/stripe
  - from: app
    to: email
    type: calls
    description: Receipts and sign-in links
```

What the map can then tell you:

- **What goes down with the server**: filter by `host: vps-1`.
- **What users notice if Postgres stops**: the blast radius of `db` reaches the app, nginx and
  the domain.
- **Where the code is**: `path` links the `app` card to `apps/web` on GitHub.

On [Furio Cloud](cloud.md#what-the-hosted-map-adds), the domain is checked every day (expiry,
certificate, DNS), and an incident on Stripe's or Resend's status page shows on their cards.

### Services in several repos

A project can span several repos. In the demo, the storefront lives in its own repo, `shop-web`,
and calls the API declared in `shop-api`:

```yaml
version: 1
project: shop
owner: team-shop-web

components:
  - id: storefront
    type: frontend
    runtime: vercel

relations:
  - from: storefront
    to: shop-api # same project, another repo: the id is enough
    type: calls
  - from: storefront
    to: platform/users-api # another project: project/id
    type: calls
```

Declare each component once, in the repo that owns it, and reference it from everywhere else.
Furio joins the repos when it builds the map.

The same goes for messaging between teams. If the invoices move to a `billing` repo, its worker
consumes the queue that `shop-api` declares:

```yaml
relations:
  - from: invoice-worker
    to: shop/orders-events
    type: consumes
```

### Webhooks and OAuth callbacks

A relation always starts from a component of this repo. When an outside service calls you, write
it on **your** side: the component that receives the call `consumes` the service that sends it,
or `calls` the provider whose flow it starts.

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

### Apps people install

A mobile or desktop app is a `client`. A desktop app that starts a local process `spawns` it,
and `host` says where both run:

```yaml
components:
  - id: mobile
    type: client
    tech: react-native
  - id: desktop
    type: client
    tech: electron
    host: customer-machine
  - id: sync-engine
    type: service
    host: customer-machine

relations:
  - from: mobile
    to: acme/app
    type: calls
  - from: desktop
    to: sync-engine
    type: spawns
  - from: sync-engine
    to: acme/app
    type: calls
```

### Telemetry, logs and analytics

Some relations are real, but nothing breaks along them. A service that sends telemetry, ships
its logs or reports to analytics keeps doing its job when the other end is down. Mark them
`critical: false`:

```yaml
relations:
  - from: shop-api
    to: platform/telemetry-collector
    type: calls
    protocol: otlp
    critical: false
```

Without it, the collector would be in almost every blast radius, and the impact analysis would
stop telling you anything. With it, the relation stays on the map, drawn dotted, and in the
lists of both components, but the blast radius and "Depends on" do not follow it.

A relation is critical unless it says otherwise, so leave the field out everywhere else. Use
`critical: false` for what a component can lose and still do its job. Do not use it for a
dependency that is rarely used, or that has a fallback nobody has tried.

### A service on its way out

```yaml
components:
  - id: legacy-search
    type: service
    status: deprecated
    description: Replaced by the search in acme/app; still called by old app versions
```

The map draws it quieter and the health page lists it. Before you switch it off, its blast
radius shows who still calls it. `status: dev-only` works the same way for CI and local tools.

## Every field

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
    critical: true # true (default); false when "from" works without "to"

diagrams:
  - file: diagrams/checkout-flow.mmd # required, relative to .architecture/
    title: Checkout flow # required
    components: [shop-api, platform/stripe] # pages this diagram appears on
```

### Component types

| Type       | For                                                       |
| ---------- | --------------------------------------------------------- |
| `service`  | An API, a web server, a long-running process              |
| `function` | A serverless function                                     |
| `job`      | A scheduled or batch job                                  |
| `frontend` | A web app that runs in the browser                        |
| `queue`    | A message queue                                           |
| `topic`    | A pub/sub topic                                           |
| `database` | A database                                                |
| `cache`    | A cache, such as Redis                                    |
| `storage`  | File or object storage, such as a bucket                  |
| `external` | A service you use but do not run, such as Stripe          |
| `client`   | An app people install: desktop or mobile                  |
| `proxy`    | A reverse proxy, a load balancer or a CDN                 |
| `domain`   | A domain name. Put the host name in `name`: `example.com` |

### Relation types

Every relation reads "from depends on to": a caller depends on what it calls, a consumer on its
queue, a writer on its database. The impact analysis of the map follows them that way.

| Type           | `from`...                                                      |
| -------------- | -------------------------------------------------------------- |
| `calls`        | makes requests to `to` (HTTP, gRPC...)                         |
| `publishes`    | sends messages to a queue or topic                             |
| `consumes`     | receives messages from a queue or topic, or webhooks from `to` |
| `reads`        | reads from a store                                             |
| `writes`       | writes to a store                                              |
| `reads_writes` | both, as one relation                                          |
| `serves`       | is in front of `to`: a domain or a proxy and what it points at |
| `spawns`       | starts `to` as another process                                 |
| `depends_on`   | needs `to` in any other way                                    |

With `serves`, if what is behind goes down, what is in front stops working too: `example-com
serves edge` and `edge serves app` put the domain in the blast radius of the app.

### Where things run, and what they are made of

- `provider` says who runs a component or sells it (`aws.sqs`, `stripe`).
- `tech` is the technology of what you run yourself (`mariadb`, `nginx`). It is free text; Furio
  warns only when it looks like a typo of a technology it knows (`postgress`).
- `host` is the place it runs (`vps-1`, `customer-machine`). The map filters by host.
- `path` is its folder in the repo. In a checkout, `furio validate` warns when the folder does
  not exist; the map links it to the code on GitHub.
- `status: deprecated` (still running, on its way out) and `status: dev-only` (CI, local tools)
  keep a component on the map, drawn quieter, and the health page lists them.

## References

- `orders-events` is a component of the same project. It can be declared in another repo of the
  same project.
- `platform/users-api` is a component of another project.
- A reference that no repo declares is not an error. The map shows it as a dashed card, and the
  health page lists it until some repo declares it.
- When one repo is the whole project, set `closed: true`. A reference to a component of the same
  project that the manifest does not declare is then an error (`undeclared-component`), so a
  typo fails the check instead of becoming a dashed card.
- Declare a component once, in the repo that owns it. A component declared by two repos is an
  error: the second one is left out of the map.

## Diagrams

A graph shows what depends on what. A diagram shows the rest: the order of the calls, the
states of an order, what happens on a refund. Put a Mermaid file in `.architecture/diagrams/`:

```
flowchart LR
  customer([Customer]) --> api[Shop API]
  api --> stripe[(Stripe)]
  api -- order.paid --> queue[[orders-events]]
  queue --> worker[invoice-worker]
  worker --> email[Email service]
```

and list it in the manifest, with the components it describes:

```yaml
diagrams:
  - file: diagrams/checkout-flow.mmd
    title: Checkout flow
    components: [shop-api, invoice-worker, platform/stripe]
```

It then shows on the page of each of those components, and under **Diagrams** on the map
([on the demo](https://furio-demo.github.io/catalog/#/diagrams)).

- `.mmd` files hold one Mermaid diagram.
- `.md` files can mix prose with any number of fenced ` ```mermaid ` blocks.
- A diagram file in `.architecture/` that is not listed under `diagrams:` gets a warning, since
  the map would ignore it.
- The prose is shown as prose: headings, lists, tables, code, links. The map drops what could
  change the page for everyone who opens it (styles, forms, scripts, classes). It shows an image
  hosted elsewhere as a link to it, so nothing is fetched until someone clicks.
- The map draws every diagram in its own style. A diagram cannot switch on HTML labels, bring
  its own theme, CSS or font (`%%{init}%%` and frontmatter settings for those are ignored), or
  load images from another host.
- Furio reads regular files inside `.architecture/`, up to 1 MB each. It does not follow
  symbolic links: on the machine that runs it, a link could point at anything.

## What Furio checks

`furio validate` reports errors and warnings. An error fails the check; a warning passes it, and
the map notes it. Each message names the file, the line and the column, and suggests a fix when
it can. With `databse` for `database` in the [first manifest](#a-first-manifest):

```
error .architecture/architecture.yaml:11:11
  components[1] (shop-db).type is "databse", which is not a valid component type.
  → Did you mean "database"? Valid: service, function, job, frontend, queue, topic, database, cache, storage, external, client, proxy, domain.
  [schema-invalid-value]
```

A repo cannot tell on its own whether `platform/user-api` is a typo. Give the check the
`model.json` of a published map and it can:

```bash
npx @getfurio/cli validate --model https://furio-demo.github.io/catalog/model.json
```

```
warning .architecture/architecture.yaml:25:9
  relations[2].to points to "platform/user-api", which no repo in the workspace declares.
  → Did you mean "platform/users-api"? Until it is declared, the map shows it as a ghost node.
  [unresolved-reference]
```

Add `--strict` to fail on warnings too. Every message:

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

## Versions

`version: 1` is the only version of the manifest. New fields are optional, so a manifest that
was valid stays valid. An older Furio, though, rejects a field it does not know yet: update the
CLI and the Action before you use a new one. Every field on this page works with Furio
0.4.0 or later; the [changelog](../../CHANGELOG.md) says what came when.
