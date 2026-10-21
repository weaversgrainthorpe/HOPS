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
  /** 0–1 opacity of the tile's background only (default 0.95); clamped when rendered. */
  opacity?: number;
  /** 0–1 opacity of the name, description and note text (default 1); clamped when rendered. */
  textOpacity?: number;
  /** 0–1 opacity of the icon and its backing (default 1); clamped when rendered. */
  iconOpacity?: number;
  // Optional coloured backing behind the icon graphic — useful for dark
  // logos (e.g. GitHub's octocat) on dark tiles where they'd otherwise
  // vanish. Undefined means "no backing, icon sits directly on the tile".
  iconBgColor?: string;
  order: number;
  showStatus?: boolean;
}

/**
 * A dashboard, tab or folder background (M4). Missing, or `inherit: true`,
 * means the level inherits its parent's background; the inherit form keeps
 * any stored picture fields (an "off but kept" picture). Otherwise `type`
 * names the picture kind. The backend verifies this shape on every save.
 */
export interface Background {
  /** Present on a picture; optional only in the inherit form. */
  type?: 'image' | 'slideshow' | 'color';
  /** true: inherit the parent's background, keeping these picture fields stored. */
  inherit?: boolean;
  /** 0–1 show-through opacity of this level's surface (default 1); distinct from overlayOpacity. */
  opacity?: number;
  value?: string;
  images?: string[]; // at most 200
  interval?: number; // Duration in seconds between slides
  fit?: 'cover' | 'contain' | 'fill'; // How to fit the image
  transition?: 'crossfade' | 'slide' | 'slide-up' | 'slide-down' | 'zoom' | 'zoom-out' | 'fade-black' | 'blur' | 'flip' | 'swirl' | 'wipe' | 'curtain' | 'circle' | 'diamond' | 'dissolve' | 'flash' | 'glitch' | 'kenburns' | 'none' | 'random'; // Transition effect
  transitionDuration?: number; // Duration in seconds (0.5 to 5)
  overlayOpacity?: number; // 0-1, darkness of overlay on content area (default 0.7)
  overlayBlur?: number; // 0-20, blur in px on content area (default 10)
}

export interface StatusCheck {
  type: 'http';
  /**
   * Layered (M4 §4b, Ruling 12): true = on, false = off, null = inherit (follow the folder, tab,
   * dashboard or global setting). Missing = off: status checks only run where turned on.
   */
  enabled?: boolean | null;
  interval: number;
}

/** GET /api/config: the stored v3 document, plus this start's migration notices. */
export interface Config extends LayoutDoc {
  /** Ids the startup v2→v3 migration renamed (from GET only; never stored). */
  migrationNotices?: string[];
  /** One-time notices the server computes per GET (M4 Task 6/7); dismissed via POST. Never stored. */
  notices?: ServerNotice[];
  /** How many notices the server sent that this build could not read (shown, never dropped silently). */
  noticesUnreadable?: number;
}

export interface ServerNotice {
  id: string;
  text: string;
}
