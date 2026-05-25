// Type definitions matching the backend models

export interface Dashboard {
  id: string;
  name: string;
  path: string;
  background?: Background;
  perTabBackgrounds?: boolean; // When true, each tab can have its own background
  header?: HeaderConfig;
  theme?: {
    color?: string;
    opacity?: number;
  };
  tabs: Tab[];
  order: number;
}

export interface HeaderConfig {
  leftText?: string;
  centerTitle?: string;
  showLeft?: boolean;
  showCenter?: boolean;
}

export interface Tab {
  id: string;
  name: string;
  icon?: string; // Optional Iconify icon name (e.g., 'mdi:home')
  iconUrl?: string; // Optional image URL for SVG icons
  background?: Background;
  color?: string;
  opacity?: number;
  textColor?: 'auto' | 'light' | 'dark'; // Auto determines based on background color
  groups: Group[];
  order: number;
}

export interface Group {
  id: string;
  name: string;
  icon?: string; // Optional Iconify icon name (e.g., 'mdi:folder')
  iconUrl?: string; // Optional image URL for SVG icons
  collapsed: boolean;
  color?: string;
  opacity?: number;
  textColor?: 'auto' | 'light' | 'dark'; // Auto determines based on background color
  displayStyle?: 'header' | 'folder'; // header = full width bar, folder = tab style
  width?: 'full' | 'half' | 'third'; // Lay this group out as full/half/third row width (default 'full'). On narrow screens all groups become full.
  entries: Entry[];
  order: number;
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

export interface StatusResult {
  entryId: string;
  status: 'up' | 'down' | 'error' | 'unknown';
  responseTime?: number;
  lastChecked: Date;
}

export interface Config {
  dashboards: Dashboard[];
  theme: Theme;
  settings: Settings;
}

export interface Theme {
  mode: 'light' | 'dark' | 'auto';
  customCss?: string;
}

export interface Settings {
  searchHotkey: string;
  defaultView: string;
}
