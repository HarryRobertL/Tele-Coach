/**
 * Creditsafe rebrand theme – single source of truth for overlay UI colors.
 */

export const themeTokens = {
  primary_color: "#d71920",
  background: "#121212",
  panel: "#1c1c1c",
  text: "#ffffff",
  accent: "#ff4b4b",
  /** Severity badge background colors */
  badge: {
    soft: "#c9a227",
    medium: "#d9730d",
    hard: "#b91c1c"
  }
} as const;

export type Severity = keyof typeof themeTokens.badge;

/** CSS custom property names for use with setProperty / var() */
const _cssVarKeys = [
  "primary_color",
  "background",
  "panel",
  "text",
  "accent",
  "badge_soft",
  "badge_medium",
  "badge_hard"
] as const;
export const themeCssVars: Record<(typeof _cssVarKeys)[number], string> = {
  primary_color: "--creditsafe-primary",
  background: "--creditsafe-bg",
  panel: "--creditsafe-panel",
  text: "--creditsafe-text",
  accent: "--creditsafe-accent",
  badge_soft: "--creditsafe-badge-soft",
  badge_medium: "--creditsafe-badge-medium",
  badge_hard: "--creditsafe-badge-hard"
};

/**
 * Applies theme tokens to document.documentElement as CSS custom properties.
 * Call once on app init (e.g. from main.tsx).
 */
export function applyThemeToDom(): void {
  const root = document.documentElement;
  root.style.setProperty(themeCssVars.primary_color, themeTokens.primary_color);
  root.style.setProperty(themeCssVars.background, themeTokens.background);
  root.style.setProperty(themeCssVars.panel, themeTokens.panel);
  root.style.setProperty(themeCssVars.text, themeTokens.text);
  root.style.setProperty(themeCssVars.accent, themeTokens.accent);
  root.style.setProperty(themeCssVars.badge_soft, themeTokens.badge.soft);
  root.style.setProperty(themeCssVars.badge_medium, themeTokens.badge.medium);
  root.style.setProperty(themeCssVars.badge_hard, themeTokens.badge.hard);
}
