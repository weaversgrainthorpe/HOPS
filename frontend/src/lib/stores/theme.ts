import { writable } from 'svelte/store';
import { browser } from '$app/environment';

type Theme = 'light' | 'dark' | 'auto';

interface ThemePreset {
  id: string;
  dark: {
    primary: string;
    secondary: string;
    tertiary: string;
    accent: string;
    accentHover: string;
    /** A solid accent for fills that carry text (--accent-solid): >= 4.5:1 with --on-accent, >= 3:1 on the page. */
    accentSolid: string;
    accentSolidHover: string;
    /** --text-secondary when the shared one is under 4.5:1 on this preset's surfaces. */
    textSecondary?: string;
  };
  light: {
    primary: string;
    secondary: string;
    tertiary: string;
    accent: string;
    accentHover: string;
    /** A solid accent for fills that carry text (--accent-solid): >= 4.5:1 with --on-accent, >= 3:1 on the page. */
    accentSolid: string;
    accentSolidHover: string;
    textSecondary?: string;
  };
  gradient?: boolean;
}

const themePresets: Record<string, ThemePreset> = {
  default: {
    id: 'default',
    dark: {
      primary: '#0f172a',
      secondary: '#1e293b',
      tertiary: '#334155',
      accent: '#3b82f6',
      accentHover: '#2563eb',
      accentSolid: '#3b82f6',
      accentSolidHover: '#60a5fa'
    },
    light: {
      primary: '#f8fafc',
      secondary: '#f1f5f9',
      tertiary: '#e2e8f0',
      accent: '#3b82f6',
      accentHover: '#2563eb',
      accentSolid: '#2563eb',
      accentSolidHover: '#1d4ed8'
    }
  },
  metallic: {
    id: 'metallic',
    dark: {
      primary: '#18181b',
      secondary: '#27272a',
      tertiary: '#3f3f46',
      accent: '#a1a1aa',
      accentHover: '#71717a',
      accentSolid: '#a1a1aa',
      accentSolidHover: '#d4d4d8'
    },
    light: {
      primary: '#fafafa',
      secondary: '#f4f4f5',
      tertiary: '#e4e4e7',
      accent: '#71717a',
      accentHover: '#52525b',
      accentSolid: '#71717a',
      accentSolidHover: '#52525b'
    }
  },
  modern: {
    id: 'modern',
    dark: {
      primary: '#111827',
      secondary: '#1f2937',
      tertiary: '#374151',
      accent: '#6366f1',
      accentHover: '#4f46e5',
      accentSolid: '#818cf8',
      accentSolidHover: '#a5b4fc'
    },
    light: {
      primary: '#ffffff',
      secondary: '#f9fafb',
      tertiary: '#f3f4f6',
      accent: '#6366f1',
      accentHover: '#4f46e5',
      accentSolid: '#4f46e5',
      accentSolidHover: '#4338ca'
    }
  },
  subtle: {
    id: 'subtle',
    dark: {
      primary: '#1c1917',
      secondary: '#292524',
      tertiary: '#44403c',
      accent: '#a78bfa',
      accentHover: '#8b5cf6',
      accentSolid: '#a78bfa',
      accentSolidHover: '#c4b5fd'
    },
    light: {
      primary: '#fef7f3',
      secondary: '#fef3f0',
      tertiary: '#fde8e0',
      accent: '#c084fc',
      accentHover: '#a855f7',
      accentSolid: '#9333ea',
      accentSolidHover: '#7e22ce'
    }
  },
  cyberpunk: {
    id: 'cyberpunk',
    dark: {
      primary: '#0a0e1a',
      secondary: '#111827',
      tertiary: '#1e293b',
      accent: '#ec4899',
      accentHover: '#db2777',
      accentSolid: '#ec4899',
      accentSolidHover: '#f472b6'
    },
    light: {
      primary: '#fdf4ff',
      secondary: '#fae8ff',
      tertiary: '#f5d0fe',
      accent: '#d946ef',
      accentHover: '#c026d3',
      accentSolid: '#a21caf',
      accentSolidHover: '#86198f'
    }
  },
  sunset: {
    id: 'sunset',
    gradient: true,
    dark: {
      primary: '#1e1b4b',
      secondary: '#312e81',
      tertiary: '#4c1d95',
      accent: 'linear-gradient(135deg, #f97316 0%, #ec4899 100%)',
      accentHover: 'linear-gradient(135deg, #ea580c 0%, #db2777 100%)',
      accentSolid: '#ec4899',
      accentSolidHover: '#f472b6'
    },
    light: {
      primary: '#fef3c7',
      secondary: '#fde68a',
      tertiary: '#fcd34d',
      accent: 'linear-gradient(135deg, #f97316 0%, #ec4899 100%)',
      accentHover: 'linear-gradient(135deg, #ea580c 0%, #db2777 100%)',
      accentSolid: '#be185d',
      accentSolidHover: '#9d174d'
    }
  },
  ocean: {
    id: 'ocean',
    gradient: true,
    dark: {
      primary: '#0c4a6e',
      secondary: '#075985',
      tertiary: '#0369a1',
      accent: 'linear-gradient(135deg, #06b6d4 0%, #3b82f6 100%)',
      accentHover: 'linear-gradient(135deg, #0891b2 0%, #2563eb 100%)',
      accentSolid: '#22d3ee',
      accentSolidHover: '#67e8f9'
    },
    light: {
      primary: '#e0f2fe',
      secondary: '#bae6fd',
      tertiary: '#7dd3fc',
      accent: 'linear-gradient(135deg, #06b6d4 0%, #3b82f6 100%)',
      accentHover: 'linear-gradient(135deg, #0891b2 0%, #2563eb 100%)',
      accentSolid: '#0e7490',
      accentSolidHover: '#155e75'
    }
  },
  forest: {
    id: 'forest',
    gradient: true,
    dark: {
      primary: '#14532d',
      secondary: '#166534',
      tertiary: '#15803d',
      accent: 'linear-gradient(135deg, #22c55e 0%, #84cc16 100%)',
      accentHover: 'linear-gradient(135deg, #16a34a 0%, #65a30d 100%)',
      accentSolid: '#4ade80',
      accentSolidHover: '#86efac',
      // The shared #dbe4f0 is 3.9:1 on this tertiary green; this is >= 4.5:1 on all three.
      textSecondary: '#f8fafc'
    },
    light: {
      primary: '#f0fdf4',
      secondary: '#dcfce7',
      tertiary: '#bbf7d0',
      accent: 'linear-gradient(135deg, #22c55e 0%, #84cc16 100%)',
      accentHover: 'linear-gradient(135deg, #16a34a 0%, #65a30d 100%)',
      accentSolid: '#15803d',
      accentSolidHover: '#166534'
    }
  }
};

/**
 * Tokens shared by every preset in one mode. Each is checked in
 * theme.test.ts against every preset's page and surface colours:
 *  --on-accent          text/icons on --accent-solid (>= 4.5:1);
 *  --accent-text        accent-coloured link text (>= 4.5:1 on the page and surface);
 *  --color-error-text   error text (>= 4.5:1 on the page and surface);
 *  --status-*           the header status dot fills (>= 3:1 on the navbar), --status-glyph on them.
 */
const modeTokens: Record<'light' | 'dark', Record<string, string>> = {
  dark: {
    '--on-accent': '#0f172a',
    '--accent-text': '#bfdbfe',
    '--color-error-text': '#fecaca',
    '--status-online': '#4ade80',
    '--status-degraded': '#fbbf24',
    '--status-offline': '#fca5a5',
    '--status-checking': '#cbd5e1',
    '--status-glyph': '#0f172a'
  },
  light: {
    '--on-accent': '#ffffff',
    '--accent-text': '#1d4ed8',
    '--color-error-text': '#b91c1c',
    '--status-online': '#15803d',
    '--status-degraded': '#b45309',
    '--status-offline': '#b91c1c',
    '--status-checking': '#64748b',
    '--status-glyph': '#ffffff'
  }
};

export const THEME_PRESET_IDS: readonly string[] = Object.keys(themePresets);

/** Every CSS custom property a preset sets on <html> in one mode, or null for an unknown preset. */
export function themeTokens(presetId: string, mode: 'light' | 'dark'): Record<string, string> | null {
  const preset = themePresets[presetId];
  if (!preset) return null;
  const c = mode === 'dark' ? preset.dark : preset.light;
  return {
    '--bg-primary': c.primary,
    '--bg-secondary': c.secondary,
    '--bg-tertiary': c.tertiary,
    '--accent': c.accent,
    '--accent-hover': c.accentHover,
    '--accent-solid': c.accentSolid,
    '--accent-solid-hover': c.accentSolidHover,
    // Always set, so switching presets never leaves another preset's value behind.
    '--text-secondary': c.textSecondary ?? (mode === 'dark' ? '#dbe4f0' : '#334155'),
    ...modeTokens[mode]
  };
}

/** HOPS's dark brand blue: the default preset's dark secondary background (the --bg-secondary token). */
export const HOPS_DARK_BLUE = themePresets.default.dark.secondary;

// Get initial theme from localStorage or default to 'dark'
const getInitialTheme = (): Theme => {
  if (!browser) return 'dark';
  const stored = localStorage.getItem('hops_theme');
  return (stored as Theme) || 'dark';
};

export const theme = writable<Theme>(getInitialTheme());

// Subscribe to theme changes and update DOM
if (browser) {
  theme.subscribe(($theme) => {
    localStorage.setItem('hops_theme', $theme);
    applyTheme($theme);
  });
}

function applyTheme(t: Theme) {
  if (!browser) return;

  const root = document.documentElement;

  if (t === 'auto') {
    // Use system preference
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    root.setAttribute('data-theme', prefersDark ? 'dark' : 'light');
  } else {
    root.setAttribute('data-theme', t);
  }

  // Reapply the current preset when theme mode changes
  const savedPreset = localStorage.getItem('hops_theme_preset') || 'default';
  applyThemePreset(savedPreset, getEffectiveMode(t));
}

function getEffectiveMode(t: Theme): 'light' | 'dark' {
  if (t === 'auto') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  return t as 'light' | 'dark';
}

export function applyThemePreset(presetId: string, mode: 'light' | 'dark') {
  if (!browser) return;

  const preset = themePresets[presetId];
  if (!preset) return;

  const tokens = themeTokens(presetId, mode)!;
  const root = document.documentElement;
  for (const [k, v] of Object.entries(tokens)) root.style.setProperty(k, v);
  if (preset.gradient) root.setAttribute('data-gradient-theme', 'true');
  else root.removeAttribute('data-gradient-theme');

  localStorage.setItem('hops_theme_preset', presetId);
}

export function toggleTheme() {
  theme.update(($theme) => {
    if ($theme === 'dark') return 'light';
    if ($theme === 'light') return 'auto';
    return 'dark';
  });
}

export function setTheme(t: Theme) {
  theme.set(t);
}

// Initialize theme on app load
if (browser) {
  const initialTheme = getInitialTheme();
  const savedPreset = localStorage.getItem('hops_theme_preset') || 'default';

  applyTheme(initialTheme);
  applyThemePreset(savedPreset, getEffectiveMode(initialTheme));

  // Listen for system theme changes when in auto mode.
  // Store reference to the query and handler so it can be cleaned up if needed.
  const darkModeQuery = window.matchMedia('(prefers-color-scheme: dark)');
  const handleSystemThemeChange = () => {
    theme.update(($theme) => {
      if ($theme === 'auto') {
        applyTheme('auto');
      }
      return $theme;
    });
  };
  darkModeQuery.addEventListener('change', handleSystemThemeChange);

  // Cleanup on HMR dispose (prevents listener accumulation during development)
  if (import.meta.hot) {
    import.meta.hot.dispose(() => {
      darkModeQuery.removeEventListener('change', handleSystemThemeChange);
    });
  }
}
