/**
 * Color contrast utility functions
 * Automatically determines if text should be light or dark based on background color
 */

/**
 * Calculate relative luminance of a color
 * Based on WCAG 2.0 guidelines
 */
function getLuminance(r: number, g: number, b: number): number {
  const [rs, gs, bs] = [r, g, b].map(c => {
    c = c / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
}

/**
 * Parse hex color to RGB
 */
function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result
    ? {
        r: parseInt(result[1], 16),
        g: parseInt(result[2], 16),
        b: parseInt(result[3], 16)
      }
    : null;
}

/**
 * Calculate contrast ratio between two colors
 */
function getContrastRatio(color1: string, color2: string): number {
  const rgb1 = hexToRgb(color1);
  const rgb2 = hexToRgb(color2);

  if (!rgb1 || !rgb2) return 1;

  const lum1 = getLuminance(rgb1.r, rgb1.g, rgb1.b);
  const lum2 = getLuminance(rgb2.r, rgb2.g, rgb2.b);

  const lighter = Math.max(lum1, lum2);
  const darker = Math.min(lum1, lum2);

  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * Determine if text should be light or dark based on background color
 * Returns 'light' or 'dark'
 */
export function getAutoTextColor(backgroundColor: string): 'light' | 'dark' {
  const rgb = hexToRgb(backgroundColor);
  if (!rgb) return 'light'; // Default to light if parsing fails

  const luminance = getLuminance(rgb.r, rgb.g, rgb.b);

  // Threshold of 0.5 works well for most cases
  // Higher luminance = lighter background = use dark text
  return luminance > 0.5 ? 'dark' : 'light';
}

/**
 * Get the actual text color based on mode
 */
export function getTextColorValue(mode: 'light' | 'dark' | 'auto', backgroundColor?: string): string {
  if (mode === 'auto' && backgroundColor) {
    const autoMode = getAutoTextColor(backgroundColor);
    return autoMode === 'light' ? '#ffffff' : '#000000';
  }
  return mode === 'light' ? '#ffffff' : '#000000';
}

/**
 * Check if contrast ratio meets WCAG AA standard (4.5:1 for normal text)
 */
export function meetsContrastStandard(textColor: string, backgroundColor: string): boolean {
  const ratio = getContrastRatio(textColor, backgroundColor);
  return ratio >= 4.5;
}

/**
 * Get contrast ratio as a readable string
 */
export function getContrastRatioString(textColor: string, backgroundColor: string): string {
  const ratio = getContrastRatio(textColor, backgroundColor);
  return `${ratio.toFixed(2)}:1`;
}
