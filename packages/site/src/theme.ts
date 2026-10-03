import { useEffect, useState } from 'react';

/** What the page draws with. */
export type Theme = 'dark' | 'light';
/** What the viewer chose: a theme, or whatever the system says (the default). */
export type Mode = Theme | 'system';
/** Colour schemes of the map and its diagrams. */
export const PALETTES = ['furio', 'blueprint', 'circuit'] as const;
export type Palette = (typeof PALETTES)[number];

export const PALETTE_LABEL: Record<Palette, string> = {
  furio: 'Furio',
  blueprint: 'Blueprint',
  circuit: 'Circuit',
};

const MODE_KEY = 'furio-theme';
const PALETTE_KEY = 'furio-palette';

export interface Appearance {
  mode: Mode;
  theme: Theme;
  palette: Palette;
}

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    // Storage may be blocked: the defaults apply.
    return null;
  }
}

function write(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // Not persisted; the choice still applies to this page.
  }
}

const systemTheme = (): Theme =>
  window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';

/** The viewer's choices (kept in this browser only), resolved against the system. */
export function initialAppearance(): Appearance {
  const saved = read(MODE_KEY);
  const mode: Mode = saved === 'dark' || saved === 'light' ? saved : 'system';
  const palette = read(PALETTE_KEY);
  return {
    mode,
    theme: mode === 'system' ? systemTheme() : mode,
    palette: (PALETTES as readonly string[]).includes(palette ?? '')
      ? (palette as Palette)
      : 'furio',
  };
}

export function applyAppearance(a: Appearance) {
  const root = document.documentElement;
  root.dataset.theme = a.theme;
  root.dataset.palette = a.palette;
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', getComputedStyle(root).getPropertyValue('--bg').trim() || '#08090a');
  window.dispatchEvent(new CustomEvent<Appearance>('furio-appearance', { detail: a }));
}

/** Follows the system when the viewer has not chosen a theme. */
export function watchSystemTheme() {
  window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => {
    const a = initialAppearance();
    if (a.mode === 'system') applyAppearance(a);
  });
}

export function useAppearance(): [Appearance, (patch: { mode?: Mode; palette?: Palette }) => void] {
  const [appearance, setAppearance] = useState<Appearance>(initialAppearance);
  useEffect(() => {
    const onChange = (e: Event) => setAppearance((e as CustomEvent<Appearance>).detail);
    window.addEventListener('furio-appearance', onChange);
    return () => window.removeEventListener('furio-appearance', onChange);
  }, []);
  return [
    appearance,
    (patch) => {
      if (patch.mode) write(MODE_KEY, patch.mode === 'system' ? null : patch.mode);
      if (patch.palette) write(PALETTE_KEY, patch.palette === 'furio' ? null : patch.palette);
      applyAppearance(initialAppearance());
    },
  ];
}

/** The resolved theme, for code that only needs light or dark. */
export function useTheme(): Theme {
  return useAppearance()[0].theme;
}
