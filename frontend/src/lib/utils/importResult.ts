/** Response of POST /api/config/import. */
export interface ImportResult {
  success: boolean;
  message: string;
  /** Embedded assets (icons/backgrounds) that could not be written. */
  assetsFailed?: string[];
  /** Why icon auto-matching was skipped, when it was. */
  iconMatchError?: string;
  /** Items in the file that were not dashboards and were left out. */
  skipped?: string[] | null;
  /** Folders stored below their smallest open box, enlarged on import (one line each). */
  foldersEnlarged?: string[] | null;
  /** The pre-import backup failed (the import went through anyway). */
  warning?: string;
  /** What another dashboard's file had that HOPS couldn't bring in (one line per kind). */
  notCarried?: string[] | null;
  /** What was added, replaced, kept alongside (renamed) and skipped. */
  summary?: ImportSummary;
}

/** The stored dashboard an imported one has the same name as. */
export interface ImportClash {
  id: string;
  name: string;
  path: string;
}

/** One dashboard of the file, from POST /api/config/import with preview=true. */
export interface ImportPreviewRow {
  index: number;
  name: string;
  path: string;
  tabs: number;
  clash: ImportClash | null;
}

export interface ImportPreview {
  preview: true;
  format: string;
  dashboards: ImportPreviewRow[];
  notCarried?: string[] | null;
}

/** add for a new name; replace, keep (both) or skip for a name already used. */
export type ImportChoice = 'add' | 'replace' | 'keep' | 'skip';

export interface ImportSummary {
  added: string[];
  replaced: string[];
  renamed: { from: string; to: string }[];
  skipped: string[];
}

/** A new name starts as Add; a clash starts with no choice, so the admin picks one. */
export function initialChoices(rows: ImportPreviewRow[]): (ImportChoice | null)[] {
  return rows.map((r) => (r.clash ? null : 'add'));
}

/** True when there is something to import and every dashboard has a choice. */
export function choicesReady(rows: ImportPreviewRow[], choices: (ImportChoice | null)[]): boolean {
  return rows.length > 0 && rows.every((_, i) => choices[i] != null);
}

/** The summary as one line per kind of change (none when nothing changed). */
export function summaryLines(s: ImportSummary): string[] {
  const out: string[] = [];
  if (s.added.length) out.push(`Added: ${s.added.join(', ')}`);
  if (s.replaced.length) out.push(`Replaced: ${s.replaced.join(', ')}`);
  for (const r of s.renamed) out.push(`Kept both: ${r.from}, the new one is "${r.to}"`);
  if (s.skipped.length) out.push(`Skipped: ${s.skipped.join(', ')}`);
  return out;
}

/**
 * The parts of an import that did not fully succeed. Non-empty means the
 * import must be shown as a warning (never as a plain success), so a
 * partially-applied import cannot pass for a complete one.
 */
export function importProblems(r: ImportResult): string[] {
  const out: string[] = [];
  const failed = r.assetsFailed ?? [];
  if (failed.length > 0) {
    out.push(`${failed.length} asset(s) could not be restored: ${failed.join('; ')}`);
  }
  if (r.iconMatchError) {
    out.push(`Icon auto-matching was skipped: ${r.iconMatchError}`);
  }
  const skipped = r.skipped ?? [];
  if (skipped.length > 0) {
    out.push(`Skipped ${skipped.length} item(s): ${skipped.join('; ')}`);
  }
  // Changed from the file, so shown (never a self-closing success).
  for (const line of r.foldersEnlarged ?? []) out.push(line);
  for (const line of r.notCarried ?? []) out.push(line);
  if (r.warning) {
    out.push(r.warning);
  }
  return out;
}
