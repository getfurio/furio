import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

/**
 * The only files of public/ that ship with the map. The rest of that folder is local: the model
 * the dev server shows, the demo's or your own. It is ignored by git and never copied into a
 * build, so nothing of yours can end up in the bundle that is committed and published.
 */
const SHIPPED = ['favicon.svg'];

function shippedStatic(): Plugin {
  return {
    name: 'furio-shipped-static',
    apply: 'build',
    generateBundle() {
      for (const fileName of SHIPPED) {
        const source = readFileSync(join(import.meta.dirname, 'public', fileName));
        this.emitFile({ type: 'asset', fileName, source });
      }
    },
  };
}

// The site is a static shell that reads ./model.json at runtime. `base: './'` keeps every asset URL
// relative, so the same build works at any path: GitHub Pages (/<repo>/), Furio Cloud, a file server.
export default defineConfig({
  base: './',
  plugins: [react(), shippedStatic()],
  resolve: { conditions: ['@getfurio/source'] },
  build: { outDir: 'dist', emptyOutDir: true, copyPublicDir: false, chunkSizeWarningLimit: 3000 },
});
