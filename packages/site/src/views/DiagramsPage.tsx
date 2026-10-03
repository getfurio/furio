import { ArrowRight, Workflow } from 'lucide-react';
import { useEffect, useMemo } from 'react';
import type { Site } from '../model';
import { href } from '../router';
import { Diagram } from '../ui/Diagram';
import { PeekLink } from '../ui/Peek';

export const DIAGRAMS_GUIDE = 'https://getfurio.com/docs/manifest#diagrams';

/** Every diagram of the workspace, by project, each linked to the components it describes. */
export function DiagramsPage({ site, selected }: { site: Site; selected?: string }) {
  const { diagrams } = site.model;
  const byProject = useMemo(() => {
    const groups = new Map<string, typeof diagrams>();
    for (const d of [...diagrams].sort((a, b) => a.title.localeCompare(b.title)))
      (groups.get(d.project) ?? groups.set(d.project, []).get(d.project)!).push(d);
    return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [diagrams]);
  const anchor = (key: string) => `diagram-${diagrams.findIndex((d) => d.key === key)}`;

  useEffect(() => {
    if (!selected) return;
    // Mermaid renders after mount and moves things down: scroll again once it has drawn.
    const scroll = () =>
      document.getElementById(anchor(selected))?.scrollIntoView({ block: 'start' });
    const frame = requestAnimationFrame(scroll);
    const later = setTimeout(scroll, 600);
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(later);
    };
  }, [selected]);

  return (
    <div className="sheet">
      <header className="title-band" style={{ gridTemplateColumns: '1fr' }}>
        <h1 style={{ fontFamily: 'var(--sans)' }}>Diagrams</h1>
        <span className="tb-sub">
          {diagrams.length === 0 ? (
            <>
              No diagrams on the <strong>{site.model.workspace.id}</strong> map yet.
            </>
          ) : (
            <>
              {diagrams.length} {diagrams.length === 1 ? 'diagram' : 'diagrams'} in{' '}
              {byProject.length} {byProject.length === 1 ? 'project' : 'projects'}: the flows a
              graph cannot show.
            </>
          )}
        </span>
      </header>

      {diagrams.length === 0 ? (
        <div className="empty-diagrams">
          <Workflow size={20} aria-hidden />
          <div>
            <p>
              Diagrams live next to the manifest, in{' '}
              <span className="mono">.architecture/diagrams/</span>: a{' '}
              <span className="mono">.mmd</span> file with one Mermaid diagram, or a{' '}
              <span className="mono">.md</span> file with <span className="mono">```mermaid</span>{' '}
              blocks. List each one under <span className="mono">diagrams:</span> with a title and
              the components it describes:
            </p>
            <pre className="code">{`diagrams:
  - file: diagrams/checkout-flow.mmd
    title: Checkout flow
    components: [shop-api, platform/payments]`}</pre>
            <a className="button quiet" href={DIAGRAMS_GUIDE} rel="noreferrer" target="_blank">
              How to add diagrams <ArrowRight size={13} aria-hidden />
            </a>
          </div>
        </div>
      ) : (
        <>
          <nav className="diagram-index" aria-label="Diagrams by project">
            {byProject.map(([project, list]) => (
              <div key={project}>
                <h2>
                  <span
                    className="dot"
                    style={{ background: site.projectColor.get(project) }}
                    aria-hidden
                  />
                  <a href={href.project(project)}>{project}</a>
                  <span className="count">{list.length}</span>
                </h2>
                <ul>
                  {list.map((d) => (
                    <li key={d.key}>
                      <a href={href.diagrams(d.key)} aria-current={d.key === selected || undefined}>
                        {d.title}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </nav>

          {byProject.map(([project, list]) => (
            <section className="section" key={project} aria-labelledby={`dg-${project}`}>
              <h2 id={`dg-${project}`}>
                {project} <span className="count">{list.length}</span>
              </h2>
              {list.map((d) => (
                <Diagram key={d.key} diagram={d} id={anchor(d.key)}>
                  {d.components.length > 0 && (
                    <figcaption className="diagram-parts">
                      <span>Describes</span>
                      {d.components.map((key) => (
                        <PeekLink key={key} className="tag mono" componentKey={key}>
                          {key}
                        </PeekLink>
                      ))}
                    </figcaption>
                  )}
                </Diagram>
              ))}
            </section>
          ))}
        </>
      )}
    </div>
  );
}
