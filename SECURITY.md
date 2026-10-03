# Security

## Reporting a vulnerability

Report it in private: on this repo, **Security → Report a vulnerability**
([direct link](https://github.com/getfurio/furio/security/advisories/new)). Please do not open a
public issue or pull request for it.

Say what is affected (the CLI, the GitHub Action, the map or the schema), the version or commit,
and how to reproduce it. A fix ships as a new release of `@getfurio/cli` and of the Action, and
the advisory is published once the release is out.

## Supported versions

The latest release only: the newest `@getfurio/cli` on npm and the Action commit pinned in the
[guide](docs/guide/github-action.md) (or `@v0`). Fixes are not backported: update to get them.

## Scope

Furio reads `.architecture/` folders that anyone with write access to a repo of the workspace can
edit, and shows them to everyone who opens the map. A manifest, a diagram or a file name that
makes Furio read files outside that folder, run code where the CLI or the Action runs, run
scripts or load remote content in the map, or send a token anywhere but the service it is for, is
a vulnerability.
