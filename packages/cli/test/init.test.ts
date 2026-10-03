import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validateRepo } from '@getfurio/core';
import { describe, expect, it } from 'vitest';
import { SKILL } from '../src/skill.generated.js';
import { parseGitHubRemote } from '../src/git.js';
import { initRepo, SKILL_PATHS, versionedSkill } from '../src/init.js';
import { VERSION } from '../src/version.js';

const repo = (name = 'Billing Service') => {
  const root = join(mkdtempSync(join(tmpdir(), 'furio-init-test-')), name);
  mkdirSync(root);
  return root;
};

const gitRepo = (remote?: string) => {
  const root = repo('billing');
  const git = (...args: string[]) =>
    execFileSync('git', ['-C', root, ...args], { stdio: 'ignore' });
  git('init', '-q');
  if (remote) git('remote', 'add', 'origin', remote);
  return root;
};

describe('furio init', () => {
  it('creates a valid starter manifest named after the folder', () => {
    const root = repo();
    const result = initRepo({ root, agents: false });
    expect(result.created).toEqual(['.architecture/architecture.yaml']);
    const manifest = readFileSync(join(root, '.architecture/architecture.yaml'), 'utf8');
    expect(manifest).toContain('project: billing-service');
    const validation = validateRepo(root);
    expect(validation.errors).toBe(0);
    expect(validation.diagnostics.map((d) => d.code)).toEqual(['no-components']);
  });

  it('installs the agent skill for Claude Code and Codex, and an AGENTS.md block', () => {
    const root = repo();
    initRepo({ root, agents: true, project: 'billing' });
    for (const path of SKILL_PATHS) {
      const skill = readFileSync(join(root, path), 'utf8');
      expect(skill).toMatch(/^---\nname: furio-architecture\ndescription: /);
      expect(skill).toContain(`metadata:\n  furio-version: "${VERSION}"\n---\n`);
    }
    const agents = readFileSync(join(root, 'AGENTS.md'), 'utf8');
    expect(agents).toContain('<!-- furio:start -->');
    expect(agents).toContain('npx @getfurio/cli validate');
  });

  it('never overwrites a manifest and keeps the rest of AGENTS.md', () => {
    const root = repo();
    mkdirSync(join(root, '.architecture'));
    writeFileSync(join(root, '.architecture/furio.yaml'), 'version: 1\nproject: mine\n');
    writeFileSync(join(root, 'AGENTS.md'), '# Rules\n\nUse tabs.\n');

    const first = initRepo({ root, agents: true });
    expect(first.unchanged).toContain('.architecture/furio.yaml');
    expect(existsSync(join(root, '.architecture/architecture.yaml'))).toBe(false);
    expect(first.updated).toContain('AGENTS.md');

    const agents = readFileSync(join(root, 'AGENTS.md'), 'utf8');
    expect(agents.startsWith('# Rules\n\nUse tabs.\n')).toBe(true);

    const second = initRepo({ root, agents: true });
    expect(second.created).toEqual([]);
    expect(second.updated).toEqual([]);
    expect(readFileSync(join(root, 'AGENTS.md'), 'utf8')).toBe(agents);
  });

  it('refreshes a skill copied by an older furio', () => {
    const root = repo();
    mkdirSync(join(root, '.claude/skills/furio-architecture'), { recursive: true });
    writeFileSync(join(root, SKILL_PATHS[0]!), versionedSkill(SKILL, '0.0.1'));
    expect(initRepo({ root, agents: true }).updated).toContain(SKILL_PATHS[0]);
  });

  it('proposes the owner from the GitHub remote', () => {
    const root = gitRepo('git@github.com:acme/billing.git');
    const result = initRepo({ root, agents: false });
    const manifest = readFileSync(join(root, '.architecture/architecture.yaml'), 'utf8');
    expect(manifest).toMatch(/^owner: acme #/m);
    expect(result.notes[0]).toContain('owner: acme comes from the GitHub remote');
    expect(validateRepo(root).diagnostics.map((d) => d.code)).toEqual(['no-components']);
  });

  it('says what it did to AGENTS.md, warns when git does not track it, and leaves CLAUDE.md alone', () => {
    const root = gitRepo();
    writeFileSync(join(root, 'AGENTS.md'), '# Mine\n');
    writeFileSync(join(root, 'CLAUDE.md'), '# Claude\n');
    const { notes } = initRepo({ root, agents: true });
    expect(notes.join('\n')).toContain('AGENTS.md: Furio added its block');
    expect(notes.join('\n')).toContain('AGENTS.md is not tracked by git');
    expect(notes.join('\n')).toContain('CLAUDE.md found and left unchanged');
    expect(readFileSync(join(root, 'CLAUDE.md'), 'utf8')).toBe('# Claude\n');
  });

  it('reads GitHub remotes in https and ssh form', () => {
    expect(parseGitHubRemote('https://github.com/acme/shop-api.git')).toBe('acme/shop-api');
    expect(parseGitHubRemote('git@github.com:acme/shop.api')).toBe('acme/shop.api');
    expect(parseGitHubRemote('https://gitlab.com/acme/shop')).toBeUndefined();
  });

  it('embeds the current skill (run node scripts/embed-skill.mjs after editing it)', () => {
    const source = readFileSync(
      new URL('../../../plugins/furio/skills/furio-architecture/SKILL.md', import.meta.url),
      'utf8',
    );
    expect(SKILL).toBe(source);
  });
});
