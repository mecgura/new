/** WCAG 2.1 contrast helpers used to keep tenant branding readable. */
function channel(v: number) {
  const c = v / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}
export function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
}
export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Minimum contrast against white (button text / page background). Accent is decorative → 3:1 (graphics). */
export const MIN_CONTRAST = { primary: 4.5, secondary: 4.5, accent: 3 } as const;

export function brandContrastIssues(brand: { primary: string; secondary: string; accent: string }): Partial<Record<keyof typeof MIN_CONTRAST, string>> {
  const out: Partial<Record<keyof typeof MIN_CONTRAST, string>> = {};
  for (const k of ["primary", "secondary", "accent"] as const) {
    const ratio = contrastRatio(brand[k], "#ffffff");
    if (ratio < MIN_CONTRAST[k]) out[k] = `Too light: white text on this colour has contrast ${ratio.toFixed(1)}:1 (needs ${MIN_CONTRAST[k]}:1). Choose a darker shade.`;
  }
  return out;
}
