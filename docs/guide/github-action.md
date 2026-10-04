# Set up Furio

Everything to put Furio to work, on one page: one repo on the map in five minutes, the check on
every pull request, and the map of the whole organization, public on GitHub Pages or private on
your own hosting.

1. [Get started](#1-get-started): one repo on the map in five minutes, and the three places a
   map can live.
2. [Check every pull request](#2-check-every-pull-request): the workflow for each repo, or one
   command on any other CI.
3. [A public map on GitHub Pages](#3-a-public-map-on-github-pages): for an organization whose map
   anyone may see. Free, with nothing to host.
4. [A private map on your own hosting](#4-a-private-map-on-your-own-hosting): for private repos.
   You build the map and upload it to an S3 bucket, over SFTP or to any static host.
5. [The Action and the CLI](#5-the-action-and-the-cli): every input, command, option and exit
   code.

A private map with nothing to run is [Furio Cloud](cloud.md), which has its own guide.

## 1. Get started

In the repo, with Node 22 or later:

```bash
npx @getfurio/cli init
```

It creates `.architecture/architecture.yaml`, an empty manifest with the fields to fill in, and
the skill that tells [coding agents](agents.md) to keep it updated with the code. Describe what
the repo owns ([The manifest](manifest.md) has every field), then check it:

```bash
npx @getfurio/cli validate
```

Errors name the file and the line, and suggest a fix when they can. When Furio approves, look at
the map of this repo:

```bash
npx @getfurio/cli build --workspace acme --site --out _site .
```

```bash
npx serve _site            # or: python3 -m http.server -d _site 8000
```

`build` writes the map and its data, `model.json`, in `_site`. The map reads `model.json` next to
its `index.html`, and browsers do not let a page opened from `file://` read other files: that is
why it needs a static server, and nothing more than that. The same command takes several repos,
or a whole GitHub organization.

### Three places for the map

The check on pull requests is the same everywhere. What changes is who builds the map and where
it lives. The CLI, the Action and the map are open source in all three cases; Furio Cloud is the
hosted service built on them.

|                      | [GitHub Pages](#3-a-public-map-on-github-pages) | [Your own hosting](#4-a-private-map-on-your-own-hosting) | [Furio Cloud](cloud.md)                                |
| -------------------- | ----------------------------------------------- | -------------------------------------------------------- | ------------------------------------------------------ |
| Who opens the map    | Anyone                                          | Whoever your hosting lets in                             | Free: anyone with the link. Paid: signed-in members    |
| Private repos        | Yes, but the map is public                      | Yes                                                      | On a paid plan                                         |
| What you run         | A catalog repo                                  | The build, and the hosting                               | Nothing                                                |
| Who reads your repos | A token of yours, in your CI                    | A token of yours, or nobody at all                       | Nobody: each repo sends its own manifest               |
| History of the map   | No                                              | No                                                       | Yes                                                    |
| Emails and checks    | No                                              | No                                                       | By plan: digests, domain checks, pull request comments |
| Price                | Free                                            | Free, plus your hosting                                  | [Free or paid](cloud.md#free-or-paid)                  |

## 2. Check every pull request

A check in every repo that has a manifest: an error fails the pull request and shows up on the
line that caused it. On GitHub it is one workflow; on any other CI, one command.

### The workflow

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
      - uses: getfurio/furio@b78e768dc46514f2f38a958933c8b5c08a8762e2 # v0.3.2
```

Put your **default branch** in the `push` trigger: `main` in the example, but use `dev`,
`master` or whatever your repo's default branch is.

The workflow needs only `contents: read`: Furio reads the checked-out files and nothing else. It
uses no OIDC token (`id-token: write`) and never writes to the repo.

Errors fail the check and show up inline on the pull request diff. Warnings are annotated but do
not fail it (set `strict: true` to change that). [What Furio checks](manifest.md#what-furio-checks)
lists every message.

To send the manifest to [Furio Cloud](cloud.md) as well, add `output: furio` and the workspace's
upload token, as its guide shows.

### Pin the Action to a commit

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

### References to other repos

A manifest can point at a component of another repo (`platform/users-api`). On its own, a repo
cannot tell a typo from a component that exists elsewhere. Give the check the `model.json` of the
published map and it can:

```yaml
- uses: getfurio/furio@b78e768dc46514f2f38a958933c8b5c08a8762e2 # v0.3.2
  with:
    model: https://<your-org>.github.io/catalog/model.json
```

`model` is a URL the runner can read without signing in, or the path of a file a previous step
downloaded. If it cannot be read, the check carries on without it and says so. Without `model`,
a reference that no repo declares still shows on the map, as a dashed card, and on its health
page.

### On another CI

The check is one command, wherever Node 22 or later runs:

```bash
npx @getfurio/cli validate
```

It exits with `0` when the manifest is valid, `1` when it is not and `2` when it could not run.
`--format json` prints the result for your own tooling, and `--strict` fails on warnings too.

## 3. A public map on GitHub Pages

For an organization whose map anyone may see, such as an open source one: a catalog repo collects
the manifests of every repo, builds the map and publishes it on GitHub Pages. It is free and
there is nothing to host.

> **Private repos:** a GitHub Pages site is public on most plans, even when the repo is private.
> Only GitHub Enterprise Cloud can restrict who sees it. If your architecture must stay private,
> publish the map on [your own hosting](#4-a-private-map-on-your-own-hosting) or use
> [Furio Cloud](cloud.md), which keeps it private on a paid plan.

### Set up the catalog repo

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
      - uses: getfurio/furio@b78e768dc46514f2f38a958933c8b5c08a8762e2 # v0.3.2
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

The `timeout-minutes` in the examples is a safety net: the manifests come from every repo of the
organization, and a job that hangs should stop in minutes, not in the six hours GitHub allows.

### Which repos are on the map

The map shows the repos that have a manifest, and lists the others on its health page so you see
who has not joined yet. Private repos without a manifest are the exception: their names stay out
of the model, because the token sees every repo and the map is public.

With the map published, the check of each repo can read its `model.json`
([References to other repos](#references-to-other-repos)):

```yaml
model: https://<your-org>.github.io/catalog/model.json
```

## 4. A private map on your own hosting

For private repos whose architecture must stay inside the company: you build the map yourself, on
your machine or in your CI, and upload it where only your people can open it, such as an S3
bucket or a server reached over SFTP. The map is plain files: no server-side code, no database,
no account.

It is the same map as everywhere else ([Reading the map](map.md)). What it does not have is a
login of its own: whoever can fetch the files reads your architecture, so the hosting decides who
gets in ([Keep it private](#keep-it-private)).

### Build it from GitHub

Furio collects the `.architecture/` folder of every repo of an organization through the GitHub
API, from each default branch. It never clones a repo and never reads the code.

1. Create a fine-grained personal access token:
   - resource owner: the organization;
   - repository access: all repositories (new repos join the map on their own);
   - permissions: **Contents: read-only** (Metadata is added automatically).

   GitHub cannot scope a token to a folder, so the token could read the code. Furio does not.

2. Build, with Node 22 or later:

   ```bash
   FURIO_TOKEN=... npx @getfurio/cli build --github <your-org> \
     --site --out _site --list-private
   ```

`--list-private` puts on the health page the private repos that have no manifest yet, so you see
who has not joined. Leave it out if the names of those repos should stay off the map.

### Build it from checkouts

Without a token, or when the repos are not on GitHub, give `build` the folders. Furio reads only
the `.architecture/` folder of each one, so a sparse checkout of that folder is enough.

```bash
npx @getfurio/cli build --workspace acme --site --out _site ../shop-api ../shop-web ../platform
```

Each repo is named `<workspace>/<folder>`. A map built this way has no links to the code, because
Furio does not know where the repos are hosted.

### What is in the folder

| File          | What it is                                                   |
| ------------- | ------------------------------------------------------------ |
| `index.html`  | The map                                                      |
| `assets/`     | Its scripts, styles and fonts                                |
| `favicon.svg` | Its icon                                                     |
| `model.json`  | The data: every repo, component, relation, diagram and issue |

About 10 MB in all. The map reads `model.json` from its own folder when it opens, so it works at
any address, a subfolder included.

### Upload it to Amazon S3

```bash
aws s3 sync _site s3://<bucket>/map --delete
```

`--delete` removes what an older build left behind: the names of the files in `assets/` change
with every release of Furio.

### Upload it over SFTP

[lftp](https://lftp.yar.ru/) mirrors a folder over SFTP and removes what is no longer there:

```bash
lftp -u <user> sftp://files.example.com -e "mirror --reverse --delete _site/ /var/www/map/; bye"
```

With SSH access to the server, `rsync` does the same:

```bash
rsync -az --delete _site/ <user>@files.example.com:/var/www/map/
```

Anything else that serves files works too: a folder of nginx or Apache, Azure Blob Storage,
Google Cloud Storage, an internal artifact server. Copy what is in `_site`, keeping its
structure.

### Keep it private

The map has no login. Anyone who can fetch `index.html` and `model.json` reads the whole
architecture: components, owners, hosts, links and diagrams. The hosting is what keeps it
private.

**On Amazon S3**, leave Block Public Access on and do not turn on static website hosting: a
website endpoint serves only public content, and without HTTPS. People open the map at the
regular address of the bucket:

```
https://<bucket>.s3.<region>.amazonaws.com/map/index.html
```

A bucket policy lets them in only from your network:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "MapFromOurNetworkOnly",
      "Effect": "Allow",
      "Principal": "*",
      "Action": "s3:GetObject",
      "Resource": "arn:aws:s3:::<bucket>/map/*",
      "Condition": { "IpAddress": { "aws:SourceIp": ["203.0.113.0/24"] } }
    }
  ]
}
```

Put there the addresses your VPN or your office goes out from, or use `aws:SourceVpce` to allow
only your VPC endpoint. For a sign-in instead of a network rule, serve the bucket through
something that asks for one: your identity-aware proxy, or CloudFront with signed cookies.

**On a server**, serve the folder only on the internal network, or behind the authentication of
your reverse proxy.

### Keep it fresh

Build and upload on a schedule, from the CI you already have. On GitHub Actions, in any repo of
the organization:

```yaml
name: Map

on:
  schedule:
    - cron: '17 * * * *' # every hour
  workflow_dispatch:

permissions:
  contents: read
  id-token: write # short-lived AWS credentials; not needed for SFTP

jobs:
  map:
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      - uses: getfurio/furio@b78e768dc46514f2f38a958933c8b5c08a8762e2 # v0.3.2
        with:
          command: build
          token: ${{ secrets.FURIO_TOKEN }}
          out: _site
          list-private: true

      - uses: aws-actions/configure-aws-credentials@v6
        with:
          role-to-assume: arn:aws:iam::<account-id>:role/furio-map
          aws-region: eu-west-1
      - run: aws s3 sync _site "s3://<bucket>/map" --delete
```

`FURIO_TOKEN` is the token created above, saved as a secret of that repo:

```bash
gh secret set FURIO_TOKEN -R <your-org>/<repo>
```

The job needs no checkout: the Action collects the manifests through the API. The role is one
that GitHub Actions may assume
([how to set it up](https://docs.github.com/en/actions/deployment/security-hardening-your-deployments/configuring-openid-connect-in-amazon-web-services))
and that may list the bucket, and put and delete objects under `map/`. No AWS key is stored in
the repo.

To upload over SFTP, replace the last two steps with this one:

```yaml
- name: Upload over SFTP
  env:
    SFTP_USER: ${{ secrets.SFTP_USER }}
    LFTP_PASSWORD: ${{ secrets.SFTP_PASSWORD }}
    SFTP_HOST_KEY: ${{ secrets.SFTP_HOST_KEY }}
  run: |
    install -d -m 700 ~/.ssh
    printf '%s\n' "$SFTP_HOST_KEY" > ~/.ssh/known_hosts
    sudo apt-get update -qq && sudo apt-get install -y -qq lftp
    lftp -c "
      set net:max-retries 1;
      open --env-password -u $SFTP_USER sftp://files.example.com;
      mirror --reverse --delete _site/ /var/www/map/;
    "
```

`SFTP_HOST_KEY` is the line `ssh-keyscan files.example.com` prints for your server, checked once
by hand: the job then talks to that server only. The password comes from the environment, never
from the command line, and `max-retries 1` makes a single attempt, so a wrong password does not
get the runner banned.

Outside GitHub Actions it is the same two commands, build and upload, from cron or any CI.

### Check references against a private map

The check of each repo can read the `model.json` of the map
([References to other repos](#references-to-other-repos)). A private map cannot be read from a
URL: download the file in a previous step, with credentials that may read the bucket, and pass
its path.

```yaml
- run: aws s3 cp "s3://<bucket>/map/model.json" model.json
- uses: getfurio/furio@b78e768dc46514f2f38a958933c8b5c08a8762e2 # v0.3.2
  with:
    model: model.json
```

It is optional. Without it every pull request is still checked, and a reference that no repo
declares shows on the health page of the map at the next build.

### What Furio Cloud adds

Hosting the map yourself means running the token, the schedule and the access rules.
[Furio Cloud](cloud.md) is the same map behind a sign-in, with nothing to run: each repo sends
its own manifest and no token reads your repos. It adds what a folder of files cannot do: the
history of the map, email digests, domain checks and architecture comments on pull requests.

## 5. The Action and the CLI

The Action runs the CLI: one command, `furio`, does on your machine or in any CI what the Action
does on GitHub. Run it with `npx @getfurio/cli <command>`, with Node 22 or later, or install it
(`npm install -g @getfurio/cli`) and type `furio`.

### Action inputs

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
| `furio-url`    | getfurio.com   | validate | With `output: furio`: the address of Furio Cloud, https only             |
| `strict`       | `false`        | both     | Fail on warnings (validate) or on invalid repos (build)                  |
| `plain`        | `false`        | both     | No personality in the output                                             |

Output: `model`, the absolute path of the written `model.json`.

With `output: furio`, the manifest is uploaded on pushes to the default branch, and on manual
(`workflow_dispatch`) or scheduled runs of it. On any other event the Action only validates, and
its log says why.

### Commands

| Command                        | What it does                                                          |
| ------------------------------ | --------------------------------------------------------------------- |
| `furio init [path]`            | Starts a manifest and teaches coding agents to keep it updated        |
| `furio validate [path...]`     | Checks the `.architecture/` manifest of one or more repos             |
| `furio build [path...]`        | Merges the manifests of many repos into one `model.json`              |
| `furio build --github <owner>` | The same, collecting the manifests from a GitHub organization or user |
| `furio upload [path]`          | Validates, then sends the `.architecture/` folder to Furio Cloud      |

`[path]` is a repo root, its `.architecture/` folder or the manifest file. The default is the
current directory.

### Options

| Command    | Option                  | What it does                                                                |
| ---------- | ----------------------- | --------------------------------------------------------------------------- |
| `init`     | `--project <id>`        | Project id. Default: the folder name                                        |
| `init`     | `--no-agents`           | Skip the skill for Claude Code, Codex and `AGENTS.md`                       |
| `validate` | `--model <file or URL>` | A published `model.json`: checks references to other repos                  |
| `validate` | `--format <format>`     | `pretty` (the default), `json`, or `github` (the default in GitHub Actions) |
| `validate` | `--strict`              | Fail on warnings too                                                        |
| `build`    | `--github <owner>`      | Collect from GitHub, with the token in `FURIO_TOKEN` or `GITHUB_TOKEN`      |
| `build`    | `--workspace <id>`      | Workspace id. Default: the `--github` owner                                 |
| `build`    | `--site`                | Also write the map next to `model.json`                                     |
| `build`    | `--out <path>`          | Output file or folder. Default: `furio-model.json`                          |
| `build`    | `--list-private`        | With `--github`: also list the private repos that have no manifest          |
| `build`    | `--strict`              | Fail if any repo is invalid                                                 |
| `upload`   | `--repo <owner/name>`   | The repo on GitHub. Default: `GITHUB_REPOSITORY`, else the `origin` remote  |
| `upload`   | `--commit <sha>`        | The commit uploaded. Default: `GITHUB_SHA`                                  |
| `upload`   | `--url <url>`           | Furio Cloud, over https. Default: `FURIO_URL`, else `https://getfurio.com`  |
| `upload`   | `--dry-run`             | Send nothing: validate, ask Furio Cloud whether it would accept             |
| `upload`   | `--preview <file>`      | On pull requests: write to `<file>` the comment with what would change      |
| all        | `--plain`               | No personality, no colors                                                   |
| all        | `-h`, `--help`          | Show the help                                                               |
| all        | `-v`, `--version`       | Show the version                                                            |

### Environment

| Variable                          | Used by          | What it is                                                              |
| --------------------------------- | ---------------- | ----------------------------------------------------------------------- |
| `FURIO_TOKEN`, `GITHUB_TOKEN`     | `build --github` | A token that can read the contents of the repos; public repos need none |
| `GITHUB_API_URL`                  | `build --github` | The GitHub API to collect from. Default: `https://api.github.com`       |
| `FURIO_UPLOAD_TOKEN`              | `upload`         | The upload token of the workspace                                       |
| `FURIO_URL`                       | `upload`         | The address of Furio Cloud, https only                                  |
| `GITHUB_REPOSITORY`, `GITHUB_SHA` | `upload`         | The defaults of `--repo` and `--commit`                                 |
| `GITHUB_ACTIONS`                  | `validate`       | `true` makes `github` the default format                                |
| `NO_COLOR`                        | every command    | Any value turns colors off                                              |

Tokens come from the environment only. There is no flag for them: a token on the command line
ends up in the shell history and in the list of processes.

### Exit codes

| Code | Meaning                                                               |
| ---- | --------------------------------------------------------------------- |
| `0`  | The manifest is valid, the model was written, the upload was accepted |
| `1`  | The manifest is invalid, or Furio Cloud refused the upload            |
| `2`  | The command could not run: wrong usage, or a network or GitHub error  |

With `--strict`, `validate` also exits with `1` on warnings, and `build` when a repo is invalid.
