# Furio

- Monorepo pnpm: `packages/schema` (Zod schema + JSON Schema), `packages/core` (engine),
  `packages/cli` (`@getfurio/cli`, bundled with tsup into one file, the only package on npm),
  `packages/action` (GitHub Action, committed bundle), `packages/site` (the map),
  `plugins/furio` (coding-agent skill and Claude Code plugin). The guides in `docs/guide` are
  the docs of getfurio.com.
- This repo is public: nothing goes in it that the repo itself does not need. No personal data,
  and no names, data or details of other projects, private ones included: not in files, test
  fixtures, comments, commit messages or pull requests. Examples use the demo repos or made-up
  names (`acme`, `example.com`). Local data for the dev server stays in `packages/site/public/`,
  which is ignored and never built. `scripts/guard.mjs` enforces it in the git hooks
  (`pnpm install` turns them on) and in CI; never skip it with `--no-verify`.
- Workspace packages resolve to their TypeScript sources through the `@getfurio/source` export
  condition: tests and typecheck need no build.
- Before committing: `pnpm check`. After `pnpm build`: `pnpm smoke`.
- Generated and committed: `packages/schema/schema/v1.json`, `packages/action/dist`,
  `packages/action/site`, `packages/cli/src/skill.generated.ts` (run `node scripts/embed-skill.mjs`
  after editing the skill). CI fails if they drift.
- Code, comments, docs, CLI messages and commits in English.
- CLI messages: technical information first (file, line, field, fix), Furio's personality only in
  the summary; `--plain` and JSON drop it.
