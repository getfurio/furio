import { AlertTriangle, ArrowLeft, ArrowRight, ExternalLink } from 'lucide-react';
import { useEffect } from 'react';
import { BoardView } from '../graph/BoardView';
import { ComponentIcon } from '../graph/parts';
import { codeUrl, impact, STATUS_LABEL, TYPE_LABEL, type ModelRelation, type Site } from '../model';
import { backTarget, go, href } from '../router';
import { mapWith, type Scope } from '../scope';
import { PeekLink } from '../ui/Peek';
import { Diagram } from '../ui/Diagram';

/** One component; in a project's scope, j and k move among the parts its map shows. */
export function ComponentPage({
  site,
  componentKey,
  scope,
}: {
  site: Site;
  componentKey: string;
  scope?: Scope | undefined;
}) {
  const component = site.byKey.get(componentKey);
  const order = scope ? site.order.filter((key) => scope.map.has(key)) : site.order;
  const index = order.indexOf(componentKey);
  const prev = index > 0 ? order[index - 1] : undefined;
  const next = index >= 0 && index < order.length - 1 ? order[index + 1] : undefined;

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return;
      if (event.key === 'j' && next) go(href.component(next));
      if (event.key === 'k' && prev) go(href.component(prev));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [prev, next]);

  useEffect(() => {
    document.querySelector('.page-scroll')?.scrollTo({ top: 0 });
  }, [componentKey]);

  if (!component) {
    return (
      <div className="sheet">
        <div className="empty-state">
          No component <span className="mono">{componentKey}</span> on this map.{' '}
          <a href={href.map()}>Back to the map</a>
        </div>
      </div>
    );
  }

  const incoming = site.incoming.get(component.key) ?? [];
  const outgoing = site.outgoing.get(component.key) ?? [];
  const diagrams = site.model.diagrams.filter((d) => d.components.includes(component.key));
  const repo = site.model.repos.find((r) => r.id === component.repo);
  const links = Object.entries(component.links).filter(([, url]) => /^https?:\/\//i.test(url));
  const code = codeUrl(site, component);
  const back = backTarget();
  let pin = 0;

  return (
    <article className="sheet">
      <header className="title-band">
        <span
          className="tb-ref"
          data-type={component.ghost ? undefined : component.type}
          aria-hidden
        >
          <ComponentIcon component={component} size={22} />
        </span>
        <h1>
          {component.project}/<wbr />
          {component.id}
        </h1>
        <nav className="tb-nav" aria-label="Neighbouring components">
          {back && (
            <a
              className="button"
              href={back}
              onClick={(e) => (e.preventDefault(), history.back())}
              title="Back to the previous page"
            >
              <ArrowLeft size={14} aria-hidden /> Back
            </a>
          )}
          <a
            className="button"
            href={prev ? href.component(prev) : undefined}
            aria-disabled={!prev}
            title="Previous (k)"
          >
            <ArrowLeft size={14} aria-hidden /> k
          </a>
          <a
            className="button"
            href={next ? href.component(next) : undefined}
            aria-disabled={!next}
            title="Next (j)"
          >
            j <ArrowRight size={14} aria-hidden />
          </a>
        </nav>
        <span className="tb-sub">
          {component.ghost ? (
            'Referenced, not declared'
          ) : (
            <>
              <strong>{component.name ?? component.id}</strong> ·{' '}
              {TYPE_LABEL[component.type ?? ''] ?? component.type}
            </>
          )}
        </span>
      </header>

      <dl className="fab-notes">
        <div>
          <dt>Project</dt>
          <dd>
            <a href={href.project(component.project)}>{component.project}</a>
          </dd>
        </div>
        <div>
          <dt>Owner</dt>
          {component.owner ? <dd>{component.owner}</dd> : <dd className="missing">No owner</dd>}
        </div>
        <div>
          <dt>Declared in</dt>
          {repo ? (
            <dd>{repo.url ? <a href={repo.url}>{repo.id}</a> : repo.id}</dd>
          ) : (
            <dd className="missing">No repo</dd>
          )}
        </div>
        {component.provider && (
          <div>
            <dt>Provider</dt>
            <dd>{component.provider}</dd>
          </div>
        )}
        {component.runtime && (
          <div>
            <dt>Runtime</dt>
            <dd>{component.runtime}</dd>
          </div>
        )}
        {component.tech && (
          <div>
            <dt>Tech</dt>
            <dd>{component.tech}</dd>
          </div>
        )}
        {component.host && (
          <div>
            <dt>Host</dt>
            <dd>{component.host}</dd>
          </div>
        )}
        {component.path && (
          <div>
            <dt>Path</dt>
            <dd className="mono">{code ? <a href={code}>{component.path}</a> : component.path}</dd>
          </div>
        )}
        {component.status && (
          <div>
            <dt>Status</dt>
            <dd className="missing">{STATUS_LABEL[component.status]}</dd>
          </div>
        )}
      </dl>

      <div className="neighborhood" aria-label="Connections of this component">
        <BoardView site={site} focus={component.key} chrome={false} />
      </div>

      {component.ghost && (
        <p className="notice">
          <AlertTriangle size={16} aria-hidden />
          <span>
            Other repos point to <span className="mono">{component.key}</span>, but no repo declares
            it. Declare it in the <span className="mono">.architecture/</span> of the repo that owns
            it, or fix the references below.
          </span>
        </p>
      )}

      {component.description && <p className="lede">{component.description}</p>}

      {(component.tags.length > 0 || links.length > 0) && (
        <div className="links">
          {component.tags.length > 0 && (
            <div className="tags" aria-label="Tags">
              {component.tags.map((tag) => (
                <span className="tag" key={tag}>
                  {tag}
                </span>
              ))}
            </div>
          )}
          {links.map(([name, url]) => (
            <a className="button quiet" key={name} href={url} rel="noreferrer">
              {name} <ExternalLink size={13} aria-hidden />
            </a>
          ))}
        </div>
      )}

      <section className="section" aria-labelledby="pins">
        <h2 id="pins">
          Pins <span className="count">{incoming.length + outgoing.length}</span>
        </h2>
        {incoming.length + outgoing.length === 0 ? (
          <p className="empty-state">No relations: nothing calls this part and it calls nothing.</p>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">Pin</th>
                  <th scope="col">Direction</th>
                  <th scope="col">Layer</th>
                  <th scope="col">Connected part</th>
                  <th scope="col">Protocol</th>
                  <th scope="col">Declared in</th>
                </tr>
              </thead>
              <tbody>
                {outgoing.map((r) => (
                  <PinRow key={`o${pin}`} pin={++pin} relation={r} direction="out" site={site} />
                ))}
                {incoming.map((r) => (
                  <PinRow key={`i${pin}`} pin={++pin} relation={r} direction="in" site={site} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <ImpactSection site={site} componentKey={component.key} />

      <section className="section" aria-labelledby="diagrams">
        <h2 id="diagrams">
          Diagrams <span className="count">{diagrams.length}</span>
        </h2>
        {diagrams.length === 0 ? (
          <p className="empty-state">No diagram mentions this part.</p>
        ) : (
          diagrams.map((d) => <Diagram key={d.key} diagram={d} />)
        )}
      </section>
    </article>
  );
}

function PinRow({
  pin,
  relation,
  direction,
  site,
}: {
  pin: number;
  relation: ModelRelation;
  direction: 'in' | 'out';
  site: Site;
}) {
  const other = direction === 'out' ? relation.to : relation.from;
  const part = site.byKey.get(other);
  return (
    <tr>
      <td>
        <span className="pin">{pin}</span>
      </td>
      <td>{direction === 'out' ? 'Out' : 'In'}</td>
      <td>
        <span className={`layer ${relation.type}`}>{relation.type.replace(/_/g, ' ')}</span>
        {relation.critical === false && <span className="non-critical-tag">Non-critical</span>}
      </td>
      <td>
        <PeekLink className="mono" componentKey={other}>
          {other}
        </PeekLink>
        {part?.ghost && <span className="ghost-tag">Not declared</span>}
      </td>
      <td className="mono">{relation.protocol ?? ''}</td>
      <td className="mono">{relation.repo}</td>
    </tr>
  );
}

/** Who breaks if this part goes down, and what it needs to work, transitively. */
function ImpactSection({ site, componentKey }: { site: Site; componentKey: string }) {
  const up = impact(site, componentKey, 'up');
  const down = impact(site, componentKey, 'down');
  const rows = (distance: Map<string, number>) =>
    [...distance.entries()]
      .filter(([, d]) => d > 0)
      .sort(([a, da], [b, db]) => da - db || a.localeCompare(b));

  const table = (
    title: string,
    empty: string,
    distance: Map<string, number>,
    mode: 'impact' | 'depends',
  ) => {
    const list = rows(distance);
    return (
      <div className="impact-col">
        <h3>
          {title} <span className="count">{list.length}</span>
        </h3>
        {list.length === 0 ? (
          <p className="empty-state">{empty}</p>
        ) : (
          <>
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">Part</th>
                  <th scope="col" className="num">
                    Hops
                  </th>
                  <th scope="col">Owner</th>
                </tr>
              </thead>
              <tbody>
                {list.map(([key, hops]) => {
                  const part = site.byKey.get(key);
                  return (
                    <tr key={key}>
                      <td>
                        <PeekLink className="mono" componentKey={key}>
                          {key}
                        </PeekLink>
                        {part?.ghost && <span className="ghost-tag">Not declared</span>}
                      </td>
                      <td className="num mono">{hops}</td>
                      <td className="mono">{part?.owner ?? ''}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <a className="button quiet map-link" href={mapWith(site, componentKey, { mode })}>
              Show on the map <ArrowRight size={13} aria-hidden />
            </a>
          </>
        )}
      </div>
    );
  };

  return (
    <section className="section" aria-labelledby="impact">
      <h2 id="impact">Impact</h2>
      <div className="impact">
        {table('If it goes down', 'Nothing depends on this part.', up.distance, 'impact')}
        {table('It depends on', 'This part depends on nothing declared.', down.distance, 'depends')}
      </div>
    </section>
  );
}
