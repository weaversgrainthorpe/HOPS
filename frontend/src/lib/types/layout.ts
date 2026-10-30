import type { Background, Entry } from './index';

/** The three item sizes: Small 1 x 1 cell, Medium 2 x 2, Large 4 x 4 (geometry.sizeSpan). */
export type ItemSize = 'small' | 'medium' | 'large';

export interface Placement {
  x: number;
  y: number;
  w: number;
  h: number;
  z?: number;
}

/**
 * A container: a tab's root (24 columns, placed children) or a folder's content (an ORDERED list,
 * no placements, no columns).
 */
export interface Container {
  columns?: number;
  children: LayoutNode[];
}

export interface TileNode extends Entry {
  kind: 'tile';
  /** On a tab only (its Size's span); a tile inside a folder has none. */
  placement?: Placement;
}

/**
 * A folder's look: Rounded, Simple tab, or one of the five real-folder looks. Only ever one
 * of these names (geometry.FOLDER_SHAPES; the server refuses anything else), never markup.
 */
export type FolderShape =
  | 'rounded' | 'simple-tab' | 'folder-flat' | 'folder-paper' | 'folder-outline' | 'folder-cartoon' | 'folder-open';
/** Where a tab shape's tab sits. Missing = left. */
export type TabPosition = 'left' | 'centre' | 'right';

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
  display: 'expanded' | 'collapsed';
  /** Its size when minimised on a tab; kept but unused while inside a folder. */
  size?: ItemSize;
  /** The size every item inside it shows at. Missing = Medium. */
  contentSize?: ItemSize;
  /** Missing = Rounded (an unknown stored value also draws Rounded, with an edit-mode note). */
  shape?: FolderShape;
  /** Tab shapes only; missing = left. */
  tabPosition?: TabPosition;
  showTitle?: boolean;
  /** Folder background; missing or inherit form = none of its own. */
  background?: Background;
  /** On a tab only (its open box); a folder inside a folder has none. */
  placement?: Placement;
  content: Container;
  [k: string]: unknown;
}

export type LayoutNode = TileNode | FolderNode;

/** A node that sits on a tab: it has a placement (geometry.isPlaced is the runtime guard). */
export type PlacedNode = LayoutNode & { placement: Placement };

export interface LayoutTab {
  id: string;
  name: string;
  /** Tab background; missing or inherit form = the dashboard's shows. */
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
  /** Dashboard background; missing or inherit form = the global one. */
  background?: Background;
  /** Read-only, computed by GET /api/config from the effective settings; never stored. */
  display?: {
    animatedFolderBackgrounds?: boolean;
    /** The global "Animations" setting: the editor's drop and merge animations. */
    animations?: 'on' | 'off' | 'always';
  };
  tabs: LayoutTab[];
  [k: string]: unknown;
}

export interface LayoutDoc {
  schemaVersion: 3;
  /**
   * The stored layout format: geometry.LAYOUT_VERSION is the form this build writes.
   * Absent or any other value: another form (or another server); the editor refuses to save into it.
   */
  layoutVersion?: number;
  dashboards: LayoutDashboard[];
}
