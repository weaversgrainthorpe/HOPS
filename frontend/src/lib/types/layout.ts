import type { Background, Entry } from './index';

export type LayoutMode = 'grid' | 'free';

export interface Placement {
  x: number;
  y: number;
  w: number;
  h: number;
  z?: number;
}

export interface Container {
  columns: number;
  children: LayoutNode[];
}

export interface TileNode extends Entry {
  kind: 'tile';
  placement: Placement;
}

export interface FolderNode {
  kind: 'folder';
  id: string;
  name: string;
  icon?: string;
  iconUrl?: string;
  iconBgColor?: string;
  color?: string;
  opacity?: number;
  textColor?: 'auto' | 'light' | 'dark';
  layout?: 'inherit' | LayoutMode;
  display: 'expanded' | 'collapsed';
  shape?: string;
  showTitle?: boolean;
  /** Folder background (M4); missing or inherit form = none of its own. */
  background?: Background;
  placement: Placement;
  content: Container;
  [k: string]: unknown;
}

export type LayoutNode = TileNode | FolderNode;

export interface LayoutTab {
  id: string;
  name: string;
  layout?: 'inherit' | LayoutMode;
  designWidth?: number;
  /** Tab background (M4); missing or inherit form = the dashboard's shows. */
  background?: Background;
  root: Container;
  [k: string]: unknown;
}

export interface LayoutDashboard {
  id: string;
  name: string;
  path: string;
  revision: number;
  /** Display position among the dashboards (PUT /api/dashboards/order). */
  order?: number;
  defaultLayout?: LayoutMode;
  /** Dashboard background (M4); missing or inherit form = the global one. */
  background?: Background;
  /** Read-only, computed by GET /api/config from the effective settings (Ruling 9); never stored. */
  display?: { animatedFolderBackgrounds?: boolean };
  tabs: LayoutTab[];
  [k: string]: unknown;
}

export interface LayoutDoc {
  schemaVersion: 3;
  /**
   * The finer-grid marker (spec §9): 2 = the 24-column form this build writes. Absent or any other
   * value: an older form (or an older server); the editor refuses to save into it (Ruling 3).
   */
  gridUnit?: number;
  dashboards: LayoutDashboard[];
}
