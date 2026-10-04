import { AlertTriangle, ArrowRight, ExternalLink, Map as MapIcon, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { extensionSections, safeHref, type PanelSection } from '../extensions';
import { ComponentIcon } from '../graph/parts';
import {
  codeUrl,
  displayName,
  STATUS_LABEL,
  TYPE_LABEL,
  type ModelComponent,
  type ModelRelation,
  type Site,
} from '../model';
import { href, type ViewState } from '../router';

const DEPTHS = [1, 2, 3, 0];

export interface DetailPanelProps {
  site: Site;
  component: ModelComponent;
  /** On the map: what is lit. Without it (a quick look from a page) the panel offers the map. */
  view?: ViewState;
  /** Parts lit by the current mode (nets: relations). */
  reached?: number;
  onChange?: (patch: Partial<ViewState>) => void;
  onSelect: (key: string) => void;
  onClose: () => void;
}

/**
 * What a selected card is, without leaving the map: facts, relations (each one selects its other
 * end), diagrams, and the sections a host extension adds. On phones it is a sheet from the bottom.
 */
export function DetailPanel({
  site,
  component,
  view,
  reached,
  onChange,
  onSelect,
  onClose,
}: DetailPanelProps) {
  const outgoing = site.outgoing.get(component.key) ?? [];
  const incoming = site.incoming.get(component.key) ?? [];
  const diagrams = site.model.diagrams.filter((d) => d.components.includes(component.key));
  const repo = site.model.repos.find((r) => r.id === component.repo);
  const links = Object.entries(component.links).filter(([, url]) => /^https?:\/\//i.test(url));
  const code = codeUrl(site, component);
  const extra = useExtensionSections(site, component);
  const body = useRef<HTMLDivElement>(null);
  useEffect(() => {
    body.current?.scrollTo({ top: 0 });
  }, [component.key]);
  const parts = (n: number) => `${n} ${n === 1 ? 'part' : 'parts'}`;
  const n = reached ?? 0;
  const summary = !view
    ? ''
    : view.mode === 'nets'
      ? `${n} ${n === 1 ? 'relation' : 'relations'}`
      : view.mode === 'impact'
        ? `${parts(n)} affected if it goes down`
        : `needs ${parts(n)} to work`;

  return (
    <aside className="detail-panel" aria-label={`Details of ${component.key}`}>
      <header className="dp-head">
        <span
          className="dp-icon"
          data-type={component.ghost ? undefined : component.type}
          aria-hidden
        >
          <ComponentIcon component={component} size={18} />
        </span>
        <div className="dp-title">
          <h2>{displayName(component)}</h2>
          <span className="dp-key">
            <span className="designator">{site.designator.get(component.key)}</span> {component.key}
          </span>
        </div>
        <button className="icon-button" type="button" onClick={onClose} aria-label="Close details">
          <X size={16} aria-hidden />
        </button>
      </header>

      <div className="dp-body" ref={body}>
        <div className="dp-actions">
          <a className="button" href={href.component(component.key)}>
            Open page <ArrowRight size={14} aria-hidden />
          </a>
          {!view && (
            <a className="button quiet" href={href.workspace({ sel: component.key })}>
              <MapIcon size={14} aria-hidden /> Show on the map
            </a>
          )}
          {links.map(([name, url]) => (
            <a className="button quiet" key={name} href={url} rel="noreferrer" target="_blank">
              {name} <ExternalLink size={13} aria-hidden />
            </a>
          ))}
        </div>

        {view && onChange && (
          <div className="dp-light">
            <div className="segmented" role="radiogroup" aria-label="What to light on the map">
              {(
                [
                  ['nets', 'Relations'],
                  ['impact', 'Blast radius'],
                  ['depends', 'Depends on'],
                ] as const
              ).map(([mode, label]) => (
                <button
                  key={mode}
                  type="button"
                  role="radio"
                  aria-checked={view.mode === mode}
                  onClick={() => onChange({ mode })}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="dp-light-row">
              <span className="net-count" role="status">
                {summary}
              </span>
              {view.mode !== 'nets' && (
                <label className="depth">
                  <span>Depth</span>
                  <select
                    value={view.depth}
                    onChange={(e) => onChange({ depth: Number(e.target.value) })}
                  >
                    {DEPTHS.map((d) => (
                      <option key={d} value={d}>
                        {d === 0 ? 'All' : d}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </div>
          </div>
        )}

        {component.ghost && (
          <p className="notice">
            <AlertTriangle size={16} aria-hidden />
            <span>
              Referenced, but no repo declares it. Declare it in the{' '}
              <span className="mono">.architecture/</span> of the repo that owns it.
            </span>
          </p>
        )}

        {component.description && <p className="dp-desc">{component.description}</p>}

        <dl className="dp-facts">
          {!component.ghost && (
            <Fact label="Type">{TYPE_LABEL[component.type ?? ''] ?? component.type}</Fact>
          )}
          {component.status && (
            <Fact label="Status" tone="warning">
              {STATUS_LABEL[component.status]}
            </Fact>
          )}
          {component.tech && <Fact label="Tech">{component.tech}</Fact>}
          {component.provider && <Fact label="Provider">{component.provider}</Fact>}
          {component.runtime && <Fact label="Runtime">{component.runtime}</Fact>}
          {component.host && <Fact label="Host">{component.host}</Fact>}
          {!component.ghost && (
            <Fact label="Owner" missing={!component.owner && 'No owner'}>
              {component.owner}
            </Fact>
          )}
          <Fact label="Project">
            <a href={href.project(component.project)}>{component.project}</a>
          </Fact>
          {repo && (
            <Fact label="Repo">
              {repo.url ? (
                <a href={repo.url} rel="noreferrer" target="_blank">
                  {repo.id}
                </a>
              ) : (
                repo.id
              )}
            </Fact>
          )}
          {component.path && (
            <Fact label="Path">
              {code ? (
                <a href={code} rel="noreferrer" target="_blank" className="mono">
                  {component.path}
                </a>
              ) : (
                <span className="mono">{component.path}</span>
              )}
            </Fact>
          )}
        </dl>

        {component.tags.length > 0 && (
          <div className="tags" aria-label="Tags">
            {component.tags.map((tag) => (
              <span className="tag" key={tag}>
                {tag}
              </span>
            ))}
          </div>
        )}

        {extra.map((section, i) => (
          <ExtensionSection key={`${section.title}-${i}`} section={section} />
        ))}

        <Relations
          title="Depends on"
          empty="Depends on nothing."
          relations={outgoing}
          end="to"
          site={site}
          onSelect={onSelect}
        />
        <Relations
          title="Used by"
          empty="Nothing depends on it."
          relations={incoming}
          end="from"
          site={site}
          onSelect={onSelect}
        />

        {diagrams.length > 0 && (
          <section className="dp-section" aria-label="Diagrams">
            <h3>
              Diagrams <span className="count">{diagrams.length}</span>
            </h3>
            <ul className="dp-list">
              {diagrams.map((d) => (
                <li key={d.key}>
                  <a href={href.diagrams(d.key)}>{d.title}</a>
                  <span className="dp-sub mono">{d.file}</span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </aside>
  );
}

function Fact({
  label,
  missing,
  tone,
  children,
}: {
  label: string;
  missing?: string | false;
  tone?: 'warning';
  children?: React.ReactNode;
}) {
  return (
    <div className={tone ? `tone-${tone}` : undefined}>
      <dt>{label}</dt>
      {missing ? <dd className="missing">{missing}</dd> : <dd>{children}</dd>}
    </div>
  );
}

function Relations({
  title,
  empty,
  relations,
  end,
  site,
  onSelect,
}: {
  title: string;
  empty: string;
  relations: ModelRelation[];
  end: 'from' | 'to';
  site: Site;
  onSelect: (key: string) => void;
}) {
  return (
    <section className="dp-section" aria-label={title}>
      <h3>
        {title} <span className="count">{relations.length}</span>
      </h3>
      {relations.length === 0 ? (
        <p className="dp-empty">{empty}</p>
      ) : (
        <ul className="dp-list">
          {relations.map((r, i) => {
            const other = r[end];
            const part = site.byKey.get(other);
            return (
              <li key={`${other}-${r.type}-${i}`}>
                <span className={`layer ${r.type}`}>{r.type.replace(/_/g, ' ')}</span>
                <button type="button" className="link mono" onClick={() => onSelect(other)}>
                  {other}
                </button>
                {part?.ghost && <span className="ghost-tag">Not declared</span>}
                {r.critical === false && <span className="non-critical-tag">Non-critical</span>}
                {(r.protocol || r.description) && (
                  <span className="dp-sub">
                    {[r.protocol, r.description].filter(Boolean).join(' · ')}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

export function ExtensionSection({ section }: { section: PanelSection }) {
  return (
    <section className="dp-section dp-extension" aria-label={section.title}>
      <h3>{section.title}</h3>
      {section.items && section.items.length > 0 && (
        <dl className="dp-facts">
          {section.items.map((item, i) => {
            const link = safeHref(item.href);
            const external = link?.startsWith('http');
            return (
              <div key={`${item.label}-${i}`} className={item.tone ? `tone-${item.tone}` : ''}>
                <dt>{item.label}</dt>
                <dd>
                  {link ? (
                    <a href={link} {...(external ? { rel: 'noreferrer', target: '_blank' } : {})}>
                      {item.value}
                    </a>
                  ) : (
                    item.value
                  )}
                  {item.detail && <span className="dp-sub">{item.detail}</span>}
                </dd>
              </div>
            );
          })}
        </dl>
      )}
      {section.note && <p className="dp-note">{section.note}</p>}
    </section>
  );
}

function useExtensionSections(site: Site, component: ModelComponent): PanelSection[] {
  const [sections, setSections] = useState<PanelSection[]>([]);
  useEffect(() => {
    let live = true;
    setSections([]);
    void extensionSections(component, site.model).then((s) => live && setSections(s));
    return () => {
      live = false;
    };
  }, [site, component]);
  return sections;
}
