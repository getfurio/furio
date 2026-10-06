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

/**
 * What makes a style fetch: a url() that is not a reference inside the diagram itself (`#id`),
 * the image functions that take an address as a string, and @import.
 */
const FETCHES = /\b(url)\((?!\s*['"]?\s*#)|\b(image-set|image|src)\(|(@import)(?![\w-])/gi;

/** A CSS escape, as in `u\72l(`: up to six hex digits and a space, or any one character. */
const ESCAPE = /\\(?:([0-9a-f]{1,6})\s?|([^]))/gi;

const unescaped = (css: string) =>
  css.replace(ESCAPE, (_, hex?: string, char?: string) =>
    hex ? String.fromCodePoint(Math.min(parseInt(hex, 16), 0x10ffff)) : (char ?? ''),
  );

/**
 * The CSS of a diagram (a style sheet, a `style` attribute, a presentation attribute such as
 * `fill`) with nothing that loads from another host: classDef and style statements take any
 * property, and a mask, a cursor or a paint may be an address. What would fetch is renamed into
 * something the browser does not know and skips; CSS that hides it behind escapes is dropped whole.
 */
export function localCss(css: string): string {
  const off = (text: string) =>
    text.replace(FETCHES, (found: string, url?: string, image?: string, rule?: string) => {
      const name = rule ?? url ?? image ?? '';
      return `${name}-off${found.slice(name.length)}`;
    });
  const local = off(css);
  const plain = unescaped(local);
  return off(plain) === plain ? local : '';
}

type Purifier = ReturnType<typeof DOMPurify>;

let purifier: Purifier | undefined;
let svgPurifier: Purifier | undefined;

/**
 * The SVG Mermaid rendered, as SVG only and with nothing that loads from another host: an
 * image node may carry its picture inline, not point at a server, and no style may either.
 */
export function sanitizeDiagram(svg: string): string {
  if (!svgPurifier) {
    svgPurifier = DOMPurify(window);
    svgPurifier.addHook('uponSanitizeElement', (node, data) => {
      if (node.nodeType !== 1) return;
      const element = node as Element;
      if (data.tagName === 'style') element.textContent = localCss(element.textContent ?? '');
      if (data.tagName !== 'image' && data.tagName !== 'feimage') return;
      const href = element.getAttribute('href') ?? element.getAttribute('xlink:href') ?? '';
      if (!INLINE_IMAGE.test(href)) element.remove();
    });
    svgPurifier.addHook('afterSanitizeAttributes', (node) => {
      for (const { name, value } of [...node.attributes]) {
        // Only a function, an escape or an at-rule can make a value fetch.
        if (!/[(\\@]/.test(value)) continue;
        const local = localCss(value);
        if (!local) node.removeAttribute(name);
        else if (local !== value) node.setAttribute(name, local);
      }
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
