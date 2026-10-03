import DOMPurify from 'dompurify';

/**
 * What the prose of a Markdown diagram may contain once rendered. Diagrams come from any repo of
 * the workspace and are shown to everyone who opens the map, so the list is closed: no styles
 * (they could redraw the page), no forms (they could ask for a password), no classes or ids of
 * the map itself, no remote images (their host would learn who opens the map).
 */
const TAGS = [
  'a b blockquote br code dd del details div dl dt em h1 h2 h3 h4 h5 h6 hr i img input kbd li',
  'mark ol p pre s span strong sub summary sup table tbody td tfoot th thead tr u ul',
].flatMap((line) => line.split(' '));

/** Plain values. DOMPurify holds every other attribute to the rule for links below. */
const PLAIN_ATTRIBUTES = 'align checked colspan disabled open rowspan start type'.split(' ');
const ATTRIBUTES = [...PLAIN_ATTRIBUTES, 'alt', 'href', 'src', 'title'];

/** Links leave the map only for the web or an email; `#/...` stays on the map. */
const LINKS = /^(?:https?:\/\/|mailto:|#)/i;
const INLINE_IMAGE = /^data:image\/(?:png|jpe?g|gif|webp|avif|svg\+xml)[;,]/i;

type Purifier = ReturnType<typeof DOMPurify>;

let purifier: Purifier | undefined;
let svgPurifier: Purifier | undefined;

/**
 * The SVG Mermaid rendered, as SVG only and with nothing that loads from another host: an
 * image node may carry its picture inline, not point at a server.
 */
export function sanitizeDiagram(svg: string): string {
  if (!svgPurifier) {
    svgPurifier = DOMPurify(window);
    svgPurifier.addHook('uponSanitizeElement', (node, data) => {
      if (node.nodeType !== 1 || (data.tagName !== 'image' && data.tagName !== 'feimage')) return;
      const element = node as Element;
      const href = element.getAttribute('href') ?? element.getAttribute('xlink:href') ?? '';
      if (!INLINE_IMAGE.test(href)) element.remove();
    });
  }
  return svgPurifier.sanitize(svg, { USE_PROFILES: { svg: true, svgFilters: true } });
}

/** Its own instance: these hooks are for prose, the ones above for diagrams. */
function prosePurifier() {
  if (purifier) return purifier;
  purifier = DOMPurify(window);
  purifier.addHook('uponSanitizeElement', (node, data) => {
    if (node.nodeType !== 1) return;
    const element = node as Element;
    if (data.tagName === 'img') {
      const src = element.getAttribute('src') ?? '';
      if (INLINE_IMAGE.test(src)) return;
      // An image on another host becomes a link to it: nothing is fetched until someone clicks.
      const label = element.getAttribute('alt') || 'image';
      const document = element.ownerDocument;
      if (/^https?:\/\//i.test(src)) {
        const link = document.createElement('a');
        link.setAttribute('href', src);
        link.textContent = label;
        element.replaceWith(link);
      } else {
        element.replaceWith(document.createTextNode(label));
      }
    }
    // Task lists (- [x] done) are the only inputs: a checkbox nobody can use.
    if (data.tagName === 'input') {
      if (element.getAttribute('type') === 'checkbox') element.setAttribute('disabled', '');
      else element.remove();
    }
  });
  purifier.addHook('afterSanitizeAttributes', (node) => {
    const href = node.tagName === 'A' ? node.getAttribute('href') : null;
    if (href && !href.startsWith('#')) {
      node.setAttribute('target', '_blank');
      node.setAttribute('rel', 'noopener noreferrer');
    }
  });
  return purifier;
}

/** The HTML of rendered Markdown, reduced to prose that is safe to put on the map. */
export function sanitizeProse(html: string): string {
  return prosePurifier().sanitize(html, {
    ALLOWED_TAGS: TAGS,
    ALLOWED_ATTR: ATTRIBUTES,
    ADD_URI_SAFE_ATTR: PLAIN_ATTRIBUTES,
    ALLOWED_URI_REGEXP: LINKS,
    ALLOW_DATA_ATTR: false,
    ALLOW_ARIA_ATTR: false,
  });
}
