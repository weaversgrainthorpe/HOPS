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
  };
  light: {
    primary: string;
    secondary: string;
    tertiary: string;
    accent: string;
    accentHover: string;
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
      accentHover: '#2563eb'
    },
    light: {
      primary: '#f8fafc',
      secondary: '#f1f5f9',
      tertiary: '#e2e8f0',
      accent: '#3b82f6',
      accentHover: '#2563eb'
    }
  },
  metallic: {
    id: 'metallic',
    dark: {
      primary: '#18181b',
      secondary: '#27272a',
      tertiary: '#3f3f46',
      accent: '#a1a1aa',
      accentHover: '#71717a'
    },
    light: {
      primary: '#fafafa',
      secondary: '#f4f4f5',
      tertiary: '#e4e4e7',
      accent: '#71717a',
      accentHover: '#52525b'
    }
  },
  modern: {
    id: 'modern',
    dark: {
      primary: '#111827',
      secondary: '#1f2937',
      tertiary: '#374151',
      accent: '#6366f1',
      accentHover: '#4f46e5'
    },
    light: {
      primary: '#ffffff',
      secondary: '#f9fafb',
      tertiary: '#f3f4f6',
      accent: '#6366f1',
      accentHover: '#4f46e5'
    }
  },
  subtle: {
    id: 'subtle',
    dark: {
      primary: '#1c1917',
      secondary: '#292524',
      tertiary: '#44403c',
      accent: '#a78bfa',
      accentHover: '#8b5cf6'
    },
    light: {
      primary: '#fef7f3',
      secondary: '#fef3f0',
      tertiary: '#fde8e0',
      accent: '#c084fc',
      accentHover: '#a855f7'
    }
  },
  cyberpunk: {
    id: 'cyberpunk',
    dark: {
      primary: '#0a0e1a',
      secondary: '#111827',
      tertiary: '#1e293b',
      accent: '#ec4899',
      accentHover: '#db2777'
    },
    light: {
      primary: '#fdf4ff',
      secondary: '#fae8ff',
      tertiary: '#f5d0fe',
      accent: '#d946ef',
      accentHover: '#c026d3'
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
      accentHover: 'linear-gradient(135deg, #ea580c 0%, #db2777 100%)'
    },
    light: {
      primary: '#fef3c7',
      secondary: '#fde68a',
      tertiary: '#fcd34d',
      accent: 'linear-gradient(135deg, #f97316 0%, #ec4899 100%)',
      accentHover: 'linear-gradient(135deg, #ea580c 0%, #db2777 100%)'
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
      accentHover: 'linear-gradient(135deg, #0891b2 0%, #2563eb 100%)'
    },
    light: {
      primary: '#e0f2fe',
      secondary: '#bae6fd',
      tertiary: '#7dd3fc',
      accent: 'linear-gradient(135deg, #06b6d4 0%, #3b82f6 100%)',
      accentHover: 'linear-gradient(135deg, #0891b2 0%, #2563eb 100%)'
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
      accentHover: 'linear-gradient(135deg, #16a34a 0%, #65a30d 100%)'
    },
    light: {
      primary: '#f0fdf4',
      secondary: '#dcfce7',
      tertiary: '#bbf7d0',
      accent: 'linear-gradient(135deg, #22c55e 0%, #84cc16 100%)',
      accentHover: 'linear-gradient(135deg, #16a34a 0%, #65a30d 100%)'
    }
  }
};

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

  const colors = mode === 'dark' ? preset.dark : preset.light;
  const root = document.documentElement;

  root.style.setProperty('--bg-primary', colors.primary);
  root.style.setProperty('--bg-secondary', colors.secondary);
  root.style.setProperty('--bg-tertiary', colors.tertiary);

  if (preset.gradient) {
    root.style.setProperty('--accent', colors.accent);
    root.style.setProperty('--accent-hover', colors.accentHover);
    root.setAttribute('data-gradient-theme', 'true');
  } else {
    root.style.setProperty('--accent', colors.accent);
    root.style.setProperty('--accent-hover', colors.accentHover);
    root.removeAttribute('data-gradient-theme');
  }

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

  // Listen for system theme changes when in auto mode
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
    theme.update(($theme) => {
      if ($theme === 'auto') {
        applyTheme('auto');
      }
      return $theme;
    });
  });
}
