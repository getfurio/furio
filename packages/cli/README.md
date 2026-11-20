# furio

**Furio likes things tidy.** Validate the `.architecture/` manifest of your repo and keep your
architecture map in order.

```bash
npx @getfurio/cli validate
```

Documentation and manifest format: https://github.com/getfurio/furio

`furio build` is counted, anonymously: the Furio version, the operating system, whether it ran
in CI and a random id, and nothing about your repos. `FURIO_TELEMETRY=0` (or
`furio telemetry disable`) turns it off:
https://getfurio.com/docs/github-action/#telemetry
