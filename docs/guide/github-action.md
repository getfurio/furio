# Set up Furio on GitHub

Two pieces: a check in every repo that has a manifest, and one catalog repo that builds and
publishes the map of the whole organization.

## 1. Check every manifest on pull requests

In each repo, add `.github/workflows/furio.yml`:

```yaml
name: Furio

on:
  pull_request:
    paths: ['.architecture/**']
  push:
    branches: [main]
    paths: ['.architecture/**']

permissions:
  contents: read

jobs:
  validate:
    runs-on: ubuntu-latest
    timeout-minutes: 5
    steps:
      - uses: actions/checkout@v4
      - uses: getfurio/furio@3e6279a167047191583ae1836c2e500f203d7fd1 # v0.3.2
        with:
          # Optional: the published map, to check references to other repos.
          model: https://<your-org>.github.io/catalog/model.json
```

The examples pin the Action to the commit of a release, with the version in a comment. A
commit cannot change; a tag such as `v0` can be moved, by us or by anyone who gets hold of the
repository, and the job that runs it reads your code and your upload token. To stay current
without thinking about it, let Dependabot open a pull request when a new release comes out,
in `.github/dependabot.yml`:

```yaml
version: 2
updates:
  - package-ecosystem: github-actions
    directory: /
    schedule:
      interval: weekly
```

The commit of any release: `git ls-remote https://github.com/getfurio/furio refs/tags/v0.3.0`.
Every release has its own tag (`v0.3.0`, `v0.4.0`...), which we never move; `v0` follows the
latest 0.x release, if you prefer convenience over pinning.

Put your **default branch** in the `push` trigger: `main` in the example, but use `dev`,
`master` or whatever your repo's default branch is.

The workflow needs only `contents: read`: Furio reads the checked-out files and nothing else. It
uses no OIDC token (`id-token: write`) and never writes to the repo.

Errors fail the check and show up inline on the pull request diff. Warnings are annotated but do
not fail it (set `strict: true` to change that).

To send the manifest to [Furio Cloud](cloud.md) as well, add `output: furio` and the workspace's
upload token. Pull requests are only checked; pushes to the default branch are checked and
uploaded, and the log of any other run says why it only validated. On the Free plan of Furio
Cloud only public repos can upload: a private repo is refused with a clear error, and needs the
Individual or Business plan.

## 2. Publish the map from a catalog repo

1. Create a repo in the organization, for example `catalog`.
2. Create a fine-grained personal access token:
   - resource owner: the organization;
   - repository access: all repositories (new repos join the map on their own);
   - permissions: **Contents: read-only** (Metadata is added automatically).

   Furio only ever reads the `.architecture/` folder of each repo, but GitHub cannot scope a token
   to a folder.

3. Save it as an Actions secret of the catalog repo, named `FURIO_TOKEN`:

   ```bash
   gh secret set FURIO_TOKEN -R <your-org>/catalog
   ```

4. In the catalog repo, enable GitHub Pages with **Source: GitHub Actions**.
5. Add `.github/workflows/map.yml`:

```yaml
name: Map

on:
  schedule:
    - cron: '17 * * * *' # every hour
  workflow_dispatch:
  repository_dispatch:
    types: [furio-update]

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: pages
  cancel-in-progress: false

jobs:
  build:
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      - uses: getfurio/furio@3e6279a167047191583ae1836c2e500f203d7fd1 # v0.3.2
        with:
          command: build
          token: ${{ secrets.FURIO_TOKEN }}
          out: _site
      - uses: actions/upload-pages-artifact@v3
        with:
          path: _site

  deploy:
    needs: build
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - id: deployment
        uses: actions/deploy-pages@v4
```

The map is published at `https://<your-org>.github.io/catalog/`. The job summary lists every repo,
its status and the issues Furio found.

> **Private repos:** a GitHub Pages site is public on most plans, even when the repo is private.
> Only GitHub Enterprise Cloud can restrict who sees it. If your architecture must stay private,
> publish `_site` to an internal static host instead (it is plain files, no server), or use
> [Furio Cloud](cloud.md), which keeps the map private on a paid plan.

The map shows the repos that have a manifest, and lists the others on its health page so you see
who has not joined yet. Private repos without a manifest are the exception: their names stay out
of the model, because the token sees every repo and the map may be public. When the map is
published where only your organization reads it, add `list-private: true` to list them too.

The `timeout-minutes` in the examples is a safety net: the manifests come from every repo of the
organization, and a job that hangs should stop in minutes, not in the six hours GitHub allows.

## Action inputs

| Input          | Default        | Used by  | What it does                                                             |
| -------------- | -------------- | -------- | ------------------------------------------------------------------------ |
| `command`      | `validate`     | both     | `validate` checks this repo; `build` collects the org and writes the map |
| `path`         | `.`            | validate | Repo paths to check, separated by spaces                                 |
| `model`        |                | validate | URL or path of a published `model.json`                                  |
| `github`       | repo owner     | build    | Organization or user to collect from                                     |
| `workspace`    | the owner      | build    | Workspace id shown on the map                                            |
| `token`        |                | build    | Token with read access to the repos' contents                            |
| `out`          | `_furio`       | build    | Output folder (or a `.json` file for the model only)                     |
| `site`         | `true`         | build    | Also write the map next to `model.json`                                  |
| `list-private` | `false`        | build    | Also list the private repos that have no manifest                        |
| `output`       | `none`         | validate | `furio` also uploads to [Furio Cloud](cloud.md) on default-branch pushes |
| `upload-token` |                | validate | With `output: furio`: the workspace upload token                         |
| `github-token` | workflow token | validate | With `output: furio` on pull requests: posts the architecture comment    |
| `strict`       | `false`        | both     | Fail on warnings (validate) or on invalid repos (build)                  |
| `plain`        | `false`        | both     | No personality in the output                                             |

Output: `model`, the absolute path of the written `model.json`.

## Without GitHub Actions

The same steps run anywhere Node 22+ runs:

```bash
FURIO_TOKEN=... npx @getfurio/cli build --github <your-org> --site --out _site
```

Add `--list-private` to list the private repos without a manifest too.

or, from local checkouts:

```bash
npx @getfurio/cli build --workspace acme --site --out _site ../shop-api ../shop-web ../platform
```

## Look at the map locally

The map reads `model.json` next to its `index.html`, and browsers do not let a page opened from
`file://` read other files. Serve the folder with any static server and open the address it
prints:

```bash
npx serve _site            # or: python3 -m http.server -d _site 8000
```

Nothing else is needed: the map is plain files, with no server-side code.
