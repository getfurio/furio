import { defineConfig } from 'tsup';

// The published `furio` package is a single bundle: workspace packages are inlined, so only
// third-party dependencies are installed by npm.
export default defineConfig({
  entry: { bin: 'src/bin.ts' },
  format: 'esm',
  platform: 'node',
  target: 'node22',
  clean: true,
  noExternal: [/^@getfurio\//],
  // Bundled CommonJS dependencies (yaml) call require() for Node built-ins.
  banner: {
    js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
  },
  esbuildOptions(options) {
    options.conditions = ['@getfurio/source'];
  },
});
