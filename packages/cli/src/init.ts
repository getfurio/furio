import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative } from 'node:path';
import { ARCHITECTURE_DIR, MANIFEST_FILE_NAMES } from '@getfurio/schema';
import { githubRepoOf, isTracked } from './git.js';
import { SKILL } from './skill.generated.js';
import { VERSION } from './version.js';

export const SKILL_NAME = 'furio-architecture';

/** Where coding agents look for skills inside a repo: Claude Code, then Codex and other Agent Skills readers. */
export const SKILL_PATHS = [
  `.claude/skills/${SKILL_NAME}/SKILL.md`,
  `.agents/skills/${SKILL_NAME}/SKILL.md`,
];

const AGENTS_START = '<!-- furio:start -->';
const AGENTS_END = '<!-- furio:end -->';

const AGENTS_BLOCK = `${AGENTS_START}
## Architecture manifest (Furio)

This repo describes the architecture it owns in \`.architecture/architecture.yaml\`. When a change
adds, removes or renames a service, function, job, frontend, queue, topic, database, cache, storage
bucket or external API, or changes who calls, publishes, consumes, reads or writes what, update the
manifest in the same change and run \`npx @getfurio/cli validate\`. Full instructions:
\`.agents/skills/${SKILL_NAME}/SKILL.md\`.
${AGENTS_END}`;

export interface InitOptions {
  root: string;
  project?: string;
  agents: boolean;
}

export interface InitResult {
  created: string[];
  updated: string[];
  unchanged: string[];
  /** What init did to files the user may care about, and what it left alone. */
  notes: string[];
}

/**
 * The skill as copied into a repo: its frontmatter records the furio version that wrote it, so an
 * outdated copy is easy to spot (and `furio init` refreshes it).
 */
export function versionedSkill(skill = SKILL, version = VERSION): string {
  return skill.replace(
    /^(---\n[\s\S]*?\n)---\n/,
    (_, head: string) => `${head}metadata:\n  furio-version: "${version}"\n---\n`,
  );
}

/** Sets up a repo for Furio. Safe to run again: it never overwrites a manifest. */
export function initRepo(options: InitOptions): InitResult {
  const result: InitResult = { created: [], updated: [], unchanged: [], notes: [] };
  const rel = (path: string) => relative(options.root, path);

  const existing = MANIFEST_FILE_NAMES.map((name) =>
    join(options.root, ARCHITECTURE_DIR, name),
  ).find((p) => existsSync(p));
  if (existing) {
    result.unchanged.push(rel(existing));
  } else {
    const manifest = join(options.root, ARCHITECTURE_DIR, MANIFEST_FILE_NAMES[0]);
    const owner = githubRepoOf(options.root)?.split('/')[0];
    write(manifest, starterManifest(options.project ?? slugify(basename(options.root)), owner));
    result.created.push(rel(manifest));
    if (owner)
      result.notes.push(
        `owner: ${owner} comes from the GitHub remote; set the team that owns these components if it is someone else.`,
      );
  }

  if (options.agents) {
    const skill = versionedSkill();
    for (const path of SKILL_PATHS) {
      const target = join(options.root, path);
      track(result, rel(target), upsert(target, skill));
    }
    const agents = join(options.root, 'AGENTS.md');
    const existed = existsSync(agents);
    const change = upsertBlock(agents);
    track(result, rel(agents), change);
    if (existed && change !== 'unchanged') {
      result.notes.push(
        `AGENTS.md: Furio added its block between ${AGENTS_START} and ${AGENTS_END}; the rest of the file is untouched. Run with --no-agents to leave AGENTS.md alone.`,
      );
      if (isTracked(options.root, 'AGENTS.md') === false)
        result.notes.push(
          'AGENTS.md is not tracked by git: if it is a personal file, delete the Furio block or commit the file so the whole team gets the instructions.',
        );
    }
    if (existsSync(join(options.root, 'CLAUDE.md')))
      result.notes.push(
        `CLAUDE.md found and left unchanged: Claude Code picks up the skill in .claude/skills/${SKILL_NAME}/.`,
      );
  }
  return result;
}

function starterManifest(project: string, owner?: string): string {
  return `# yaml-language-server: $schema=https://getfurio.com/schema/v1.json
# The part of the architecture this repo owns. Docs: https://getfurio.com/docs/manifest
version: 1
project: ${project}
${owner ? `owner: ${owner} # the team responsible for the components below` : '# owner: team-name'}

components: []
  # - id: ${project}-api
  #   type: service

relations: []
  # - from: ${project}-api
  #   to: other-project/other-component
  #   type: calls
`;
}

type Change = 'created' | 'updated' | 'unchanged';

function track(result: InitResult, path: string, change: Change) {
  result[change].push(path);
}

function write(path: string, content: string) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

function upsert(path: string, content: string): Change {
  if (!existsSync(path)) {
    write(path, content);
    return 'created';
  }
  if (readFileSync(path, 'utf8') === content) return 'unchanged';
  write(path, content);
  return 'updated';
}

/** Adds or refreshes Furio's block in AGENTS.md, leaving the rest of the file alone. */
function upsertBlock(path: string): Change {
  if (!existsSync(path)) {
    write(path, `# Agent instructions\n\n${AGENTS_BLOCK}\n`);
    return 'created';
  }
  const current = readFileSync(path, 'utf8');
  const start = current.indexOf(AGENTS_START);
  const end = current.indexOf(AGENTS_END);
  const next =
    start !== -1 && end > start
      ? current.slice(0, start) + AGENTS_BLOCK + current.slice(end + AGENTS_END.length)
      : `${current.trimEnd()}\n\n${AGENTS_BLOCK}\n`;
  if (next === current) return 'unchanged';
  writeFileSync(path, next);
  return 'updated';
}

function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'my-project'
  );
}
