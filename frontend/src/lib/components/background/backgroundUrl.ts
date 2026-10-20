// Which strings may become a CSS background `url()`, and how to quote them.
import { isValidUrl } from '$lib/utils/url';

/**
 * True for an http(s) URL (passing the same check as tile URLs) or a
 * same-origin root-relative asset path such as /backgrounds/… or /presets/….
 * Everything else — javascript:, data:, ftp:, bare hosts, protocol-relative
 * URLs — and any string holding quotes, parentheses, backslashes or control
 * characters is refused, so a stored value can never break out of `url("…")`.
 */
export function isSafeBackgroundUrl(url: unknown): url is string {
  if (typeof url !== 'string' || url !== url.trim() || !isValidUrl(url)) return false;
  // eslint-disable-next-line no-control-regex
  if (/["'()\\\u0000-\u001f\u007f]/.test(url)) return false;
  if (url.startsWith('/')) return !url.startsWith('//');
  try {
    const u = new URL(url);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

/** A CSS `url("…")` for an already-validated URL (escaped regardless). */
export function cssUrl(url: string): string {
  return `url("${url.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/[\n\r\f]/g, '')}")`;
}
