import { writable } from 'svelte/store';
import { browser } from '$app/environment';

type Theme = 'light' | 'dark' | 'auto';

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
  applyTheme(getInitialTheme());

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
