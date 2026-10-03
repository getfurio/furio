// Writes schema/v1.json, the JSON Schema published for editors. Committed on purpose:
// a test fails when it drifts from the Zod schema.
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { manifestJsonSchema } from '../src/index.js';

const target = fileURLToPath(new URL('../schema/v1.json', import.meta.url));
writeFileSync(target, JSON.stringify(manifestJsonSchema(), null, 2) + '\n');
console.log(`Wrote ${target}`);
