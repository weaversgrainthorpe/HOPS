// Theme cascading utility
// Computes effective color and opacity considering the hierarchy:
// Dashboard → Tab → Group → Entry

export interface ThemeLevel {
  color?: string;
  opacity?: number;
}

/**
 * Cascades theme from parent levels to child
 * Child values override parent values
 */
export function cascadeTheme(...levels: (ThemeLevel | undefined)[]): ThemeLevel {
  const result: ThemeLevel = {};

  for (const level of levels) {
    if (level?.color !== undefined) {
      result.color = level.color;
    }
    if (level?.opacity !== undefined) {
      result.opacity = level.opacity;
    }
  }

  return result;
}

/**
 * Gets the effective theme for an entry
 */
export function getEffectiveEntryTheme(
  dashboardTheme?: ThemeLevel,
  tabTheme?: ThemeLevel,
  groupTheme?: ThemeLevel,
  entryTheme?: ThemeLevel
): ThemeLevel {
  return cascadeTheme(dashboardTheme, tabTheme, groupTheme, entryTheme);
}

/**
 * Gets the effective theme for a group
 */
export function getEffectiveGroupTheme(
  dashboardTheme?: ThemeLevel,
  tabTheme?: ThemeLevel,
  groupTheme?: ThemeLevel
): ThemeLevel {
  return cascadeTheme(dashboardTheme, tabTheme, groupTheme);
}

/**
 * Gets the effective theme for a tab
 */
export function getEffectiveTabTheme(
  dashboardTheme?: ThemeLevel,
  tabTheme?: ThemeLevel
): ThemeLevel {
  return cascadeTheme(dashboardTheme, tabTheme);
}
