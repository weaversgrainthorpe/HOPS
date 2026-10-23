/**
 * Folder shapes are drawn at their real pixel size (M6 Task 3), measured by the canvas's ONE
 * ResizeObserver (Tenet 4: never one observer per folder). TabCanvas provides `observe` in context;
 * FolderShape registers its box with it. Outside a canvas (the dialog's previews) a shape is given
 * its size instead.
 */
export const SHAPE_MEASURE_CONTEXT = Symbol('hops-shape-measure');

export interface ShapeMeasure {
  /** Report `el`'s content box size to `onSize` now and on every change; returns the stop function. */
  observe(el: Element, onSize: (widthPx: number, heightPx: number) => void): () => void;
}
