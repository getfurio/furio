// Copies the built map (packages/site/dist) next to a package's bundle, as <package>/site/.
// Usage: node ../../scripts/copy-site.mjs (run from the package folder).
import { cpSync, existsSync, readdirSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';

// What the map is made of. Only this is copied: the bundle is committed and published, and
// whatever else sits in the build folder (a model, a local test) stays where it is.
const BUNDLE = ['index.html', 'favicon.svg', 'assets'];

const source = resolve(import.meta.dirname, '../packages/site/dist');
const target = resolve(process.cwd(), 'site');
const missing = BUNDLE.filter((entry) => !existsSync(join(source, entry)));
if (missing.length) {
  console.error(
    `No built site in ${source} (missing ${missing.join(', ')}): run pnpm --filter @getfurio/site build first.`,
  );
  process.exit(1);
}
rmSync(target, { recursive: true, force: true });
for (const entry of BUNDLE) cpSync(join(source, entry), join(target, entry), { recursive: true });
const left = readdirSync(source).filter((entry) => !BUNDLE.includes(entry));
console.log(
  `Copied the map to ${target}${left.length ? ` (left out, not part of the map: ${left.join(', ')})` : ''}`,
);
