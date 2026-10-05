import { Check, CircleAlert } from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { extensionHealth, type PanelSection } from '../extensions';
import { ExtensionSection } from '../ui/DetailPanel';
import { STATUS_LABEL, type Site } from '../model';
import { href, linksIn } from '../router';
import { contents, type Scope } from '../scope';
import { PeekLink } from '../ui/Peek';

interface Check {
  id: string;
  /** Section that lists the offenders. */
  target: string;
  label: string;
  /** What a reader should do when the check fails. */
  fix: string;
  count: number;
}

/**
 * How trustworthy the map is: who has not joined, what is invalid, what is missing. In a project's
 * scope, its repos and issues, its components and the ghosts on its map; the repos in no project
 * are the workspace's, counted but not listed.
 */
export function HealthPage({ site, scope }: { site: Site; scope?: Scope | undefined }) {
  const { model } = site;
  const shown = useMemo(() => contents(site, scope), [site, scope]);
  const order = { invalid: 0, valid: 1, skipped: 2 } as const;
  const repos = [...shown.repos].sort(
    (a, b) => order[a.status] - order[b.status] || a.id.localeCompare(b.id),
  );
  const { ghosts, issues } = shown;
  const ownerless = shown.components.filter((c) => !c.owner);
  const invalid = shown.repos.filter((r) => r.status === 'invalid');
  const noManifest = shown.repos.filter(
    (r) => r.status === 'skipped' && r.skipReason === 'no-manifest',
  );
  const warnings = issues.filter((i) => i.severity === 'warning');
  const retired = shown.components.filter((c) => c.status);
  const [extra, setExtra] = useState<PanelSection[]>([]);
  useEffect(() => {
    let live = true;
    void extensionHealth(model, scope?.project).then((s) => live && setExtra(s));
    return () => {
      live = false;
    };
  }, [model, scope]);

  const all: Check[] = [
    {
      id: 'invalid',
      target: 'repos',
      label: 'Repos with an invalid manifest',
      fix: 'They are left out of the map until their manifest validates.',
      count: invalid.length,
    },
    {
      id: 'no-manifest',
      target: 'no-manifest',
      label: 'Repos without a manifest',
      fix: 'Run npx @getfurio/cli init in each to put it on the map.',
      count: noManifest.length,
    },
    {
      id: 'ghosts',
      target: 'ghosts',
      label: 'Referenced but not declared',
      fix: 'Declare them in the repo that owns them, or fix the references.',
      count: ghosts.length,
    },
    {
      id: 'owners',
      target: 'owners',
      label: 'Components without an owner',
      fix: 'Add owner: to the manifest, or to the component.',
      count: ownerless.length,
    },
    {
      id: 'warnings',
      target: 'warnings',
      label: 'Warnings',
      fix: 'Listed under Issues below.',
      count: warnings.length,
    },
  ];
  // A repo without a manifest belongs to no project yet: a scope never has one.
  const checks = scope ? all.filter((c) => c.id !== 'no-manifest') : all;
  const failing = checks.filter((c) => c.count > 0).length;
  const name = <strong>{scope ? scope.project : model.workspace.id}</strong>;
  const where = scope ? <>{name} project</> : <>{name} map</>;

  return (
    <div className="sheet">
      <header className="title-band" style={{ gridTemplateColumns: '1fr' }}>
        <h1 style={{ fontFamily: 'var(--sans)' }}>Health</h1>
        <span className="tb-sub">
          {failing === 0 ? (
            <>Every check passes. The {where} is in order.</>
          ) : (
            <>
              {failing} of {checks.length} checks need attention on the {where}.
            </>
          )}
        </span>
      </header>

      <div className="table-wrap">
        <table className="table checks">
          <thead>
            <tr>
              <th scope="col">Check</th>
              <th scope="col" className="num">
                Count
              </th>
              <th scope="col">What to do</th>
            </tr>
          </thead>
          <tbody>
            {checks.map((c) => (
              <tr key={c.id} className={c.count ? 'is-failing' : ''}>
                <td>
                  <span className="check-label">
                    {c.count ? (
                      <CircleAlert size={15} aria-label="Needs attention" />
                    ) : (
                      <Check size={15} aria-label="Passes" />
                    )}
                    {c.count ? (
                      // Hash links would change the route: scroll to the section instead.
                      <button
                        type="button"
                        className="link"
                        onClick={() =>
                          document.getElementById(c.target)?.scrollIntoView({ behavior: 'smooth' })
                        }
                      >
                        {c.label}
                      </button>
                    ) : (
                      c.label
                    )}
                  </span>
                </td>
                <td className="num mono">{c.count}</td>
                <td>{c.count ? c.fix : ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {scope && shown.unassigned > 0 && (
        <p className="section-note scope-note">
          {shown.unassigned === 1 ? '1 repo' : `${shown.unassigned} repos`} of the workspace{' '}
          {shown.unassigned === 1 ? 'is' : 'are'} in no project: without a manifest, or with one
          Furio could not read. <a href={linksIn().health()}>See the whole workspace</a>
        </p>
      )}

      {extra.length > 0 && (
        <div className="health-extra">
          {extra.map((section, i) => (
            <ExtensionSection key={`${section.title}-${i}`} section={section} />
          ))}
        </div>
      )}

      <Section id="repos" title="Repos" count={repos.length}>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">Repo</th>
                <th scope="col">Project</th>
                <th scope="col">Status</th>
                <th scope="col" className="num">
                  Errors
                </th>
                <th scope="col" className="num">
                  Warnings
                </th>
                <th scope="col">Commit</th>
              </tr>
            </thead>
            <tbody>
              {repos.map((r) => (
                <tr key={r.id}>
                  <td className="mono">{r.url ? <a href={r.url}>{r.id}</a> : r.id}</td>
                  <td className="mono">
                    {r.project ? <a href={href.project(r.project)}>{r.project}</a> : ''}
                  </td>
                  <td>
                    <span className={`status ${r.status}`}>
                      {r.status === 'skipped'
                        ? `skipped: ${r.skipReason?.replace('-', ' ')}`
                        : r.status}
                    </span>
                  </td>
                  <td className="num mono">{r.errors}</td>
                  <td className="num mono">{r.warnings}</td>
                  <td className="mono">
                    {r.commit ? (
                      r.commit.slice(0, 7)
                    ) : r.status === 'skipped' ? (
                      ''
                    ) : (
                      <span className="not-recorded">not recorded</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      {noManifest.length > 0 && (
        <Section id="no-manifest" title="Repos without a manifest" count={noManifest.length}>
          <p className="section-note">
            These repos are in the workspace but describe nothing yet. In each one, run{' '}
            <span className="mono">npx @getfurio/cli init</span>.
          </p>
          <ul className="plain-list">
            {noManifest.map((r) => (
              <li key={r.id} className="mono">
                <a href={r.url}>{r.id}</a>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section id="ghosts" title="Referenced but not declared" count={ghosts.length}>
        {ghosts.length === 0 ? (
          <p className="empty-state">Every referenced component is declared by some repo.</p>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">Component</th>
                  <th scope="col">Referenced by</th>
                </tr>
              </thead>
              <tbody>
                {ghosts.map((g) => (
                  <tr key={g.key}>
                    <td>
                      <PeekLink className="mono" componentKey={g.key}>
                        {g.key}
                      </PeekLink>
                      <span className="ghost-tag">Not declared</span>
                    </td>
                    <td className="mono">
                      {[...new Set((site.incoming.get(g.key) ?? []).map((r) => r.repo))].join(', ')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <Section id="owners" title="Components without an owner" count={ownerless.length}>
        {ownerless.length === 0 ? (
          <p className="empty-state">Every declared component has an owner.</p>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">Component</th>
                  <th scope="col">Declared in</th>
                </tr>
              </thead>
              <tbody>
                {ownerless.map((c) => (
                  <tr key={c.key}>
                    <td>
                      <PeekLink className="mono" componentKey={c.key}>
                        {c.key}
                      </PeekLink>
                    </td>
                    <td className="mono">{c.repo}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      {retired.length > 0 && (
        <Section id="retired" title="Deprecated and dev-only" count={retired.length}>
          <p className="section-note">
            On the map but quieter: on their way out, or only for development and CI.
          </p>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">Component</th>
                  <th scope="col">Status</th>
                  <th scope="col">Used by</th>
                </tr>
              </thead>
              <tbody>
                {retired.map((c) => {
                  const users = site.incoming.get(c.key) ?? [];
                  return (
                    <tr key={c.key}>
                      <td>
                        <PeekLink className="mono" componentKey={c.key}>
                          {c.key}
                        </PeekLink>
                      </td>
                      <td>{STATUS_LABEL[c.status!]}</td>
                      <td className="mono">
                        {users.length ? [...new Set(users.map((r) => r.from))].join(', ') : ''}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Section>
      )}

      <Section id="warnings" title="Issues" count={issues.length}>
        {issues.length === 0 ? (
          <p className="empty-state">
            No issues. Every manifest {scope ? `of ${scope.project}` : 'on the map'} is valid.
          </p>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">Severity</th>
                  <th scope="col">Repo</th>
                  <th scope="col">Where</th>
                  <th scope="col">Problem</th>
                </tr>
              </thead>
              <tbody>
                {issues.map((issue, i) => (
                  <tr key={i}>
                    <td className={`sev-${issue.severity}`}>{issue.severity}</td>
                    <td className="mono">{issue.repo}</td>
                    <td className="mono">
                      {issue.file}
                      {issue.line ? `:${issue.line}` : ''}
                    </td>
                    <td>
                      {issue.message}
                      {issue.hint && <div className="hint">{issue.hint}</div>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>
    </div>
  );
}

function Section({
  id,
  title,
  count,
  children,
}: {
  id: string;
  title: string;
  count: number;
  children: ReactNode;
}) {
  return (
    <section className="section" aria-labelledby={`${id}-title`} id={id}>
      <h2 id={`${id}-title`}>
        {title} <span className="count">{count}</span>
      </h2>
      {children}
    </section>
  );
}
