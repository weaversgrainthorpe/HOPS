// URL validation and safe opening utilities
import { logWarn } from '$lib/utils/errors';

/**
 * Validates a URL string and returns whether it's safe to open.
 * Allows http, https, and common protocols.
 */
export function isValidUrl(url: string): boolean {
  if (!url || typeof url !== 'string') {
    return false;
  }

  // Trim whitespace
  const trimmedUrl = url.trim();
  if (!trimmedUrl) {
    return false;
  }

  // Block dangerous protocols
  const dangerousProtocols = ['javascript:', 'data:', 'vbscript:'];
  const lowerUrl = trimmedUrl.toLowerCase();
  if (dangerousProtocols.some(protocol => lowerUrl.startsWith(protocol))) {
    return false;
  }

  // Allow common safe protocols
  const safeProtocols = ['http://', 'https://', 'ftp://', 'ftps://', 'ssh://', 'mailto:'];
  if (safeProtocols.some(protocol => lowerUrl.startsWith(protocol))) {
    try {
      // "http://" or "ssh://" with no host can never open.
      return new URL(trimmedUrl).host !== '' || lowerUrl.startsWith('mailto:');
    } catch {
      return false;
    }
  }

  // A scheme with its colon missing ("http//host") is a typo, not a host called "http".
  if (/^(https?|ftps?|ssh)\/\//.test(lowerUrl)) {
    return false;
  }

  // Allow protocol-relative URLs (//example.com)
  if (trimmedUrl.startsWith('//')) {
    try {
      new URL('https:' + trimmedUrl);
      return true;
    } catch {
      return false;
    }
  }

  // Allow relative paths (starting with /)
  if (trimmedUrl.startsWith('/')) {
    return true;
  }

  // A bare host (opened as https). Anything that already carries some other
  // scheme (file:, chrome:, or a typo such as http:\\host) is refused; only
  // "host:port" may have a colon before any "." or "/". Mirrors
  // configdoc.ValidTileURL (shared cases: tile_url_cases.json).
  const colon = trimmedUrl.indexOf(':');
  if (colon > 0 && !/[./]/.test(trimmedUrl.slice(0, colon)) && !looksLikeHostPort(trimmedUrl)) {
    return false;
  }
  try {
    return new URL('https://' + trimmedUrl).host !== '';
  } catch {
    return false;
  }
}

/** True for "host:8080" style input: digits only between the colon and any "/", "?" or "#". */
function looksLikeHostPort(s: string): boolean {
  let rest = s.slice(s.indexOf(':') + 1);
  const j = rest.search(/[/?#]/);
  if (j >= 0) rest = rest.slice(0, j);
  return /^[0-9]+$/.test(rest);
}

/**
 * Normalizes a URL for opening, adding https:// if no protocol is specified.
 */
function normalizeUrl(url: string): string {
  if (!url || typeof url !== 'string') {
    return '';
  }

  const trimmedUrl = url.trim();
  if (!trimmedUrl) {
    return '';
  }

  // Already has a protocol
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmedUrl)) {
    return trimmedUrl;
  }

  // Protocol-relative URL
  if (trimmedUrl.startsWith('//')) {
    return 'https:' + trimmedUrl;
  }

  // Relative path
  if (trimmedUrl.startsWith('/')) {
    return trimmedUrl;
  }

  // Add https:// for bare URLs
  return 'https://' + trimmedUrl;
}

/**
 * Safely opens a URL in a new tab with security best practices.
 * Returns true if the URL was opened, false if validation failed.
 */
export function safeOpenUrl(url: string, target: '_blank' | '_self' = '_blank'): boolean {
  if (!isValidUrl(url)) {
    logWarn('Attempted to open invalid URL: ' + url);
    return false;
  }

  const normalizedUrl = normalizeUrl(url);

  if (target === '_blank') {
    // Use noopener,noreferrer for security when opening new tabs
    window.open(normalizedUrl, '_blank', 'noopener,noreferrer');
  } else {
    window.location.href = normalizedUrl;
  }

  return true;
}

/**
 * The http(s) address a tile may show inside HOPS (iframe mode) or offer from
 * its popup, or null. Only http and https (and protocol-relative, root-relative
 * or bare-host forms, which open as https or on this origin) are allowed:
 * never javascript:, data:, ftp:, ssh:, mailto: or anything else (pentest L1).
 */
export function safeFrameUrl(url: string | undefined | null): string | null {
  if (typeof url !== 'string' || !isValidUrl(url)) return null;
  const n = normalizeUrl(url);
  if (n.startsWith('/') && !n.startsWith('//')) return n;
  try {
    const u = new URL(n);
    return u.protocol === 'http:' || u.protocol === 'https:' ? n : null;
  } catch {
    return null;
  }
}

/**
 * Why a tile address cannot be opened, or null when it can: blank, or a
 * scheme outside the allow-list (an "unsafe address", e.g. javascript:).
 */
export function tileUrlProblem(url: string | undefined | null): 'blank' | 'unsafe' | null {
  if (typeof url !== 'string' || url.trim() === '') return 'blank';
  return isValidUrl(url) ? null : 'unsafe';
}
