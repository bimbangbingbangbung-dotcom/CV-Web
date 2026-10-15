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

  it('allows base64 raster image data URLs (inline photos from #admin)', () => {
    expect(safeAssetPath('data:image/jpeg;base64,/9j/4AAQ')).toBe('data:image/jpeg;base64,/9j/4AAQ');
    expect(safeAssetPath('data:image/jpg;base64,AAAA')).toBe('data:image/jpg;base64,AAAA');
    expect(safeAssetPath('data:image/png;base64,iVBORw0KGgo=')).toBe('data:image/png;base64,iVBORw0KGgo=');
    expect(safeAssetPath('data:image/webp;base64,UklGRg==')).toBe('data:image/webp;base64,UklGRg==');
  });

  it('rejects non-image, non-base64 and script-capable data URLs', () => {
    expect(safeAssetPath('data:text/html;base64,PHNjcmlwdD4=')).toBeNull();
    expect(safeAssetPath('data:image/svg+xml;base64,PHN2Zz4=')).toBeNull();
    expect(safeAssetPath('data:image/jpeg,not-base64-payload')).toBeNull();
    expect(safeAssetPath('data:image/jpeg;base64,*** bad ***')).toBeNull();
    expect(safeAssetPath('data:image/jpeg;base64,')).toBeNull();
  });
});
