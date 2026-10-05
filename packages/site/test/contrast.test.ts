import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * Every text colour of the map reads at 4.5:1 or more (WCAG AA for text under 18px) on the
 * grounds it sits on, in each palette and theme. surface-3 is left out: it is the fill of a
 * hovered or checked control, not a ground for reading.
 */
const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');

/** The custom properties of each `:root…` block, by selector, in source order. */
function blocks(): { selector: string; tokens: Record<string, string> }[] {
  const out: { selector: string; tokens: Record<string, string> }[] = [];
  for (const m of css.matchAll(/^(:root(?:\[[^\]]+\])*) \{([^}]*)\}/gm)) {
    const tokens: Record<string, string> = {};
    for (const t of m[2]!.matchAll(/--([\w-]+):\s*([^;]+);/g)) tokens[t[1]!] = t[2]!.trim();
    out.push({ selector: m[1]!, tokens });
  }
  return out;
}

/** The tokens in effect for a theme and a palette: the CSS cascade, by specificity then order. */
function tokensFor(theme: 'dark' | 'light', palette: 'furio' | 'blueprint' | 'circuit') {
  const applies = (selector: string) =>
    [...selector.matchAll(/\[([\w-]+)='([\w-]+)'\]/g)].every(
      ([, name, value]) =>
        (name === 'data-theme' && value === theme) ||
        (name === 'data-palette' && value === palette),
    );
  const specificity = (selector: string) => (selector.match(/\[/g) ?? []).length;
  return blocks()
    .map((b, order) => ({ ...b, order }))
    .filter((b) => applies(b.selector))
    .sort((a, b) => specificity(a.selector) - specificity(b.selector) || a.order - b.order)
    .reduce<Record<string, string>>((all, b) => Object.assign(all, b.tokens), {});
}

const luminance = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = Number.parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
};
const ratio = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
};

describe('contrast', () => {
  for (const palette of ['furio', 'blueprint', 'circuit'] as const)
    for (const theme of ['dark', 'light'] as const)
      it(`reads every text at 4.5:1 on ${palette}, ${theme}`, () => {
        const t = tokensFor(theme, palette);
        const failing: string[] = [];
        for (const text of ['text', 'text-2', 'text-3'])
          for (const ground of ['bg', 'canvas', 'surface', 'surface-2']) {
            const r = ratio(t[text]!, t[ground]!);
            if (!(r >= 4.5))
              failing.push(`${text} ${t[text]} on ${ground} ${t[ground]}: ${r.toFixed(2)}`);
          }
        expect(failing).toEqual([]);
      });

  it('reads the tokens of each palette, not only the default ones', () => {
    expect(tokensFor('light', 'blueprint')['text-3']).toBe('#5d7089');
    expect(tokensFor('dark', 'circuit')['bg']).toBe('#080f0b');
    expect(tokensFor('light', 'furio')['text-3']).toBe('#6b6d74');
  });
});
