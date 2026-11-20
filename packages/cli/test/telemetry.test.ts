import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isbot } from 'isbot';
import { describe, expect, it } from 'vitest';
import { run, type Io } from '../src/main.js';
import {
  buildEvent,
  countBuild,
  isCI,
  nodeTelemetry,
  PROJECT_FINGERPRINTS,
  projectFingerprint,
  senderEnv,
  TELEMETRY_DOCS,
  TELEMETRY_SITE,
  TELEMETRY_URL,
  telemetryFile,
  telemetryOff,
  type TelemetryHost,
  type TelemetryRequest,
} from '../src/telemetry.js';
import { VERSION } from '../src/version.js';

const ROOT = join(import.meta.dirname, '../../..');
const ID = '0123456789012345678901234';
const NOW = '2026-11-20T10:00:00.000Z';

/** A machine with a home of its own, and a sender that only remembers. */
function machine(env: Record<string, string> = {}, file?: string) {
  const home = mkdtempSync(join(tmpdir(), 'furio-telemetry-'));
  const path = file ?? join(home, 'furio', 'telemetry.json');
  const sent: TelemetryRequest[] = [];
  const out = { stdout: '', stderr: '' };
  const host: TelemetryHost & Pick<Io, 'stdout' | 'cwd' | 'isTTY'> = {
    stdout: (text) => void (out.stdout += text),
    stderr: (text) => void (out.stderr += text),
    cwd: ROOT,
    isTTY: false,
    env,
    telemetry: {
      file: path,
      platform: 'linux',
      send: (request) => void sent.push(request),
      randomId: () => ID,
      now: () => new Date(NOW),
    },
  };
  return {
    host,
    home,
    file: path,
    sent,
    out,
    state: () => JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>,
    /** As after a first build: told, with an id. */
    told() {
      countBuild(host);
      out.stderr = '';
      return this;
    },
  };
}

describe('telemetry', () => {
  it('says so on the first build and sends nothing; later builds send one event', () => {
    const m = machine();
    countBuild(m.host);
    expect(m.sent).toEqual([]);
    expect(m.out.stderr).toContain('Furio counts builds, anonymously');
    expect(m.out.stderr).toContain(m.file);
    expect(m.out.stderr).toContain('this build sent nothing');
    expect(m.out.stderr).toContain('furio telemetry disable');
    expect(m.out.stderr).toContain('https://getfurio.com/docs/github-action/#telemetry');
    expect(m.state()).toEqual({ id: ID, enabled: true, noticed: NOW });

    m.out.stderr = '';
    countBuild(m.host);
    countBuild(m.host);
    expect(m.out.stderr).toBe('');
    expect(m.sent).toHaveLength(2);
    expect(m.sent[0]).toMatchObject({ url: TELEMETRY_URL, userAgent: `furio/${VERSION}` });
  });

  it('sends the version, the system, CI or not and the id, and nothing else', () => {
    const m = machine().told();
    countBuild(m.host);
    expect(JSON.parse(m.sent[0]!.body)).toEqual({
      type: 'event',
      payload: {
        website: TELEMETRY_SITE,
        hostname: 'cli.getfurio.com',
        url: `/build/local/${VERSION}`,
        os: 'Linux',
        id: ID,
        userAgent: `Furio (linux; ${ID})`,
        ip: '127.0.0.1',
      },
    });
    expect(TELEMETRY_URL).toBe('https://stats.getfurio.com/api/send');
    expect(TELEMETRY_SITE).toMatch(/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/);
    expect(buildEvent({ version: '1.2.3', platform: 'darwin', ci: false, id: ID }).payload).toEqual(
      expect.objectContaining({ url: '/build/local/1.2.3', os: 'Mac OS' }),
    );
    expect(buildEvent({ version: '1.2.3', platform: 'win32', ci: true }).payload.os).toBe(
      'Windows',
    );
    expect(buildEvent({ version: '1.2.3', platform: 'freebsd', ci: true }).payload.os).toBe(
      'freebsd',
    );
  });

  it('stays off with FURIO_TELEMETRY=0 or DO_NOT_TRACK, before anything is written', () => {
    const off: Record<string, string>[] = [
      { FURIO_TELEMETRY: '0' },
      { FURIO_TELEMETRY: 'false' },
      { FURIO_TELEMETRY: 'OFF' },
      { FURIO_TELEMETRY: 'no' },
      { DO_NOT_TRACK: '1' },
      { DO_NOT_TRACK: 'true' },
      { CI: 'true', FURIO_TELEMETRY: '0' },
      { GITHUB_ACTIONS: 'true', DO_NOT_TRACK: '1' },
    ];
    for (const env of off) {
      const m = machine(env);
      countBuild(m.host);
      countBuild(m.host);
      expect(m.sent).toEqual([]);
      expect(m.out.stderr).toBe('');
      expect(existsSync(m.file)).toBe(false);
    }
    expect(telemetryOff({ FURIO_TELEMETRY: '0' })).toBe('FURIO_TELEMETRY');
    expect(telemetryOff({ DO_NOT_TRACK: '1' })).toBe('DO_NOT_TRACK');
    // Neither of these turns anything off, nor on where the machine said no.
    for (const env of [{}, { FURIO_TELEMETRY: '1' }, { DO_NOT_TRACK: '0' }, { DO_NOT_TRACK: '' }])
      expect(telemetryOff(env)).toBeUndefined();
  });

  it('stays off once turned off on the machine, whatever the environment says', () => {
    for (const env of [{}, { FURIO_TELEMETRY: '1' }, { CI: 'true' }] as Record<string, string>[]) {
      const told = machine().told();
      writeFileSync(told.file, JSON.stringify({ ...told.state(), enabled: false }));
      const m = machine(env, told.file);
      countBuild(m.host);
      expect(m.sent).toEqual([]);
      expect(m.out.stderr).toBe('');
    }
  });

  it('says so on every run in CI, and sends no id and keeps no file', () => {
    const m = machine({ CI: 'true' });
    countBuild(m.host);
    countBuild(m.host);
    expect(existsSync(m.file)).toBe(false);
    expect(m.out.stderr.match(/Furio counts builds, anonymously/g)).toHaveLength(2);
    expect(m.out.stderr).toContain('FURIO_TELEMETRY=0 turns it off');
    expect(m.out.stderr.trimEnd().split('\n')).toHaveLength(2);
    expect(m.sent).toHaveLength(2);
    expect(JSON.parse(m.sent[0]!.body)).toEqual({
      type: 'event',
      payload: {
        website: TELEMETRY_SITE,
        hostname: 'cli.getfurio.com',
        url: `/build/ci/${VERSION}`,
        os: 'Linux',
        userAgent: 'Furio (linux; ci)',
        ip: '127.0.0.1',
      },
    });
    // A machine that already has an id sends none from CI either.
    const local = machine().told();
    const runner = machine({ GITHUB_ACTIONS: 'true' }, local.file);
    countBuild(runner.host);
    expect(JSON.parse(runner.sent[0]!.body)).toEqual(JSON.parse(m.sent[0]!.body));
  });

  it('says in GitHub Actions, coarsely, which project builds', () => {
    const actions = { GITHUB_ACTIONS: 'true', GITHUB_REPOSITORY_ID: '123456789' };
    const m = machine(actions);
    countBuild(m.host);
    expect(JSON.parse(m.sent[0]!.body)).toEqual({
      type: 'event',
      payload: {
        website: TELEMETRY_SITE,
        hostname: 'cli.getfurio.com',
        url: `/build/ci/${VERSION}`,
        os: 'Linux',
        userAgent: 'Furio (linux; ci 0119903)',
        ip: '127.0.0.1',
      },
    });
    // The note of the log says so, still on one line.
    expect(m.out.stderr).toContain('a coarse fingerprint of this repository');
    expect(m.out.stderr).toContain('1,048,576');
    expect(m.out.stderr).toContain('No name, no path, no id.');
    expect(m.out.stderr.trimEnd().split('\n')).toHaveLength(1);
    expect(existsSync(m.file)).toBe(false);

    // The same repository always says the same, another one something else, on any server.
    expect(projectFingerprint(actions)).toBe('0119903');
    expect(projectFingerprint({ ...actions, GITHUB_SERVER_URL: 'https://github.com' })).toBe(
      '0119903',
    );
    expect(projectFingerprint({ ...actions, GITHUB_SERVER_URL: 'HTTPS://GitHub.com/' })).toBe(
      '0119903',
    );
    expect(projectFingerprint({ ...actions, GITHUB_REPOSITORY_ID: '987654321' })).toBe('0535715');
    expect(projectFingerprint({ ...actions, GITHUB_SERVER_URL: 'https://ghe.example.com' })).toBe(
      '0347369',
    );
    // Neither the name nor the owner is read: nothing of them can come out.
    expect(
      projectFingerprint({
        ...actions,
        GITHUB_REPOSITORY: 'acme/catalog',
        GITHUB_REPOSITORY_OWNER: 'acme',
        GITHUB_REPOSITORY_OWNER_ID: '42',
      }),
    ).toBe('0119903');
  });

  it('makes no fingerprint outside GitHub Actions, or from a number that is not one', () => {
    const none: Record<string, string>[] = [
      {},
      { GITHUB_REPOSITORY_ID: '123456789' },
      { CI: 'true', GITHUB_REPOSITORY_ID: '123456789' },
      { GITHUB_ACTIONS: 'true' },
      { GITHUB_ACTIONS: 'false', GITHUB_REPOSITORY_ID: '123456789' },
      { GITHUB_ACTIONS: 'true', GITHUB_REPOSITORY_ID: '' },
      { GITHUB_ACTIONS: 'true', GITHUB_REPOSITORY_ID: '12a' },
      { GITHUB_ACTIONS: 'true', GITHUB_REPOSITORY_ID: '-5' },
      { GITHUB_ACTIONS: 'true', GITHUB_REPOSITORY_ID: ' 12' },
      { GITHUB_ACTIONS: 'true', GITHUB_REPOSITORY_ID: '1'.repeat(21) },
    ];
    for (const env of none) expect(projectFingerprint(env)).toBeUndefined();
    // Another CI: counted as before, with no word about a fingerprint.
    const m = machine({ GITLAB_CI: 'true', GITHUB_REPOSITORY_ID: '123456789' });
    countBuild(m.host);
    expect(JSON.parse(m.sent[0]!.body).payload.userAgent).toBe('Furio (linux; ci)');
    expect(m.out.stderr).not.toContain('fingerprint');
    // A machine's own build never carries one, even with the variables of a runner around.
    const local = machine({ GITHUB_REPOSITORY_ID: '123456789' }).told();
    countBuild(local.host);
    expect(JSON.parse(local.sent[0]!.body).payload.userAgent).toBe(`Furio (linux; ${ID})`);
  });

  it('keeps the fingerprint coarse and even: a million values, each one a crowd', () => {
    expect(PROJECT_FINGERPRINTS).toBe(1_048_576);
    const seen = new Set<string>();
    const count = 50_000;
    for (let id = 1_400_000_000; id < 1_400_000_000 + count; id++) {
      const value = projectFingerprint({
        GITHUB_ACTIONS: 'true',
        GITHUB_REPOSITORY_ID: String(id),
      })!;
      expect(value).toMatch(/^\d{7}$/);
      expect(Number(value)).toBeLessThan(PROJECT_FINGERPRINTS);
      seen.add(value);
    }
    // As many different values as chance gives: neither a counter in disguise, nor a few values.
    const byChance = PROJECT_FINGERPRINTS * (1 - Math.exp(-count / PROJECT_FINGERPRINTS));
    expect(Math.abs(seen.size - byChance) / byChance).toBeLessThan(0.01);
    // GitHub's repository numbers passed 1.4 billion in 2026: this many share each value.
    expect(1_400_000_000 / PROJECT_FINGERPRINTS).toBeGreaterThan(1000);
  });

  // On a GitHub runner the number is there: if GitHub stops giving it, this says so.
  it.runIf(process.env.GITHUB_ACTIONS === 'true')(
    'finds the number of the repository on a real GitHub runner',
    () => {
      expect(process.env.GITHUB_REPOSITORY_ID).toMatch(/^\d+$/);
      expect(projectFingerprint(process.env)).toMatch(/^\d{7}$/);
    },
  );

  it('knows a CI when it sees one', () => {
    for (const name of [
      'CI',
      'GITHUB_ACTIONS',
      'GITLAB_CI',
      'BUILDKITE',
      'TF_BUILD',
      'JENKINS_URL',
    ])
      expect(isCI({ [name]: name === 'JENKINS_URL' ? 'https://ci.example.com' : 'true' })).toBe(
        true,
      );
    for (const env of [{}, { CI: '' }, { CI: 'false' }, { CI: '0' }, { HOME: '/home/user' }])
      expect(isCI(env)).toBe(false);
  });

  it('says and sends nothing when the choice cannot be kept', () => {
    const blocked = machine();
    // A file where the folder should be: nothing can be written under it.
    writeFileSync(join(blocked.home, 'furio'), '');
    countBuild(blocked.host);
    countBuild(blocked.host);
    expect(blocked.sent).toEqual([]);
    expect(blocked.out.stderr).toBe('');

    const homeless = machine();
    homeless.host.telemetry!.file = undefined;
    countBuild(homeless.host);
    expect(homeless.sent).toEqual([]);
    expect(homeless.out.stderr).toBe('');
  });

  it('starts over from a file it cannot trust', () => {
    for (const text of [
      'not json',
      '[]',
      'null',
      JSON.stringify({ id: 'feedface', noticed: NOW }),
    ]) {
      const m = machine().told();
      writeFileSync(m.file, text);
      countBuild(m.host);
      expect(m.sent).toEqual([]);
      expect(m.out.stderr).toContain('this build sent nothing');
      expect(m.state()).toEqual({ id: ID, enabled: true, noticed: NOW });
    }
  });

  it('prints the event instead of sending it with FURIO_TELEMETRY_DEBUG', () => {
    const m = machine({ FURIO_TELEMETRY_DEBUG: '1' }).told();
    countBuild(m.host);
    expect(m.sent).toEqual([]);
    expect(m.out.stderr).toContain('nothing is sent');
    expect(m.out.stderr).toContain(`"url":"/build/local/${VERSION}"`);
  });

  it('never gets in the way of a build', () => {
    const m = machine().told();
    m.host.telemetry!.send = () => {
      throw new Error('no network');
    };
    expect(() => countBuild(m.host)).not.toThrow();
    expect(m.out.stderr).toBe('');
    // No counting at all: tests, and runs from the sources.
    expect(() => countBuild({ env: {}, stderr: () => undefined })).not.toThrow();
  });

  it('keeps its file where the system keeps settings', () => {
    expect(telemetryFile({ XDG_CONFIG_HOME: '/xdg' }, 'linux', '/home/user')).toBe(
      join('/xdg', 'furio', 'telemetry.json'),
    );
    expect(telemetryFile({}, 'darwin', '/Users/user')).toBe(
      join('/Users/user', '.config', 'furio', 'telemetry.json'),
    );
    expect(telemetryFile({ APPDATA: 'C:\\Users\\user\\AppData\\Roaming' }, 'win32', 'C:\\x')).toBe(
      join('C:\\Users\\user\\AppData\\Roaming', 'furio', 'telemetry.json'),
    );
    // Only Windows reads APPDATA.
    expect(telemetryFile({ APPDATA: '/appdata' }, 'linux', '/home/user')).toBe(
      join('/home/user', '.config', 'furio', 'telemetry.json'),
    );
    expect(telemetryFile({}, 'linux', undefined)).toBeUndefined();
  });

  /**
   * The analytics server drops, without a word, an event whose user agent its bot filter (isbot)
   * knows. If a new isbot starts knowing ours, this fails here before builds stop being counted.
   */
  it('names a user agent the analytics server does not take for a bot', () => {
    const platforms = ['aix', 'android', 'darwin', 'freebsd', 'linux', 'openbsd', 'sunos', 'win32'];
    let seed = 20261120;
    const digit = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return Math.floor((seed / 2147483648) * 10);
    };
    for (const platform of platforms) {
      expect(isbot(buildEvent({ version: VERSION, platform, ci: true }).payload.userAgent)).toBe(
        false,
      );
      for (let i = 0; i < 500; i++) {
        const id = Array.from({ length: 25 }, digit).join('');
        const event = buildEvent({ version: VERSION, platform, ci: false, id });
        expect(isbot(event.payload.userAgent), event.payload.userAgent).toBe(false);
      }
      for (let value = 0; value < PROJECT_FINGERPRINTS; value += 251) {
        const project = String(value).padStart(7, '0');
        const event = buildEvent({ version: VERSION, platform, ci: true, project });
        expect(isbot(event.payload.userAgent), event.payload.userAgent).toBe(false);
      }
    }
    // The filter is real: this is what it does to a hex id that spells a word.
    expect(isbot('Furio (linux; 8feedce1-9542-4578-942b-f4d77de5e668)')).toBe(true);
  });

  it('makes ids of 25 digits, one per machine', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 50; i++) {
      const m = machine();
      delete m.host.telemetry!.randomId;
      countBuild(m.host);
      const { id } = m.state() as { id: string };
      expect(id).toMatch(/^\d{25}$/);
      ids.add(id);
    }
    expect(ids.size).toBe(50);
  });
});

describe('furio build and furio telemetry', () => {
  async function cli(m: ReturnType<typeof machine>, args: string[]) {
    m.out.stdout = '';
    m.out.stderr = '';
    const code = await run(args, m.host);
    return { code, ...m.out };
  }
  const build = (m: ReturnType<typeof machine>) => [
    'build',
    '--workspace',
    'acme',
    '--out',
    join(m.home, 'out', 'model.json'),
    'examples/demo/shop-api',
  ];

  it('counts a build, once, after writing the model', async () => {
    const m = machine().told();
    const { code, stdout, stderr } = await cli(m, build(m));
    expect(code).toBe(0);
    expect(stdout).toContain('Workspace acme');
    expect(stderr).toBe('');
    expect(m.sent).toHaveLength(1);
    expect(existsSync(join(m.home, 'out', 'model.json'))).toBe(true);
  });

  it('tells a new machine on standard error, after the report', async () => {
    const m = machine();
    const { code, stdout, stderr } = await cli(m, build(m));
    expect(code).toBe(0);
    expect(stdout).toContain('Workspace acme');
    expect(stdout).not.toContain('counts builds');
    expect(stderr).toContain('Furio counts builds, anonymously');
    expect(m.sent).toEqual([]);
  });

  it('counts no other command, and no build that did not run', async () => {
    const m = machine().told();
    expect((await cli(m, ['validate', 'examples/demo/shop-api'])).code).toBe(0);
    expect((await cli(m, ['build', 'examples/demo/shop-api'])).code).toBe(2);
    expect((await cli(m, ['--version'])).code).toBe(0);
    expect(m.sent).toEqual([]);
  });

  it('counts nothing without the counting of the published package', async () => {
    const m = machine();
    delete m.host.telemetry;
    const { code, stderr } = await cli(m, build(m));
    expect(code).toBe(0);
    expect(stderr).toBe('');
    expect(existsSync(m.file)).toBe(false);
    const status = await cli(m, ['telemetry']);
    expect(status.code).toBe(0);
    expect(status.stdout).toContain('Telemetry is off: Furio counts builds only as the published');
  });

  it('shows what a build sends, and whether it does', async () => {
    const fresh = machine();
    const before = await cli(fresh, ['telemetry']);
    expect(before.code).toBe(0);
    expect(before.stdout).toContain('Telemetry is on, and nothing was sent yet');
    expect(before.stdout).toContain(fresh.file);
    // Asking changes nothing.
    expect(existsSync(fresh.file)).toBe(false);

    const m = machine().told();
    const status = await cli(m, ['telemetry', 'status']);
    expect(status.stdout).toContain(
      'Telemetry is on. Each "furio build" sends one anonymous event',
    );
    expect(status.stdout).toContain(
      JSON.stringify(buildEvent({ version: VERSION, platform: 'linux', ci: false, id: ID })),
    );
    expect(status.stdout).toContain('https://getfurio.com/docs/github-action/#telemetry');
    expect(m.sent).toEqual([]);

    const ci = await cli(machine({ CI: 'true' }), ['telemetry']);
    expect(ci.stdout).toContain('This is CI');
    expect(ci.stdout).toContain('without an id:');
    expect(ci.stdout).toContain(
      JSON.stringify(buildEvent({ version: VERSION, platform: 'linux', ci: true })),
    );
    const actions = await cli(
      machine({ GITHUB_ACTIONS: 'true', GITHUB_REPOSITORY_ID: '123456789' }),
      ['telemetry'],
    );
    expect(actions.stdout).toContain(
      'with a coarse fingerprint of this repository (0119903) in place of an id:',
    );
    expect(actions.stdout).toContain('"userAgent":"Furio (linux; ci 0119903)"');

    expect((await cli(machine({ DO_NOT_TRACK: '1' }), ['telemetry'])).stdout).toContain(
      'Telemetry is off: DO_NOT_TRACK is set.',
    );
    expect((await cli(machine({ FURIO_TELEMETRY: '0' }), ['telemetry'])).stdout).toContain(
      'Telemetry is off: FURIO_TELEMETRY is set.',
    );
  });

  it('turns counting off and on again on the machine', async () => {
    const m = machine().told();
    const off = await cli(m, ['telemetry', 'disable']);
    expect(off.code).toBe(0);
    expect(off.stdout).toContain('Telemetry is off: no build is counted.');
    expect(m.state()).toEqual({ id: ID, enabled: false, noticed: NOW });
    await cli(m, build(m));
    expect(m.sent).toEqual([]);
    expect((await cli(m, ['telemetry'])).stdout).toContain(
      'Telemetry is off: no build is counted.',
    );

    const on = await cli(m, ['telemetry', 'enable']);
    expect(on.stdout).toContain('Telemetry is on. Each "furio build" sends one anonymous event');
    await cli(m, build(m));
    expect(m.sent).toHaveLength(1);

    // Off before any build: no id is ever made. On by hand: the next build already counts.
    const fresh = machine();
    await cli(fresh, ['telemetry', 'disable']);
    expect(fresh.state()).toEqual({ enabled: false });
    const keen = machine();
    await cli(keen, ['telemetry', 'enable']);
    expect(keen.state()).toEqual({ id: ID, enabled: true, noticed: NOW });
    const first = await cli(keen, build(keen));
    expect(first.stderr).toBe('');
    expect(keen.sent).toHaveLength(1);

    // The variable wins over the choice on the machine, and says so.
    const both = machine({ FURIO_TELEMETRY: '0' });
    expect((await cli(both, ['telemetry', 'enable'])).stdout).toContain(
      `FURIO_TELEMETRY is set, and it wins over the choice kept in ${both.file}`,
    );
  });

  it('explains what it cannot do', async () => {
    const m = machine();
    const unknown = await cli(m, ['telemetry', 'pause']);
    expect(unknown.code).toBe(2);
    expect(unknown.stderr).toContain('Unknown action "pause"');
    expect((await cli(m, ['telemetry', 'enable', 'now'])).code).toBe(2);

    const blocked = machine();
    writeFileSync(join(blocked.home, 'furio'), '');
    const failed = await cli(blocked, ['telemetry', 'disable']);
    expect(failed.code).toBe(2);
    expect(failed.stderr).toContain(`Could not write ${blocked.file}`);
    expect(failed.stderr).toContain('FURIO_TELEMETRY=0');

    const typo = await cli(m, ['telemtry']);
    expect(typo.stderr).toContain('Did you mean "furio telemetry"?');
    const help = (await cli(m, ['--help'])).stdout;
    expect(help).toContain('furio telemetry [enable|disable]');
    expect(help).toContain('a coarse fingerprint of the repository');
  });
});

describe('the guide', () => {
  it('shows the event a build sends, field for field', () => {
    const guide = readFileSync(join(ROOT, 'docs/guide/github-action.md'), 'utf8');
    const chapter = guide.slice(guide.indexOf('### Telemetry'), guide.indexOf('### Exit codes'));
    const shown = JSON.parse(/```json\n([\s\S]*?)```/.exec(chapter)![1]!) as {
      payload: { url: string; id: string };
    };
    const version = /^\/build\/local\/(.+)$/.exec(shown.payload.url)![1]!;
    expect(shown).toEqual(
      buildEvent({ version, platform: 'linux', ci: false, id: shown.payload.id }),
    );
    // Every field of the event has its row in the table, and the page the notes point to exists.
    for (const field of Object.keys(shown.payload)) expect(chapter).toContain(`\`${field}\``);
    expect(TELEMETRY_DOCS).toBe('https://getfurio.com/docs/github-action/#telemetry');
    for (const word of ['FURIO_TELEMETRY=0', 'DO_NOT_TRACK=1', 'furio telemetry disable'])
      expect(chapter).toContain(word);
    // The fingerprint of GitHub Actions: its example is a real one, and the count is the code's.
    const project = /`Furio \(linux; ci (\d{7})\)`/.exec(chapter)![1]!;
    expect(project).toBe(
      projectFingerprint({ GITHUB_ACTIONS: 'true', GITHUB_REPOSITORY_ID: '123456789' }),
    );
    expect(chapter).toContain(PROJECT_FINGERPRINTS.toLocaleString('en-US'));
  });
});

describe('the sender', () => {
  it('posts the event from a process of its own', async () => {
    const received = new Promise<{ method?: string; url?: string; agent?: string; body: string }>(
      (resolve) => {
        const server = createServer((request, response) => {
          let body = '';
          request.on('data', (chunk: Buffer) => (body += chunk.toString()));
          request.on('end', () => {
            response.end('{}');
            server.close();
            resolve({
              ...(request.method ? { method: request.method } : {}),
              ...(request.url ? { url: request.url } : {}),
              ...(request.headers['user-agent'] ? { agent: request.headers['user-agent'] } : {}),
              body,
            });
          });
        });
        server.listen(0, '127.0.0.1', () => {
          const { port } = server.address() as AddressInfo;
          const body = JSON.stringify(
            buildEvent({ version: VERSION, platform: 'linux', ci: false, id: ID }),
          );
          nodeTelemetry({}).send({
            url: `http://127.0.0.1:${port}/api/send`,
            body,
            userAgent: `furio/${VERSION}`,
          });
        });
      },
    );
    const request = await received;
    expect(request).toMatchObject({
      method: 'POST',
      url: '/api/send',
      agent: `furio/${VERSION}`,
    });
    expect(JSON.parse(request.body)).toEqual(
      buildEvent({ version: VERSION, platform: 'linux', ci: false, id: ID }),
    );
  }, 20_000);

  it('passes on what Windows and a proxy need of the environment, and no token', () => {
    expect(
      senderEnv({
        FURIO_UPLOAD_TOKEN: 'secret',
        GITHUB_TOKEN: 'secret',
        NODE_OPTIONS: '--inspect-brk',
        PATH: '/usr/bin',
        SystemRoot: 'C:\\Windows',
        HTTPS_PROXY: 'http://proxy.example.com:3128',
        NO_PROXY: undefined,
      }),
    ).toEqual({ SystemRoot: 'C:\\Windows', HTTPS_PROXY: 'http://proxy.example.com:3128' });
  });

  it('knows the file of this machine, and never throws when nothing answers', () => {
    const telemetry = nodeTelemetry({});
    expect(telemetry.file).toMatch(/furio[\\/]telemetry\.json$/);
    expect(telemetry.platform).toBe(process.platform);
    expect(() =>
      telemetry.send({ url: 'http://127.0.0.1:9/api/send', body: '{}', userAgent: 'furio/0' }),
    ).not.toThrow();
  });
});
