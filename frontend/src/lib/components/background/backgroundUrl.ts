// Which strings may become a CSS background `url()`, and how to quote them.
import { isValidUrl } from '$lib/utils/url';

/** Same-origin folders background images are served from (uploads, presets). */
const ASSET_PREFIXES = ['/backgrounds/', '/presets/'];

/**
 * True for an http(s) URL (passing the same check as tile URLs) or a
 * same-origin asset path under /backgrounds/ or /presets/. Everything else —
 * javascript:, data:, ftp:, bare hosts, protocol-relative URLs, other
 * same-origin paths such as /api/… (including via ../ tricks) — is refused.
 * Quotes, brackets and spaces are allowed: cssUrl() escapes them, so the
 * escaping (not this check) is the CSS security boundary.
 */
export function isSafeBackgroundUrl(url: unknown): url is string {
  if (typeof url !== 'string' || url === '' || url !== url.trim() || !isValidUrl(url)) return false;
  if (url.startsWith('/')) {
    if (url.startsWith('//')) return false;
    let path: string;
    try {
      path = new URL(url, 'http://same-origin.invalid').pathname;
    } catch {
      return false;
    }
    let decoded: string;
    try {
      decoded = decodeURIComponent(url);
    } catch {
      return false;
    }
    if (/(^|[/\\])\.\.([/\\]|$)/.test(decoded)) return false;
    return ASSET_PREFIXES.some((p) => url.startsWith(p) && path.startsWith(p));
  }
  try {
    const u = new URL(url);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * A CSS `url("…")` for any string: `\` and `"` are backslash-escaped and
 * control characters (incl. newlines) are percent-encoded, so the value can
 * never end the string or the declaration.
 */
export function cssUrl(url: string): string {
  const escaped = url
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0'));
  return `url("${escaped}")`;
}
