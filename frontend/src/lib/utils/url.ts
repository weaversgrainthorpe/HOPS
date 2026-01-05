// URL validation and safe opening utilities

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
      new URL(trimmedUrl);
      return true;
    } catch {
      return false;
    }
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

  // If no protocol specified, try to validate as a potential URL with https
  try {
    new URL('https://' + trimmedUrl);
    return true;
  } catch {
    return false;
  }
}

/**
 * Normalizes a URL for opening, adding https:// if no protocol is specified.
 */
export function normalizeUrl(url: string): string {
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
    console.warn('Attempted to open invalid URL:', url);
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
