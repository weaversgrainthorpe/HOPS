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
  /** The pre-import backup failed (the import went through anyway). */
  warning?: string;
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
  if (r.warning) {
    out.push(r.warning);
  }
  return out;
}
