import type { LayoutDoc } from './layout';
// Type definitions matching the backend models. Dashboards themselves are the
// v3 tree (types/layout.ts); the types here are the shared leaf shapes.

/** Per-dashboard overrides; null = inherit the global setting. */
export interface DashboardSettings {
  statusChecksEnabled: string | boolean | null;
  statusCheckIntervalMinutes: string | number | null;
  statusCheckTimeoutSeconds: string | number | null;
  editIdleTimeoutMinutes: string | number | null;
  animatedFolderBackgrounds: string | boolean | null;
  defaultLayout: string | null;
}

export interface HeaderConfig {
  leftText?: string;
  centerTitle?: string;
  showLeft?: boolean;
  showCenter?: boolean;
}

export interface Entry {
  id: string;
  // "link" (default; URL-opening tile) or "note" (text-only — name +
  // description, no URL, no status check, no click action). Treated as
  // "link" when undefined, so configs from older HOPS releases continue
  // to load unchanged.
  type?: 'link' | 'note';
  name: string;
  url: string;
  icon: string;
  iconUrl?: string;
  description?: string;
  openMode: 'iframe' | 'newtab' | 'sametab' | 'popup';
  statusCheck?: StatusCheck;
  size: 'small' | 'medium' | 'large';
  color?: string;
  opacity?: number;
  // Optional coloured backing behind the icon graphic — useful for dark
  // logos (e.g. GitHub's octocat) on dark tiles where they'd otherwise
  // vanish. Undefined means "no backing, icon sits directly on the tile".
  iconBgColor?: string;
  order: number;
  showStatus?: boolean;
}

export interface Background {
  type: 'image' | 'slideshow' | 'color';
  value?: string;
  images?: string[];
  interval?: number; // Duration in seconds between slides
  fit?: 'cover' | 'contain' | 'fill'; // How to fit the image
  transition?: 'crossfade' | 'slide' | 'slide-up' | 'slide-down' | 'zoom' | 'zoom-out' | 'fade-black' | 'blur' | 'flip' | 'swirl' | 'wipe' | 'curtain' | 'circle' | 'diamond' | 'dissolve' | 'flash' | 'glitch' | 'kenburns' | 'none' | 'random'; // Transition effect
  transitionDuration?: number; // Duration in seconds (0.5 to 5)
  overlayOpacity?: number; // 0-1, darkness of overlay on content area (default 0.7)
  overlayBlur?: number; // 0-20, blur in px on content area (default 10)
}

export interface StatusCheck {
  type: 'http';
  enabled: boolean;
  interval: number;
}

/** GET /api/config: the stored v3 document, plus this start's migration notices. */
export interface Config extends LayoutDoc {
  /** Ids the startup v2→v3 migration renamed (from GET only; never stored). */
  migrationNotices?: string[];
}
