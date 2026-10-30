// What an export left out. The server lists any uploaded picture it couldn't read in the file
// (config.missingAssets) and in the X-HOPS-Missing-Assets response header, which the page reads
// because a download can't show a warning of its own.

export interface MissingAsset {
  path: string;
  reason: string;
}

export const MISSING_ASSETS_HEADER = 'X-HOPS-Missing-Assets';

/**
 * The missing pictures named by the header (URL-escaped JSON). A header that can't be read is
 * itself reported as one entry, never taken as "nothing missing".
 */
export function missingAssetsFromHeader(header: string | null): MissingAsset[] {
  if (!header) return [];
  try {
    const list: unknown = JSON.parse(decodeURIComponent(header));
    if (Array.isArray(list)) {
      return list.map((m) => ({
        path: typeof m?.path === 'string' ? m.path : '(unnamed)',
        reason: typeof m?.reason === 'string' ? m.reason : 'could not be read'
      }));
    }
  } catch {
    // reported below
  }
  return [{ path: '(unknown)', reason: "the server's list of left-out pictures couldn't be read" }];
}

/** The warning for an export that left pictures out, or null when nothing is missing. */
export function missingAssetsWarning(missing: MissingAsset[]): string | null {
  if (missing.length === 0) return null;
  const n = missing.length;
  const names = missing.slice(0, 5).map((m) => `${m.path} (${m.reason})`).join('; ');
  const more = n > 5 ? `; and ${n - 5} more` : '';
  return `Exported, but ${n} ${n === 1 ? "picture couldn't be read and is" : "pictures couldn't be read and are"} not in the file: ${names}${more}.`;
}

export const IMPORT_WARNING_HEADER = 'X-HOPS-Import-Warning';

/**
 * Why the export couldn't be imported back as it is (too big for the import limits), from the
 * URL-escaped header, or null when it can. A header that can't be read still warns.
 */
export function importWarningFromHeader(header: string | null): string | null {
  if (!header) return null;
  try {
    return decodeURIComponent(header);
  } catch {
    return "Exported, but HOPS may not be able to import this file back (the server's warning couldn't be read).";
  }
}
