/**
 * Usage counts: one anonymous event per `furio build`, so that we know whether Furio is used, and
 * on what. On by default, and easy to turn off. What an event says, and nothing else: the Furio
 * version, the operating system, whether the build ran in CI and, outside CI, a random id made on
 * this machine. Never a repo, a path, a name or anything read from a manifest.
 *
 * The first build on a machine says so and sends nothing. In CI, where nothing is remembered
 * between runs, every build says so on one line, and no id is made. In GitHub Actions the event
 * says instead, coarsely, which project builds (`projectFingerprint`): builds alone would not
 * tell one project that builds every hour from many that build once.
 *
 * Events go to our own analytics server (a self-hosted Umami, the one that counts the visits to
 * getfurio.com), shaped the way it counts best: a page view whose path is the command, where it
 * ran and the version. That server tells visitors apart by address and user agent, and drops
 * what looks like a bot: so the event names an address that is nobody's (the server then keeps
 * nothing of the real one, and looks no place up), and a user agent of its own, which carries the
 * id.
 */
import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { VERSION } from './version.js';

export const TELEMETRY_URL = 'https://stats.getfurio.com/api/send';
/** The "Furio CLI" site on the analytics server: public, like the id of any counted site. */
export const TELEMETRY_SITE = '8ce19b1b-caab-4b82-8279-b65495c42c11';
export const TELEMETRY_DOCS = 'https://getfurio.com/docs/github-action/#telemetry';

export interface TelemetryRequest {
  url: string;
  body: string;
  /** Of the request itself. The event names its own, which is the one the server reads. */
  userAgent: string;
}

/** What counting needs from the machine. Only the published package gets one: tests bring theirs. */
export interface TelemetryIo {
  /** Keeps the id and the choice; undefined where there is no home folder. */
  file: string | undefined;
  /** As `process.platform` says it. */
  platform: string;
  /** Hands the event over without holding the command, and never throws. */
  send: (request: TelemetryRequest) => void;
  randomId?: () => string;
  now?: () => Date;
}

/** The part of the CLI's `Io` that counting uses. */
export interface TelemetryHost {
  env: Record<string, string | undefined>;
  stderr: (text: string) => void;
  telemetry?: TelemetryIo;
}

interface State {
  id?: string;
  enabled?: boolean;
  /** When this machine was told: only later builds send. */
  noticed?: string;
}

const OFF_WORDS = new Set(['0', 'false', 'off', 'no']);
const word = (value: string | undefined) => (value ?? '').trim().toLowerCase();
/** Set, and not to a "no". */
const isSet = (value: string | undefined) => word(value) !== '' && !OFF_WORDS.has(word(value));

/** The variable that turns counting off, if one does: `FURIO_TELEMETRY=0` or `DO_NOT_TRACK`. */
export function telemetryOff(env: Record<string, string | undefined>): string | undefined {
  if (env.FURIO_TELEMETRY !== undefined && OFF_WORDS.has(word(env.FURIO_TELEMETRY)))
    return 'FURIO_TELEMETRY';
  // https://consoledonottrack.com
  return isSet(env.DO_NOT_TRACK) ? 'DO_NOT_TRACK' : undefined;
}

const CI_VARIABLES = [
  'CI',
  'CONTINUOUS_INTEGRATION',
  'GITHUB_ACTIONS',
  'GITLAB_CI',
  'BUILDKITE',
  'CIRCLECI',
  'TF_BUILD',
  'JENKINS_URL',
  'TEAMCITY_VERSION',
  'BITBUCKET_BUILD_NUMBER',
  'CODEBUILD_BUILD_ID',
  'DRONE',
  'TRAVIS',
  'APPVEYOR',
];

export function isCI(env: Record<string, string | undefined>): boolean {
  return CI_VARIABLES.some((name) => isSet(env[name]));
}

/** The file of a machine: `$XDG_CONFIG_HOME`, `%APPDATA%` on Windows, else `~/.config`. */
export function telemetryFile(
  env: Record<string, string | undefined>,
  platform: string,
  home: string | undefined,
): string | undefined {
  const base =
    env.XDG_CONFIG_HOME ||
    (platform === 'win32' ? env.APPDATA : undefined) ||
    (home ? join(home, '.config') : undefined);
  return base ? join(base, 'furio', 'telemetry.json') : undefined;
}

/** Digits only: a word in the id (hex spells "feed") could make the server take it for a bot. */
const ID = /^\d{25}$/;

function newId(): string {
  return BigInt(`0x${randomBytes(10).toString('hex')}`)
    .toString()
    .padStart(25, '0');
}

function readState(file: string): State {
  try {
    const value = JSON.parse(readFileSync(file, 'utf8')) as State | null;
    if (!value || typeof value !== 'object') return {};
    return {
      ...(typeof value.id === 'string' && ID.test(value.id) ? { id: value.id } : {}),
      ...(typeof value.enabled === 'boolean' ? { enabled: value.enabled } : {}),
      ...(typeof value.noticed === 'string' ? { noticed: value.noticed } : {}),
    };
  } catch {
    return {};
  }
}

/** Why the file could not be written, or undefined when it was. */
function writeState(file: string, state: State): string | undefined {
  try {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(state, null, 2) + '\n');
    return undefined;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code ?? (error as Error).message;
  }
}

/** How many values a project fingerprint can take: 20 bits. */
export const PROJECT_FINGERPRINTS = 2 ** 20;

/**
 * Which project builds, in GitHub Actions: enough to count projects, too little to point at one.
 * A hash of the number GitHub gives the repository the workflow runs in, cut to one of 1,048,576
 * values: on github.com more than a thousand repository numbers share each of them, and none can
 * be told from the others. Never the owner's number, which would name an organization.
 *
 * Not the first commit, as other tools do: a build workflow often checks nothing out, and in a
 * shallow clone the first commit is the last one.
 */
export function projectFingerprint(env: Record<string, string | undefined>): string | undefined {
  const repository = env.GITHUB_REPOSITORY_ID ?? '';
  if (env.GITHUB_ACTIONS !== 'true' || !/^\d{1,20}$/.test(repository)) return undefined;
  const server = (env.GITHUB_SERVER_URL || 'https://github.com').toLowerCase().replace(/\/+$/, '');
  const hash = createHash('sha256').update(`furio project\n${server}\n${repository}`).digest();
  // Digits only, like the id: the user agent carries it.
  return String(hash.readUInt32BE(0) % PROJECT_FINGERPRINTS).padStart(7, '0');
}

const OS: Record<string, string> = { darwin: 'Mac OS', linux: 'Linux', win32: 'Windows' };

export interface TelemetryEvent {
  type: 'event';
  payload: {
    website: string;
    hostname: string;
    url: string;
    os: string;
    id?: string;
    userAgent: string;
    ip: string;
  };
}

/** The whole event of a build: `furio telemetry` prints it, and the guide explains every field. */
export function buildEvent(build: {
  version: string;
  platform: string;
  ci: boolean;
  /** Of the machine: outside CI. */
  id?: string;
  /** Of the project (`projectFingerprint`): in GitHub Actions. */
  project?: string;
}): TelemetryEvent {
  const who = build.id ?? (build.project ? `ci ${build.project}` : 'ci');
  return {
    type: 'event',
    payload: {
      website: TELEMETRY_SITE,
      hostname: 'cli.getfurio.com',
      url: `/build/${build.ci ? 'ci' : 'local'}/${build.version}`,
      os: OS[build.platform] ?? build.platform,
      ...(build.id ? { id: build.id } : {}),
      // The server's visitors are user agents: this is how it tells two machines apart, or two
      // projects in CI.
      userAgent: `Furio (${build.platform}; ${who})`,
      // Nobody's address, on purpose: the server uses this one, not the one the request comes from.
      ip: '127.0.0.1',
    },
  };
}

const TURN_OFF = '"furio telemetry disable", FURIO_TELEMETRY=0 or DO_NOT_TRACK=1';

function firstNotice(file: string): string {
  return (
    'note: Furio counts builds, anonymously. From the next one, each "furio build" sends the Furio\n' +
    '  version, the operating system, whether it ran in CI and a random id, kept in\n' +
    `  ${file}\n` +
    '  Nothing about your repos, and this build sent nothing.\n' +
    `  To turn it off: ${TURN_OFF}.\n` +
    `  Details: ${TELEMETRY_DOCS}\n`
  );
}

function ciNotice(project: string | undefined): string {
  const sends = project
    ? 'the Furio version, the operating system, that it ran in CI and a coarse fingerprint of this ' +
      'repository: one of 1,048,576 values, not enough to tell it from a thousand others. No name, ' +
      'no path, no id.'
    : 'the Furio version, the operating system and that it ran in CI. Nothing about your repos, ' +
      'and no id.';
  return (
    `note: Furio counts builds, anonymously: this one sends ${sends} ` +
    `FURIO_TELEMETRY=0 turns it off. Details: ${TELEMETRY_DOCS}\n`
  );
}

/** Counts one build, if this machine counts. Never throws and never waits: a build comes first. */
export function countBuild(io: TelemetryHost): void {
  const telemetry = io.telemetry;
  if (!telemetry || telemetryOff(io.env)) return;
  try {
    const deliver = (event: TelemetryEvent) => {
      const body = JSON.stringify(event);
      if (isSet(io.env.FURIO_TELEMETRY_DEBUG))
        io.stderr(`telemetry (FURIO_TELEMETRY_DEBUG is set, nothing is sent): ${body}\n`);
      else telemetry.send({ url: TELEMETRY_URL, body, userAgent: `furio/${VERSION}` });
    };
    const state = telemetry.file ? readState(telemetry.file) : {};
    if (state.enabled === false) return;
    if (isCI(io.env)) {
      const project = projectFingerprint(io.env);
      io.stderr(ciNotice(project));
      deliver(
        buildEvent({
          version: VERSION,
          platform: telemetry.platform,
          ci: true,
          ...(project ? { project } : {}),
        }),
      );
      return;
    }
    if (!telemetry.file) return;
    if (!state.id || !state.noticed) {
      const noticed = (telemetry.now?.() ?? new Date()).toISOString();
      const id = state.id ?? (telemetry.randomId ?? newId)();
      // Nowhere to remember that this machine was told: then nothing is said, and nothing sent.
      if (writeState(telemetry.file, { id, enabled: true, noticed })) return;
      io.stderr(firstNotice(telemetry.file));
      return;
    }
    deliver(
      buildEvent({ version: VERSION, platform: telemetry.platform, ci: false, id: state.id }),
    );
  } catch {
    // Counting is a courtesy to us: it never gets in the way of a build.
  }
}

export class TelemetryError extends Error {}

/** `furio telemetry [status|enable|disable]`: what is sent, whether it is on, and the switch. */
export function telemetryCommand(action: string | undefined, io: TelemetryHost): string {
  const telemetry = io.telemetry;
  if (action !== undefined && !['status', 'enable', 'disable'].includes(action))
    throw new TelemetryError(
      `Unknown action "${action}": use furio telemetry, furio telemetry enable or furio telemetry disable.`,
    );
  const details = `Details: ${TELEMETRY_DOCS}\n`;
  if (!telemetry)
    return (
      'Telemetry is off: Furio counts builds only as the published package, never when it runs ' +
      `from its sources.\n${details}`
    );
  const file = telemetry.file;
  if (action === 'enable' || action === 'disable') {
    if (!file)
      throw new TelemetryError(
        'There is no home folder to keep the choice in. Set FURIO_TELEMETRY=0 to turn telemetry off.',
      );
    const state = readState(file);
    const next: State =
      action === 'disable'
        ? { ...state, enabled: false }
        : {
            id: state.id ?? (telemetry.randomId ?? newId)(),
            enabled: true,
            // Turning it on by hand is knowing about it.
            noticed: state.noticed ?? (telemetry.now?.() ?? new Date()).toISOString(),
          };
    const failed = writeState(file, next);
    if (failed)
      throw new TelemetryError(
        `Could not write ${file} (${failed}). Set FURIO_TELEMETRY=0 to turn telemetry off.`,
      );
  }

  const state = file ? readState(file) : {};
  if (state.enabled === false)
    return `Telemetry is off: no build is counted. The choice is kept in ${file}\nTurn it back on: furio telemetry enable\n${details}`;
  const variable = telemetryOff(io.env);
  if (variable) {
    const wins = state.enabled ? `, and it wins over the choice kept in ${file}` : '';
    return `Telemetry is off: ${variable} is set${wins}.\n${details}`;
  }
  const ci = isCI(io.env);
  if (!ci && !file)
    return `Telemetry is off: there is no home folder to keep the id and the choice in.\n${details}`;

  const project = ci ? projectFingerprint(io.env) : undefined;
  const event = (id?: string) => {
    const build = {
      version: VERSION,
      platform: telemetry.platform,
      ci,
      ...(id ? { id } : {}),
      ...(project ? { project } : {}),
    };
    return `  ${JSON.stringify(buildEvent(build))}`;
  };
  const lines = ci
    ? [
        'Telemetry is on. This is CI: each "furio build" sends one anonymous event, ' +
          (project
            ? `with a coarse fingerprint of this repository (${project}) in place of an id:`
            : 'without an id:'),
        event(),
        'Turn it off: FURIO_TELEMETRY=0 or DO_NOT_TRACK=1.',
      ]
    : state.id && state.noticed
      ? [
          'Telemetry is on. Each "furio build" sends one anonymous event:',
          event(state.id),
          `The id is random, made on this machine and kept in ${file}`,
          `Turn it off: ${TURN_OFF}.`,
        ]
      : [
          'Telemetry is on, and nothing was sent yet: the first "furio build" on this machine says so',
          'and sends nothing. From the second, each build sends the Furio version, the operating',
          'system, whether it ran in CI and a random id, made on this machine and kept in',
          `${file}`,
          `Turn it off: ${TURN_OFF}.`,
        ];
  return `${lines.join('\n')}\n${details}`;
}

/**
 * The request, as a program for a Node of its own: it outlives the command, which never waits for
 * the network. Whatever goes wrong there stays there.
 */
const SENDER =
  'const [url, body, agent] = process.argv.slice(1);' +
  "fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', 'user-agent': agent }," +
  " body, redirect: 'error', signal: AbortSignal.timeout(5000) }).then((r) => r.arrayBuffer()).catch(() => {});";

/** What the sender gets of the environment: what Windows and a proxy need, and no token. */
const SENDER_ENV = [
  'SystemRoot',
  'SYSTEMROOT',
  'windir',
  'WINDIR',
  'TEMP',
  'TMP',
  'HTTPS_PROXY',
  'https_proxy',
  'HTTP_PROXY',
  'http_proxy',
  'NO_PROXY',
  'no_proxy',
  'NODE_USE_ENV_PROXY',
  'NODE_EXTRA_CA_CERTS',
  'SSL_CERT_FILE',
  'SSL_CERT_DIR',
];

export function senderEnv(env: Record<string, string | undefined>): Record<string, string> {
  return Object.fromEntries(
    SENDER_ENV.flatMap((name) => (env[name] === undefined ? [] : [[name, env[name]]])),
  );
}

/** The counting of the published package: the file of this machine, and a detached sender. */
export function nodeTelemetry(env: Record<string, string | undefined>): TelemetryIo {
  let home: string | undefined;
  try {
    home = homedir() || undefined;
  } catch {
    home = undefined;
  }
  return {
    file: telemetryFile(env, process.platform, home),
    platform: process.platform,
    send({ url, body, userAgent }) {
      try {
        const child = spawn(process.execPath, ['-e', SENDER, '--', url, body, userAgent], {
          detached: true,
          stdio: 'ignore',
          windowsHide: true,
          env: senderEnv(env),
        });
        child.on('error', () => undefined);
        child.unref();
      } catch {
        // No process to spare: the build is not counted.
      }
    },
  };
}
