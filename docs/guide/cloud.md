# Furio Cloud

Furio Cloud hosts the map of a workspace at `getfurio.com/w/<name>`. Each repo sends its own
`.architecture/` folder from its GitHub Action: there is no catalog repo to run and no token that
reads your code. Furio never reads the repos; it only receives what the Action sends.

## Free or paid

| Plan       | Price                                                 | Repos                          | Map                            |
| ---------- | ----------------------------------------------------- | ------------------------------ | ------------------------------ |
| Free       | 0 €                                                   | Public GitHub repos, unlimited | Public: anyone with the link   |
| Individual | 9 € a month or 90 € a year, VAT included              | Public and private, up to 20   | Private: one member, signed in |
| Business   | 49 € a month or 490 € a year per workspace, VAT excl. | Public and private, unlimited  | Private: unlimited members     |

Free is for open source: Furio checks that every repo that uploads is public. A paid plan makes
the map private and accepts private repos. Paid plans start with a 7-day free trial; payments,
VAT and receipts go through Stripe.

When a paid subscription ends, the map is locked: nobody can see it and uploads are refused, but
everything is kept. Choosing a plan again unlocks it. A paid workspace never goes back to Free,
whose map is public.

The [open source version](github-action.md) stays free for any repo, public or private: a catalog
repo in your organization builds the map and you publish it where you choose.

## Set it up

1. Sign in at [getfurio.com/login](https://getfurio.com/login) with GitHub, or with a one-time
   link by email.
2. Create a workspace: a name (the map lives at `getfurio.com/w/<name>`) and the GitHub account,
   organization or user, that owns the repos. Only that account's repos can upload to it.
3. Copy the upload token. Furio shows it once and keeps only a fingerprint; generating a new one
   stops the old one at once.
4. Save it as a secret in each repo:

   ```bash
   gh secret set FURIO_UPLOAD_TOKEN -R <owner>/<repo>
   ```

5. Add the Furio step to the repo's workflow, `.github/workflows/furio.yml`. Put your default
   branch in the `push` trigger (`main` here; `dev`, `master` or whatever yours is):

   ```yaml
   name: furio
   on:
     pull_request:
     push:
       branches: [main] # your default branch

   permissions:
     contents: read

   jobs:
     furio:
       runs-on: ubuntu-latest
       timeout-minutes: 5
       steps:
         - uses: actions/checkout@v4
         - uses: getfurio/furio@deb361c44637b6d9e29356ddddd25b0edf5d6f9a # v0.3.1
           with:
             output: furio
             upload-token: ${{ secrets.FURIO_UPLOAD_TOKEN }}
   ```

   Pull requests are only checked. Pushes to the default branch are checked, then uploaded; on
   any other run the log says why nothing was uploaded. The upload uses only the token: the
   workflow needs `contents: read` and no OIDC (`id-token: write`).

   On the Free plan, only public repos can upload; a private repo is refused with a
   `public-repos-only` error until the workspace is on Individual or Business.

6. Push. The repo appears in the workspace and the map updates within seconds.

## Architecture changes on pull requests

On the Business plan, the same step comments every pull request with what it would change on
the map: components added, removed or changed (and which fields), relations, references to
check, with links to the map. One comment per pull request, updated on every push; nothing is
stored until the change reaches the default branch. Give the workflow the permission to
comment:

```yaml
permissions:
  contents: read
  pull-requests: write
```

Without it, or on another plan, the pull request is still checked and the log says why there
is no comment. Pull requests from forks get no secrets, so they are only checked.

## What happens on upload

The Action validates the repo first, exactly like `furio validate`, and sends nothing if the
manifest has errors. Furio Cloud checks it again against the rest of the workspace and answers
with any problem, reported against your local files. Each upload replaces that repo's previous
one; the other repos stay as they are.

## Try it before the first push

From the repo, with the token in `FURIO_UPLOAD_TOKEN`:

```bash
FURIO_UPLOAD_TOKEN=... npx @getfurio/cli@latest upload --dry-run
```

It validates the manifest, asks Furio Cloud whether the token, the plan and the workspace accept
this repo, and lists the files it would send, without uploading anything. The repo comes from
the `origin` remote; pass `--repo <owner>/<repo>` to override it.

## Without GitHub Actions

The CLI (0.2.0 or later) does the same from any CI, with the token in `FURIO_UPLOAD_TOKEN`:

```bash
FURIO_UPLOAD_TOKEN=... npx @getfurio/cli@latest upload --repo <owner>/<repo>
```

## What the hosted map adds

The map on Furio Cloud is the same as the open source one, plus what only a server can know:

- an icon on each card for its technology or provider (`tech: postgres`, `provider: stripe`),
  on every plan, Free included;
- in the detail panel, when each repo last uploaded and from which commit;
- the **history** of the map: every upload is kept with what it changed (7 days on Free, 90 on
  Individual, a year on Business). The workspace page lists the changes by upload, filterable
  by project; on the map, **Changes** in the filter bar marks what was added or changed in a
  period, and the panel shows the recent changes of each component;
- on Individual and Business, **email digests** of what is new on the map: broken references,
  components referenced but not declared, repos that have not uploaded for 30 days, components
  without an owner. At most one email a day, each problem once, to every member; turn them off
  from the workspace page;
- on Individual and Business, **domain checks**: every component with `type: domain` and its
  host name in `name` (`name: example.com`) is checked every day: when the registration expires
  (RDAP), the certificate served on port 443, and that DNS resolves. The results show in the
  panel, on the health page and on the workspace page, and members get an email 30, 14, 7 and 1
  days before an expiry, or as soon as a certificate is not valid.

## Leaving

From the workspace page you can delete a workspace: its map, every repo's manifest, its tokens
and its members go at once, for good. Cancel a running subscription first. From your account
page you can delete your account.
