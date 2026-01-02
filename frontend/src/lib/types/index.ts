// Type definitions matching the backend models

export interface Dashboard {
  id: string;
  name: string;
  path: string;
  background?: Background;
  tabs: Tab[];
  order: number;
}

export interface Tab {
  id: string;
  name: string;
  background?: Background;
  groups: Group[];
  order: number;
}

export interface Group {
  id: string;
  name: string;
  collapsed: boolean;
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
  order: number;
}

export interface Background {
  type: 'image' | 'slideshow' | 'color';
  value?: string;
  images?: string[];
  interval?: number;
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
