/**
 * Whether HOPS is running as an installed app (home screen / desktop app) rather than in a browser
 * tab. An installed app has no address bar, so an address like /settings can't be typed there.
 * Covers every display mode an install can open in, and iOS home-screen apps, which report
 * navigator.standalone instead. Anything that can't be checked counts as a browser tab.
 */
export function isInstalledApp(): boolean {
  if (typeof window === 'undefined') return false;
  if ((navigator as Navigator & { standalone?: boolean }).standalone === true) return true;
  try {
    return ['standalone', 'fullscreen', 'minimal-ui'].some(
      (mode) => window.matchMedia(`(display-mode: ${mode})`).matches
    );
  } catch {
    return false;
  }
}
