---
name: furio-architecture
description: Keep this repo's .architecture/ manifest (Furio) in sync with the code. Use whenever a change adds, removes or renames a service, function, job, frontend, queue, topic, database, cache, storage bucket or external API, or changes who calls, publishes to, consumes from, reads or writes what; also when the user asks about the architecture, dependencies or ownership of this repo.
---

# Keep the architecture manifest in sync

This repo describes the part of the architecture it owns in `.architecture/architecture.yaml`
(or `.architecture/furio.yaml`). CI validates it with Furio, and a catalog merges every repo of
the organization into one map. If the code changes and the manifest does not, the map lies.

## When to update it

Update the manifest **in the same change** as the code when you:

- add, remove or rename something deployable or stateful: a service, a function (Lambda, Cloud
  Function), a scheduled job, a frontend, a queue, a topic, a database, a cache, a storage bucket;
- start or stop depending on something: a new HTTP/gRPC client, a new event published or
  consumed, a new table read or written, a new third-party API (Stripe, an email provider, ...);
- move a responsibility to another team (`owner`).

Pure refactors, tests, styling and internal code moves need no manifest change.

## How to edit it

1. Read the current manifest first. Keep its style and order.
2. Components are things **this repo owns**. Never declare a component owned by another repo:
   reference it instead.
3. Relations always start `from` a component declared in this manifest. `to` is either a component
   of the same project (`users-api`) or of another project (`platform/users-api`).
4. Use only these values:
   - component `type`: `service`, `function`, `job`, `frontend`, `queue`, `topic`, `database`,
     `cache`, `storage`, `external`, `client` (installed desktop/mobile app), `proxy` (reverse
     proxy, load balancer, CDN), `domain` (a domain name)
   - relation `type`: `calls`, `publishes`, `consumes`, `reads`, `writes`, `reads_writes`,
     `serves` (domain or proxy in front of a component), `spawns` (starts a child process),
     `depends_on`; every relation reads "from depends on to"
   - ids: kebab-case (`payments-api`), unique within the project
   - `provider` / `runtime` / `host`: lowercase dotted strings (`aws.sqs`, `aws.lambda`,
     `stripe`, `vps-1`)
   - optional: `tech` (the technology: `postgres`, `nginx`), `path` (the component's folder,
     `apps/server`), `status` (`deprecated` or `dev-only`)
5. When a component gets a new folder, or moves, update its `path`. An outside service that calls
   this repo (a webhook, an OAuth callback) is modelled from the receiving side:
   `from: <receiver>`, `to: <service>`, `type: consumes`.
6. Do not invent facts you cannot see in the code or the conversation: if the owner, the provider or
   the id of a component in another repo is unknown, ask the user rather than guess.
7. If a Mermaid diagram listed under `diagrams:` shows the flow you changed, update it too.

Example of a change that adds a consumer of an existing queue in another project:

```yaml
components:
  - id: invoice-worker
    type: function
    provider: aws.lambda

relations:
  - from: invoice-worker
    to: shop/orders-events
    type: consumes
```

## Check it

Run the validator before finishing:

```bash
npx @getfurio/cli validate
```

Fix every error it reports (it gives the file, line and a suggested fix). Warnings about
references to other repos are expected when the other repo is not checked out. In your summary of
the change, mention what you updated in the architecture manifest.

If the repo has no `.architecture/` folder yet, do not create one unprompted: suggest
`npx @getfurio/cli init` to the user.
