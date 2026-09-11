/** Default accent before a career starts: a quiet steel blue that belongs to no team. */
export const NEUTRAL_ACCENT = '#5b7fb8';

const LIGHT_TEXT = '#e8edf5';
/** --color-ground: the darkest surface a team colour has to stand out against. */
const GROUND = '#0c0f14';
/** WCAG minimum for graphics and large text: below it a team colour disappears on the dark UI. */
const MIN_GRAPHIC_CONTRAST = 3;
const DARK_TEXT = '#0c0f14';

function parseHex(hex: string): [number, number, number] {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!match?.[1]) throw new Error(`Accent must be a #rrggbb colour, got "${hex}"`);
  const n = parseInt(match[1], 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

/** WCAG 2 relative luminance. */
function luminance(hex: string): number {
  const [r, g, b] = parseHex(hex).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** Text colour for content on the accent: whichever of light and dark text reads better. */
export function accentForeground(accent: string): string {
  return contrast(accent, LIGHT_TEXT) >= contrast(accent, DARK_TEXT) ? LIGHT_TEXT : DARK_TEXT;
}

/**
 * The team colour to draw with: whichever of the livery's two colours stands out better on the
 * dark interface (a navy primary gives way to its light-blue secondary). If neither reaches 3:1,
 * the neutral accent — a team colour that cannot be seen is worse than none.
 */
export function visibleTeamColour(colours: { primary: string; secondary: string }): string {
  const best =
    contrast(colours.primary, GROUND) >= contrast(colours.secondary, GROUND)
      ? colours.primary
      : colours.secondary;
  return contrast(best, GROUND) >= MIN_GRAPHIC_CONTRAST ? best : NEUTRAL_ACCENT;
}

/** Sets the player's team colour for the whole interface. */
export function applyAccent(accent: string, root: HTMLElement = document.documentElement): void {
  root.style.setProperty('--color-accent', accent);
  root.style.setProperty('--color-accent-fg', accentForeground(accent));
}
