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
the map private and accepts private repos. A workspace's first paid plan starts with a 7-day free
trial, once per workspace; payments, VAT and receipts go through Stripe.

When a paid subscription ends, the map is locked: nobody can see it and uploads are refused, but
everything is kept. Choosing a plan again unlocks it. A paid workspace never goes back to Free,
whose map is public.

The open source version stays free for any repo, public or private: you build the map and
publish it on [GitHub Pages](github-action.md#3-a-public-map-on-github-pages) or on
[your own hosting](github-action.md#4-a-private-map-on-your-own-hosting).
[Three places for the map](github-action.md#three-places-for-the-map) compares them.

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
         - uses: getfurio/furio@f46f0b9c9122e3b6eb7b7c5cbdce82970397563b # v0.6.0
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

## The workspace

At [getfurio.com/app](https://getfurio.com/app) each workspace has a page per section, listed on
the left (at the top on a phone) under the switch to your other workspaces:

- **Overview**: the repos, the components, the last upload and the members; what needs a look,
  each with a link to it (repos left out of the map, warnings, components referenced but not
  declared and, on the paid plans, provider incidents and domain problems); the repos with their
  state, and the last changes.
- **Changes**: every upload and what it changed on the map, filterable by project.
- **Incidents** and **Domains**: the provider incidents and the domain checks, on Individual and
  Business.
- **Members**: who can sign in; the owner adds and removes them.
- **Plan**: the plans, the trial and the billing.
- **Settings**: the address of the map, the GitHub account, the email digests and the incident
  emails, a new upload token, and deleting the workspace.

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

[The Action and the CLI](github-action.md#5-the-action-and-the-cli) lists the options of `upload`.

## What the hosted map adds

The map on Furio Cloud is the same as the open source one, plus what only a server can know
and, on the paid plans, other ways to lay it out:

- an icon on each card for its technology or provider (`tech: postgres`, `provider: stripe`),
  on every plan, Free included;
- in the detail panel, when each repo last uploaded and from which commit;
- the **history** of the map: every upload is kept with what it changed (7 days on Free, 90 on
  Individual, a year on Business). **Changes**, in the workspace, lists the uploads and what each
  changed, filterable by project; on the map, **Changes** in the filter bar marks what was added or
  changed in a period, and the panel shows the recent changes of each component;
- on Individual and Business, **email digests** of what is new on the map: broken references,
  components referenced but not declared, repos that have not uploaded for 30 days, components
  without an owner. At most one email a day, each problem once, to every member; turn them off
  in the workspace's **Settings**;
- on Individual and Business, **domain checks**: every component with `type: domain` and its host
  name in `name` (`name: example.com`) is checked every day: when the registration expires (RDAP),
  the certificate served on port 443, and that DNS resolves. The results show in the panel, on the
  health page and in the workspace's **Domains**, and members get an email 30, 14, 7 and 1 days
  before an expiry, or as soon as a certificate is not valid;
- on Individual and Business, **provider incidents**: when the `provider` of a component (or its
  `runtime`, for hosting platforms such as `vercel` or `cloudflare`) has a public status page that
  Furio reads, an incident the provider reports there shows on the map, as a badge on the cards of
  the components that use it, a section in their panel and an entry on the health page, and in the
  workspace's **Incidents**. That page also lists the past incidents, the ones Furio saw closed,
  as far back as the plan keeps the history. Furio reads each page every 5 minutes. Members get an
  email when an incident starts, with a link to what depends on each component, and another when
  it closes; in the workspace's **Settings** you choose which incidents (major and critical, the
  default; minor too; or none). All of it is what the provider reports: status pages can be late
  or incomplete, and Furio cannot confirm them;
- on Individual and Business, **Arrange**: the map by tiers, around one component, or grouped by
  owner, host or type. [Arranging the map](#arranging-the-map) describes each.

The status pages Furio reads, by the `provider` to write in the manifest: `bitbucket`, `brevo`,
`circleci`, `claude` (or `anthropic`), `clerk`, `clickhouse`, `cloudflare`, `cloudinary`,
`confluent`, `contentful`, `cursor`, `digitalocean`, `discord`, `docker`, `dropbox`, `elastic`,
`fly`, `github`, `grafana`, `hubspot`, `influxdb`, `linear`, `linode`, `mailgun`, `mapbox`,
`mixpanel`, `mongodb`, `netlify`, `newrelic`, `npm`, `openai`, `planetscale`, `pusher`, `render`,
`resend`, `segment`, `sentry`, `shopify`, `stripe`, `supabase`, `twilio` (or `sendgrid`),
`upstash`, `vercel`, `zoom`. A dotted provider counts by its first part: `github.actions` is
GitHub. AWS, Google Cloud and Azure are not read yet: they report incidents by service and region.

## Arranging the map

On Individual and Business the map can be laid out in other ways than by what depends on what.
**Arrange**, above the zoom buttons, offers:

- **Flow** (the default): layers follow the relations, a part before what it uses. **Direction**
  runs them left to right or top to bottom; Auto picks what fits the window. **Group by** changes
  what the boards gather: projects, owners, hosts or types, to see who owns what and what runs
  where.
- **Tiers**: bands by kind, in the order of the classic picture: entry points (domains, proxies,
  frontends, client apps), services (services, functions, jobs), messaging (queues, topics), data
  (databases, caches, storage), then what is external.
- **Around**: one component at the centre, what uses it on its left and what it uses on its
  right, in rings by hops. Each ring says how many parts it holds, and each side how many in all,
  so you know what a pan away still hides. Select a card to move the centre. Parts that neither
  use it nor are used by it are left out. On a phone the same map is a stack to read down: what
  uses the component above it, what it uses below, a level for each distance.

The arrangement is part of the link, like the selection and the filter:

```
#/?arrange=tiers&dir=down
#/?group=owner
#/?arrange=around&around=platform/users-api
```

On the Free plan, and on a map you host yourself, such a link opens on the flow.

## Members

Members are the people who can sign in to a workspace. On Free they manage it (token, changes,
settings) while the map stays public; on Individual and Business they are the only ones who see
the map. Individual has one member, Business has no limit.

Whoever creates the workspace is its owner. From the workspace's **Members** page, the owner:

- adds a member by email. Furio sends them a link to sign in, and they get access as soon as
  they sign in with that address: by email link, or with GitHub if it is their account's primary
  email;
- removes a member, who loses the map and the workspace at their next request.

The other members can leave from the same page. Only the owner can delete the workspace, and
the owner cannot leave it: when they delete their account, the member who has been there
longest becomes the owner, and the account page says who before you confirm. A workspace never
stays without members.

So that Furio cannot be used to email strangers, a workspace can invite 10 people a day on Free
and 50 on Business, and one person can send 50 invitations a day across their workspaces.
Removing someone and adding them again counts twice.

If a workspace moves to Individual, the owner keeps access; the other members stay listed,
without access, until the owner removes them or the workspace goes back to Business.

## Leaving

From the workspace's **Settings** the owner can delete a workspace: its map, every repo's manifest,
its tokens and its members go at once, for good. Cancel a running subscription first. From your
account page you can delete your account: the workspaces you own pass to their next member, and a
workspace where you are the only member has to be deleted first.
