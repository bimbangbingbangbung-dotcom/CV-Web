/**
 * Photo upload helpers for the #admin editor — data URL decoding and the
 * input validation of optimizePhoto. The canvas pipeline itself needs a real
 * browser and is covered by the e2e upload test.
 */
import { describe, it, expect } from 'vitest';
import { dataUrlToBytes, isDataImage, optimizePhoto, PhotoError } from '../../src/admin/image';

describe('isDataImage', () => {
  it('detects inline image values', () => {
    expect(isDataImage('data:image/jpeg;base64,/9j/4AAQ')).toBe(true);
    expect(isDataImage('data:image/png;base64,AAAA')).toBe(true);
  });

  it('rejects paths, URLs and null', () => {
    expect(isDataImage('./assets/photo.jpg')).toBe(false);
    expect(isDataImage('https://example.com/p.png')).toBe(false);
    expect(isDataImage(null)).toBe(false);
    expect(isDataImage(undefined)).toBe(false);
  });
});

describe('dataUrlToBytes', () => {
  it('decodes a base64 payload back to bytes', () => {
    const bytes = dataUrlToBytes(`data:image/jpeg;base64,${btoa('JFIF-ish')}`);
    expect(bytes).toEqual(Uint8Array.from('JFIF-ish', (c) => c.charCodeAt(0)));
  });

  it('preserves non-ASCII byte values', () => {
    const raw = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00]);
    const b64 = btoa(String.fromCharCode(...raw));
    expect(dataUrlToBytes(`data:image/jpeg;base64,${b64}`)).toEqual(raw);
  });

  it('returns null for non-data-URLs and malformed payloads', () => {
    expect(dataUrlToBytes('./assets/photo.jpg')).toBeNull();
    expect(dataUrlToBytes('data:image/jpeg,rawdata')).toBeNull();
    expect(dataUrlToBytes('data:image/jpeg;base64,*** not base64 ***')).toBeNull();
    expect(dataUrlToBytes('data:image/jpeg;base64,')).toBeNull();
  });

  it('returns null when base64 decoding fails', () => {
    // Valid charset but a length that makes atob throw (length % 4 === 1).
    expect(dataUrlToBytes('data:image/jpeg;base64,AAAAA')).toBeNull();
  });
});

describe('optimizePhoto input validation', () => {
  it('rejects unsupported file types with a friendly message', async () => {
    const gif = new File(['GIF89a'], 'anim.gif', { type: 'image/gif' });
    await expect(optimizePhoto(gif, 512)).rejects.toThrow(/JPG, PNG or WebP/);
    await expect(optimizePhoto(gif, 512)).rejects.toBeInstanceOf(PhotoError);
  });

  it('rejects a file with no recognized extension either', async () => {
    const mystery = new File(['binary'], 'photo.tiff', { type: '' });
    await expect(optimizePhoto(mystery, 512)).rejects.toThrow(/JPG, PNG or WebP/);
  });
});
