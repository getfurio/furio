import { defineConfig } from 'vitest/config';

// Workspace packages resolve to their TypeScript sources: tests never need a build first.
const conditions = ['@getfurio/source'];

export default defineConfig({
  resolve: { conditions },
  ssr: { resolve: { conditions, externalConditions: conditions } },
  test: {
    include: ['packages/*/test/**/*.test.ts', 'scripts/**/*.test.mjs'],
    server: { deps: { inline: [/@getfurio\//] } },
  },
});
