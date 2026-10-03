import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { addedLines, isNoreply, loadTerms, scan, termPattern } from './guard.mjs';

const GUARD = join(import.meta.dirname, 'guard.mjs');
const rules = (text, options) => scan(text, options).map((found) => found.rule);

describe('guard: what it looks for', () => {
  it('finds a private term as a word of its own, in any case', () => {
    expect(termPattern('ab').test('the AB project')).toBe(true);
    expect(termPattern('ab').test('ab-site.example')).toBe(true);
    expect(termPattern('ab').test('a cable')).toBe(false);
    expect(termPattern('secret project').test('the Secret   Project plan')).toBe(true);
    expect(termPattern('/pro[jg]ect-\\d+/').test('see project-42')).toBe(true);
    expect(rules('one\nthe secret project\nthree', { terms: ['secret project'] })).toEqual([
      'private term',
    ]);
    expect(scan('a\nb ab', { terms: ['ab'] })).toEqual([{ rule: 'private term', line: 2 }]);
  });

  it('finds home folders and the email addresses of people', () => {
    expect(rules('cd /Users/jane/work')).toEqual(['home folder']);
    expect(rules('C:\\Users\\jane\\work and /home/jane')).toEqual(['home folder', 'home folder']);
    expect(rules('/home/runner/work and /users/acme/repos and /Users/you')).toEqual([]);
    expect(rules('write to jane.doe@company.io')).toEqual(['email address']);
    expect(
      rules(
        'noreply@github.com git@github.com:acme/x.git jane@example.com 1+bot@users.noreply.github.com',
      ),
    ).toEqual([]);
    expect(rules('npx @getfurio/cli@latest, pnpm@11.9.0, actions/checkout@v7.0.1')).toEqual([]);
  });

  it('checks generated and third-party files for private terms only', () => {
    const line = 'by jane@company.io for the secret project';
    const terms = ['secret project'];
    expect(rules(line, { path: 'src/a.ts', terms })).toEqual(['private term', 'email address']);
    expect(rules(line, { path: 'packages/action/dist/index.js', terms })).toEqual(['private term']);
    expect(rules(line, { path: 'pnpm-lock.yaml' })).toEqual([]);
    // Short terms are everywhere in minified code.
    expect(rules('function ab(e){return ab}', { path: 'pnpm-lock.yaml', terms: ['ab'] })).toEqual(
      [],
    );
  });

  it('accepts only GitHub noreply addresses on commits', () => {
    expect(isNoreply('123+jane@users.noreply.github.com')).toBe(true);
    expect(isNoreply('noreply@github.com')).toBe(true);
    expect(isNoreply('jane@company.io')).toBe(false);
  });

  it('reads the lines a diff adds, with their place', () => {
    const diff =
      'diff --git a/a.txt b/a.txt\n--- a/a.txt\n+++ b/a.txt\n@@ -2,0 +3,2 @@\n+one\n+two\n@@ -9 +11 @@\n-old\n+new\n';
    expect(addedLines(diff)).toEqual([
      { path: 'a.txt', line: 3, text: 'one' },
      { path: 'a.txt', line: 4, text: 'two' },
      { path: 'a.txt', line: 11, text: 'new' },
    ]);
  });

  it('takes the private terms from a file or from the environment, never from the repo', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'guard-')), 'terms.txt');
    writeFileSync(file, '# mine\nsecret project\n\n  other  \n');
    expect(loadTerms({ FURIO_PRIVATE_TERMS: file })).toEqual(['secret project', 'other']);
    expect(loadTerms({ PRIVATE_TERMS: 'one\ntwo' })).toEqual(['one', 'two']);
  });
});

describe('guard: in a repo', () => {
  const setup = (email) => {
    const repo = mkdtempSync(join(tmpdir(), 'guard-repo-'));
    const terms = join(repo, '..', `${repo.split('/').pop()}-terms.txt`);
    writeFileSync(terms, 'secret project\n');
    const git = (...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' });
    git('init', '-q', '-b', 'main');
    git('config', 'user.name', 'Jane');
    git('config', 'user.email', email);
    const guard = (mode, input = '', env = {}) =>
      spawnSync('node', [GUARD, ...mode], {
        cwd: repo,
        input,
        encoding: 'utf8',
        env: { ...process.env, FURIO_PRIVATE_TERMS: terms, ...env },
      });
    return { repo, git, guard };
  };

  it('stops a commit that adds a private term, a personal email or uses a personal address', () => {
    const { repo, git, guard } = setup('jane@company.io');
    writeFileSync(join(repo, 'notes.md'), 'ok\nfrom the Secret Project\n');
    git('add', '.');
    const result = guard(['staged']);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('notes.md:2  private term');
    expect(result.stderr).toContain('not a GitHub noreply address');
    // The term itself is never printed.
    expect(result.stderr.toLowerCase()).not.toContain('secret project');
  });

  it('lets a clean commit through, and checks the message too', () => {
    const { repo, git, guard } = setup('1+jane@users.noreply.github.com');
    writeFileSync(join(repo, 'notes.md'), 'nothing to see\n');
    git('add', '.');
    expect(guard(['staged']).status).toBe(0);
    writeFileSync(join(repo, 'MSG'), 'fix: typo\n\nFound while working on the secret project.\n');
    const message = guard(['message', 'MSG']);
    expect(message.status).toBe(1);
    expect(message.stderr).toContain('commit message, line 3  private term');
  });

  it('checks every commit about to be pushed, and a pull request in CI', () => {
    const { repo, git, guard } = setup('jane@company.io');
    writeFileSync(join(repo, 'a.txt'), 'clean\n');
    git('add', '.');
    git('commit', '-q', '-m', 'first');
    const head = git('rev-parse', 'HEAD').trim();
    const push = guard(
      ['push', 'origin'],
      `refs/heads/main ${head} refs/heads/main ${'0'.repeat(40)}\n`,
    );
    expect(push.status).toBe(1);
    expect(push.stderr).toContain('author email is not a GitHub noreply address');

    const ci = guard(['ci'], '', { PRIVATE_TERMS: 'first', PR_TITLE: 'About the first thing' });
    expect(ci.status).toBe(1);
    expect(ci.stderr).toContain('message, line 1  private term');
    expect(ci.stderr).toContain('pull request title, line 1  private term');
  });
});
