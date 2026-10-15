/**
 * Photo uploads for the #admin editor (owner.photo).
 *
 * A chosen file is decoded, orientation-corrected, downscaled and re-encoded
 * to JPEG entirely in the browser — the editor never uploads anything to a
 * server of ours. The result is stored as a base64 data URL in the draft so
 * live preview, undo, Download content.json and draft autosave all work with
 * no extra plumbing; "Save to GitHub" then extracts it into
 * `<repo>/assets/photo.jpg` and commits the plain path instead (see panel.ts).
 *
 * Limits come from content.json admin.imageMaxKB (schema: 32–4096 KB).
 */

/** Types we accept at the file picker (also checked by extension fallback). */
const ACCEPTED = ['image/jpeg', 'image/png', 'image/webp'];

/** Long edge cap — well above the 13rem hero display size, even for 2×/zoom. */
const MAX_EDGE = 1200;

/** Decode guard: files bigger than this are refused before we touch pixels. */
const INPUT_LIMIT = 15 * 1024 * 1024;

/** Encode ladder: quality first (keeps resolution), then a little shrinking. */
const QUALITIES = [0.85, 0.7, 0.55, 0.4];
const SHRINKS = [1, 0.75, 0.55];

/** Friendly, user-facing photo failure (message reaches the status line). */
export class PhotoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PhotoError';
  }
}

/** True for an inline image value (string starting with data:image/). */
export function isDataImage(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith('data:image/');
}

/**
 * Split a `data:image/…;base64,…` URL into raw bytes.
 * Returns null when the value is not a well-formed base64 data URL.
 */
export function dataUrlToBytes(dataUrl: string): Uint8Array | null {
  const match = /^data:[^;,]+;base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  const payload = match?.[1];
  if (!payload) return null;
  try {
    const binary = atob(payload);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new PhotoError('could not read the processed image'));
    reader.readAsDataURL(blob);
  });
}

function toJpeg(canvas: HTMLCanvasElement, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
}

async function decode(file: File): Promise<ImageBitmap | HTMLImageElement> {
  // createImageBitmap applies EXIF orientation ("from-image") so portrait
  // phone photos come out upright before they hit the canvas.
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch {
      /* fall through to the <img> path (file may still decode there) */
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await img.decode();
    return img;
  } catch {
    throw new PhotoError('that file could not be opened as an image — pick a JPG, PNG or WebP.');
  } finally {
    URL.revokeObjectURL(url);
  }
}

function dimensions(source: ImageBitmap | HTMLImageElement): { w: number; h: number } {
  if ('naturalWidth' in source) return { w: source.naturalWidth, h: source.naturalHeight };
  return { w: source.width, h: source.height };
}

/**
 * Validate, downscale and re-encode a picked photo as a JPEG data URL
 * whose payload stays within `maxKB`. Throws PhotoError with a message
 * meant for the status line.
 */
export async function optimizePhoto(file: File, maxKB: number): Promise<string> {
  const accepted =
    ACCEPTED.includes(file.type) || /\.(jpe?g|png|webp)$/i.test(file.name);
  if (!accepted) {
    throw new PhotoError('use a JPG, PNG or WebP image — other formats are not supported.');
  }
  if (file.size > INPUT_LIMIT) {
    throw new PhotoError('that file is too large (over 15 MB) — crop or resize it first.');
  }

  const source = await decode(file);
  try {
    const { w, h } = dimensions(source);
    if (w < 1 || h < 1) {
      throw new PhotoError('that image has no pixels — pick a different file.');
    }
    const baseScale = Math.min(1, MAX_EDGE / Math.max(w, h));
    const limit = Math.max(1, Math.floor(maxKB * 1024));

    for (const shrink of SHRINKS) {
      const scale = baseScale * shrink;
      const cw = Math.max(1, Math.round(w * scale));
      const ch = Math.max(1, Math.round(h * scale));
      const canvas = document.createElement('canvas');
      canvas.width = cw;
      canvas.height = ch;
      const g = canvas.getContext('2d');
      if (!g) throw new PhotoError('canvas is not available in this browser.');
      g.fillStyle = '#ffffff'; // JPEG has no alpha — keep transparency from going black
      g.fillRect(0, 0, cw, ch);
      g.drawImage(source, 0, 0, cw, ch);
      for (const quality of QUALITIES) {
        const blob = await toJpeg(canvas, quality);
        if (!blob) throw new PhotoError('could not encode the image in this browser.');
        if (blob.size <= limit) return await blobToDataUrl(blob);
      }
    }
    throw new PhotoError(`could not get it under ${maxKB} KB — try a smaller or cropped photo.`);
  } finally {
    if ('close' in source) source.close();
  }
}
