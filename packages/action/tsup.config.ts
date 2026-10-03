import { defineConfig } from 'tsup';

// One self-contained file, committed to the repo: `uses: getfurio/furio@<ref>` runs it directly.
export default defineConfig({
  entry: { index: 'src/index.ts' },
  format: 'esm',
  platform: 'node',
  target: 'node24',
  clean: true,
  noExternal: [/.*/],
  banner: {
    js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
  },
  esbuildOptions(options) {
    options.conditions = ['@getfurio/source'];
  },
});
