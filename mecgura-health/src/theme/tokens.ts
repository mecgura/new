/**
 * White-label theme contract. Defaults MUST match the `--brand-*` values in globals.css.
 * A tenant overrides only these three colours (plus logo/favicon); every other colour in the
 * UI is derived from them or is a fixed semantic colour (success/warning/danger/emergency/info).
 */
export const DEFAULT_BRAND = {
  primary: "#14529e", // Deep medical blue
  secondary: "#0e7c86", // Teal
  accent: "#12a06a", // Healthcare green
} as const;

export interface BrandColors {
  primary: string;
  secondary: string;
  accent: string;
}

const HEX = /^#[0-9a-f]{6}$/i;

export function resolveBrandColors(input?: { primaryColor?: string | null; secondaryColor?: string | null; accentColor?: string | null } | null): BrandColors {
  const pick = (v: string | null | undefined, fallback: string) => (v && HEX.test(v) ? v.toLowerCase() : fallback);
  return {
    primary: pick(input?.primaryColor, DEFAULT_BRAND.primary),
    secondary: pick(input?.secondaryColor, DEFAULT_BRAND.secondary),
    accent: pick(input?.accentColor, DEFAULT_BRAND.accent),
  };
}

/** CSS variable overrides for a tenant. Only validated #RRGGBB values can reach this string. */
export function brandToCssVars(brand: BrandColors): Record<string, string> {
  return { "--brand-primary": brand.primary, "--brand-secondary": brand.secondary, "--brand-accent": brand.accent };
}

export function brandToCss(brand: BrandColors, selector = ":root"): string {
  const body = Object.entries(brandToCssVars(brand)).map(([k, v]) => `${k}:${v}`).join(";");
  return `${selector}{${body}}`;
}
