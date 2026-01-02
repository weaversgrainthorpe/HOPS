// Type definitions matching the backend models

export interface Dashboard {
  id: string;
  name: string;
  path: string;
  background?: Background;
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
  collapsed: boolean;
  color?: string;
  opacity?: number;
  textColor?: 'auto' | 'light' | 'dark'; // Auto determines based on background color
  entries: Entry[];
  order: number;
}

export interface Entry {
  id: string;
  name: string;
  url: string;
  icon: string;
  iconUrl?: string;
  description?: string;
  openMode: 'iframe' | 'newtab' | 'sametab' | 'modal';
  statusCheck?: StatusCheck;
  size: 'small' | 'medium' | 'large';
  color?: string;
  opacity?: number;
  order: number;
  showStatus?: boolean;
  fetchFavicon?: boolean;
}

export interface Background {
  type: 'image' | 'slideshow' | 'color';
  value?: string;
  images?: string[];
  interval?: number; // Duration in seconds
  fit?: 'cover' | 'contain' | 'fill'; // How to fit the image
}

export interface StatusCheck {
  type: 'http' | 'icmp';
  enabled: boolean;
  interval: number;
}

export interface StatusResult {
  entryId: string;
  status: 'online' | 'offline' | 'unknown';
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

export interface Widget {
  id: string;
  type: string;
  config: Record<string, any>;
  position: Position;
}

export interface Position {
  x: number;
  y: number;
  width: number;
  height: number;
}
