#!/usr/bin/env node
// Keeps personal and private data out of this public repo. It checks what is about to be
// committed or pushed (the git hooks in scripts/hooks) and every pull request (CI):
//
//   - commits are authored with a GitHub noreply address;
//   - no home folder paths and no email addresses of people;
//   - none of your private terms (names of other projects, of private repos, of people).
//
// The private terms are not in the repo, or the list itself would be public: one per line (or a
// /regex/) in ~/.config/furio/private-terms.txt, or in the file $FURIO_PRIVATE_TERMS names; in
// CI, the PRIVATE_TERMS secret. A match is reported by its position and never quoted.
//
// Usage: guard.mjs staged | message <file> | push <remote> | ci
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Generated or third-party text, checked for private terms only: libraries name their authors.
 * The same goes for the guard's own tests, which are full of made-up people. Minified code is
 * full of two-letter names, so the terms looked for there are the longer ones.
 */
const VENDORED =
  /^(?:pnpm-lock\.yaml$|scripts\/guard\.test\.mjs$|packages\/action\/dist\/|packages\/[^/]+\/site\/assets\/)/;

const NOREPLY = /^(?:[^@\s]+@users\.noreply\.github\.com|noreply@github\.com)$/i;
const HOME = /(?:\/Users\/|\/home\/|[A-Za-z]:\\Users\\)([A-Za-z0-9._-]+)/g;
/** Home folders that belong to nobody: CI runners and placeholders. */
const NOBODY = new Set(['runner', 'user', 'username', 'name', 'you', 'me']);
const EMAIL = /[A-Za-z0-9._%+-]+@(?:[A-Za-z0-9-]+\.)+[A-Za-z]{2,}/g;
const NOT_A_PERSON =
  /^(?:noreply|no-reply|git)@|@(?:example\.(?:com|org|net)|users\.noreply\.github\.com)$/i;

/** Whether commits may carry this address: GitHub's noreply addresses only. */
export function isNoreply(email) {
  return NOREPLY.test(email);
}

/** A term matches as a word of its own, in any case: "ab" is not found in "cable". */
export function termPattern(term) {
  const custom = /^\/(.+)\/$/.exec(term);
  if (custom) return new RegExp(custom[1], 'i');
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
  return new RegExp(`(?<![A-Za-z0-9])${escaped}(?![A-Za-z0-9])`, 'i');
}

export function loadTerms(env = process.env) {
  const file = env.FURIO_PRIVATE_TERMS || join(homedir(), '.config/furio/private-terms.txt');
  const text = env.PRIVATE_TERMS ?? (existsSync(file) ? readFileSync(file, 'utf8') : '');
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));
}

/** What is wrong in a text, line by line: [{ rule, line }]. `path` says where the text lives. */
export function scan(text, { path = '', terms = [] } = {}) {
  const found = [];
  const vendored = VENDORED.test(path);
  const patterns = terms.filter((term) => !vendored || term.length >= 5).map(termPattern);
  text.split('\n').forEach((line, index) => {
    const add = (rule) => found.push({ rule, line: index + 1 });
    if (patterns.some((pattern) => pattern.test(line))) add('private term');
    if (vendored) return;
    for (const [, name] of line.matchAll(HOME)) {
      if (!NOBODY.has(name.toLowerCase())) add('home folder');
    }
    for (const [email] of line.matchAll(EMAIL)) {
      if (!NOT_A_PERSON.test(email)) add('email address');
    }
  });
  return found;
}

/** The lines a diff adds (git diff -U0), with the file and line they land on. */
export function addedLines(diff) {
  const added = [];
  let path = '';
  let line = 0;
  for (const text of diff.split('\n')) {
    if (text.startsWith('+++ ')) path = text.slice(4).replace(/^b\//, '');
    else if (text.startsWith('@@')) line = Number(/\+(\d+)/.exec(text)?.[1] ?? 1);
    else if (text.startsWith('+') && path !== '/dev/null') {
      added.push({ path, line: line++, text: text.slice(1) });
    }
  }
  return added;
}

const git = (...args) =>
  execFileSync('git', args, { encoding: 'utf8', maxBuffer: 512 * 1024 * 1024 });

/** Problems in a diff: in the lines it adds and in the names of the files it touches. */
function scanDiff(diff, terms, where = '') {
  const problems = [];
  const paths = new Set();
  for (const { path, line, text } of addedLines(diff)) {
    paths.add(path);
    for (const { rule } of scan(text, { path, terms })) {
      problems.push(`${where}${path}:${line}  ${rule}`);
    }
  }
  for (const path of paths) {
    for (const { rule } of scan(path, { terms })) problems.push(`${where}${path}  ${rule} (name)`);
  }
  return problems;
}

function scanMessage(message, terms, where) {
  return scan(message, { terms }).map(({ rule, line }) => `${where}, line ${line}  ${rule}`);
}

function scanCommit(sha, terms) {
  const [author, committer, parents] = git('show', '-s', '--format=%ae%n%ce%n%P', sha).split('\n');
  const where = `commit ${sha.slice(0, 7)}`;
  const problems = [];
  for (const [role, email] of [
    ['author', author],
    ['committer', committer],
  ]) {
    if (!isNoreply(email)) problems.push(`${where}  ${role} email is not a GitHub noreply address`);
  }
  problems.push(...scanMessage(git('show', '-s', '--format=%B', sha), terms, `${where} message`));
  // A merge adds nothing of its own: its commits are checked one by one.
  if (!parents.includes(' ')) {
    const diff = git('show', '--format=', '--no-color', '-U0', '--root', sha);
    problems.push(...scanDiff(diff, terms, `${where}  `));
  }
  return problems;
}

const commitsOf = (...range) =>
  git('rev-list', ...range)
    .split('\n')
    .filter(Boolean);

function run(mode, args, env) {
  const terms = loadTerms(env);
  if (mode === 'staged') {
    const email = /<([^>]*)>/.exec(git('var', 'GIT_AUTHOR_IDENT'))?.[1] ?? '';
    return [
      ...(isNoreply(email)
        ? []
        : [
            'Your git email is not a GitHub noreply address: set one with git config user.email (GitHub: Settings, Emails).',
          ]),
      ...scanDiff(git('diff', '--cached', '--no-color', '-U0'), terms),
    ];
  }
  if (mode === 'message') {
    const message = readFileSync(args[0], 'utf8')
      .split('\n')
      .filter((line) => !line.startsWith('#'))
      .join('\n');
    return scanMessage(message, terms, 'commit message');
  }
  if (mode === 'push') {
    // One line per ref on stdin: <local ref> <local sha> <remote ref> <remote sha>.
    const remote = args[0];
    const problems = [];
    for (const line of readFileSync(0, 'utf8').split('\n').filter(Boolean)) {
      const [, local, , known] = line.split(' ');
      if (/^0+$/.test(local)) continue;
      const range = /^0+$/.test(known)
        ? [local, '--not', `--remotes=${remote}`]
        : [`${known}..${local}`];
      for (const sha of commitsOf(...range)) problems.push(...scanCommit(sha, terms));
    }
    return [...new Set(problems)];
  }
  if (mode === 'ci') {
    const head = env.GUARD_HEAD || 'HEAD';
    const base = env.GUARD_BASE && !/^0+$/.test(env.GUARD_BASE) ? env.GUARD_BASE : '';
    const problems = commitsOf(base ? `${base}..${head}` : head).flatMap((sha) =>
      scanCommit(sha, terms),
    );
    problems.push(...scanMessage(env.PR_TITLE ?? '', terms, 'pull request title'));
    problems.push(...scanMessage(env.PR_BODY ?? '', terms, 'pull request description'));
    return problems;
  }
  throw new Error('Usage: guard.mjs staged | message <file> | push <remote> | ci');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [mode, ...args] = process.argv.slice(2);
  let problems;
  try {
    problems = run(mode, args, process.env);
  } catch (error) {
    console.error(`guard: ${error.message}`);
    process.exit(2);
  }
  if (problems.length) {
    console.error(problems.join('\n'));
    console.error(
      `\nguard: ${problems.length} problem${problems.length === 1 ? '' : 's'}. This repo is public: nothing personal or private goes in it (see CLAUDE.md).`,
    );
    process.exit(1);
  }
  if (!loadTerms().length && mode !== 'ci') {
    console.error('guard: no private terms list found, only the general checks ran.');
  }
}
