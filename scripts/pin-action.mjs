// Pins the Action in the guides to a release commit: every `getfurio/furio@<sha> # v<version>` in
// docs/guide becomes the given commit and the version of packages/cli/package.json. Run it on the
// release branch, right after the release commit:
//   node scripts/pin-action.mjs          # pins HEAD
//   node scripts/pin-action.mjs <sha>    # pins that commit
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const guides = join(root, 'docs/guide');
const PIN = /getfurio\/furio@[0-9a-f]{40} # v\d+\.\d+\.\d+/g;

const sha = execFileSync(
  'git',
  ['rev-parse', '--verify', `${process.argv[2] ?? 'HEAD'}^{commit}`],
  {
    cwd: root,
    encoding: 'utf8',
  },
).trim();
const { version } = JSON.parse(readFileSync(join(root, 'packages/cli/package.json'), 'utf8'));
const pin = `getfurio/furio@${sha} # v${version}`;

let count = 0;
for (const name of readdirSync(guides).filter((f) => f.endsWith('.md'))) {
  const file = join(guides, name);
  const text = readFileSync(file, 'utf8');
  const pinned = text.replace(PIN, () => {
    count++;
    return pin;
  });
  if (pinned !== text) writeFileSync(file, pinned);
}
if (!count) throw new Error(`No pin found in ${guides}.`);
console.log(`Pinned ${count} uses of the Action to ${pin}`);
