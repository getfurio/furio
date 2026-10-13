# Coding agents

A map is only as good as its last update. Furio's skill makes AI coding agents (Claude Code,
Codex and anything that reads `AGENTS.md`) update the manifest in the same change as the code.

## What it looks like

You ask the agent to put a Redis cache in front of the product lookups of `shop-api`. Along with
the code, the same change adds to `.architecture/architecture.yaml`:

```yaml
components:
  - id: shop-cache
    type: cache
    tech: redis

relations:
  - from: shop-api
    to: shop-cache
    type: reads_writes
```

Then the agent runs `npx @getfurio/cli validate`, fixes what it reports, and mentions the
manifest change in its summary. The reviewer sees the new cache in the diff, and the map has it
as soon as the pull request is merged.

If the change touches something the agent cannot see, such as a service of another team whose
id it does not know, it asks you instead of guessing.

## Set it up for the whole team

```bash
npx @getfurio/cli init
```

It writes:

| File                                         | Read by                               |
| -------------------------------------------- | ------------------------------------- |
| `.claude/skills/furio-architecture/SKILL.md` | Claude Code                           |
| `.agents/skills/furio-architecture/SKILL.md` | Codex, and other Agent Skills readers |
| a block in `AGENTS.md`                       | Codex, Cursor, Copilot and others     |
| `.architecture/architecture.yaml`            | only if the repo has no manifest yet  |

Commit them: everyone who clones the repo gets the same behaviour, with nothing to install. Run
`npx @getfurio/cli init` again after upgrading Furio to refresh the skill; it never overwrites a manifest
and only replaces its own block in `AGENTS.md`. Use `--no-agents` to skip this part.

## Or install it for yourself (Claude Code)

```bash
claude plugin marketplace add getfurio/furio
```

```bash
claude plugin install furio@getfurio
```

## What the skill asks the agent to do

- Update the manifest when a change adds, removes or renames something deployable or stateful, or
  changes who calls, publishes, consumes, reads or writes what.
- Declare only what the repo owns, and reference the rest as `project/component`.
- Use only the known types, and never invent owners or ids it cannot see: ask instead.
- Keep listed Mermaid diagrams in sync.
- Run `npx @getfurio/cli validate`, fix every error, and mention the manifest change in its summary.

The full text is in
[`plugins/furio/skills/furio-architecture/SKILL.md`](../../plugins/furio/skills/furio-architecture/SKILL.md).
