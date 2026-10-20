import { describe, it, expect } from 'vitest';
import { cssUrl, isSafeBackgroundUrl } from './backgroundUrl';

describe('cssUrl', () => {
  it('escapes backslash and double quote', () => {
    expect(cssUrl('/backgrounds/a"b\\c.jpg')).toBe('url("/backgrounds/a\\"b\\\\c.jpg")');
  });
  it('percent-encodes control characters instead of dropping them', () => {
    expect(cssUrl('/backgrounds/a\nb\u0001c\u007f.jpg')).toBe('url("/backgrounds/a%0Ab%01c%7F.jpg")');
  });
  it('leaves brackets, quotes and spaces readable', () => {
    expect(cssUrl("/backgrounds/it's (1).jpg")).toBe('url("/backgrounds/it\'s (1).jpg")');
  });
});

describe('isSafeBackgroundUrl', () => {
  it.each(['/backgrounds/x.jpg', '/presets/x.jpg', 'https://a.example/x.jpg', 'http://a.example/x (1).jpg'])('allows %j', (u) => {
    expect(isSafeBackgroundUrl(u)).toBe(true);
  });
  it.each(['/api/config', '/', '/backgroundsx/a.jpg', '/backgrounds/../api/x', '/presets/%2e%2e/api', '//a.example/x.jpg', 'javascript:alert(1)', ' /backgrounds/a.jpg', 'data:image/png;base64,AA'])('refuses %j', (u) => {
    expect(isSafeBackgroundUrl(u)).toBe(false);
  });
});
