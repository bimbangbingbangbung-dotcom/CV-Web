/**
 * URL safety: hostile schemes must never reach the DOM.
 */
import { describe, it, expect } from 'vitest';
import { safeExternalUrl, safeAssetPath } from '../../src/utils/url';

describe('safeExternalUrl', () => {
  it('allows http, https, mailto and tel', () => {
    expect(safeExternalUrl('https://example.com/x')).toBe('https://example.com/x');
    expect(safeExternalUrl('http://example.com')).toBe('http://example.com');
    expect(safeExternalUrl('mailto:me@example.com')).toBe('mailto:me@example.com');
    expect(safeExternalUrl('tel:+639171234567')).toBe('tel:+639171234567');
  });

  it('rejects javascript:, data: and vbscript: URLs', () => {
    expect(safeExternalUrl('javascript:alert(1)')).toBeNull();
    expect(safeExternalUrl('JavaScript:alert(1)')).toBeNull();
    expect(safeExternalUrl('data:text/html,<script>x</script>')).toBeNull();
    expect(safeExternalUrl('vbscript:msgbox(1)')).toBeNull();
  });

  it('rejects protocol-relative and bare strings', () => {
    expect(safeExternalUrl('//evil.example')).toBeNull();
    expect(safeExternalUrl('just some text')).toBeNull();
  });
});

describe('safeAssetPath', () => {
  it('allows site-relative paths and absolute http(s)', () => {
    expect(safeAssetPath('/assets/cv.pdf')).toBe('/assets/cv.pdf');
    expect(safeAssetPath('./assets/photo.jpg')).toBe('./assets/photo.jpg');
    expect(safeAssetPath('https://cdn.example/p.png')).toBe('https://cdn.example/p.png');
  });

  it('rejects dangerous schemes', () => {
    expect(safeAssetPath('javascript:alert(1)')).toBeNull();
    expect(safeAssetPath('data:image/svg+xml,<svg onload=alert(1)>')).toBeNull();
  });
});
