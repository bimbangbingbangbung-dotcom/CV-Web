/**
 * Photo cropper for the #admin editor (owner.photo).
 *
 * Once a file passes validation (image.ts) the owner adjusts it in a dialog:
 * a 3:4 viewport — the hero avatar's ratio — that the photo can be dragged
 * inside and zoomed with a slider. "Apply photo" renders the visible region
 * to a canvas at source resolution; the panel hands that canvas to
 * optimizeCanvas(). Cancel / Esc discards the picked file.
 *
 * The geometry helpers are pure so unit tests can pin the math.
 */
import { h } from '../utils/dom';
import { photoDimensions, PhotoError } from './image';

/** Viewport ratio (width / height) — matches the hero .avatar (3:4). */
export const CROP_RATIO = 3 / 4;

/** Logical viewport size in CSS px; the backing store scales by devicePixelRatio. */
export const VIEW_W = 264;
export const VIEW_H = Math.round(VIEW_W / CROP_RATIO);

export const MIN_ZOOM = 1;
export const MAX_ZOOM = 5;

export interface Size {
  w: number;
  h: number;
}

export interface SourceRect {
  sx: number;
  sy: number;
  sw: number;
  sh: number;
}

/** CSS px per image px at zoom 1 — the image just covers the viewport. */
export function coverScale(view: Size, img: Size): number {
  return Math.max(view.w / img.w, view.h / img.h);
}

/** Keep pan offsets in the range where the photo still covers the viewport. */
export function clampPan(
  dx: number,
  dy: number,
  view: Size,
  img: Size,
  scale: number,
): { dx: number; dy: number } {
  const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
  return {
    dx: clamp(dx, view.w - img.w * scale, 0),
    dy: clamp(dy, view.h - img.h * scale, 0),
  };
}

/** Which part of the source photo (image pixels) the viewport shows. */
export function imageRect(view: Size, img: Size, zoom: number, dx: number, dy: number): SourceRect {
  const scale = coverScale(view, img) * zoom;
  const pan = clampPan(dx, dy, view, img, scale);
  const sw = Math.max(1, Math.min(img.w, Math.round(view.w / scale)));
  const sh = Math.max(1, Math.min(img.h, Math.round(view.h / scale)));
  const sx = Math.max(0, Math.min(img.w - sw, Math.round(-pan.dx / scale)));
  const sy = Math.max(0, Math.min(img.h - sh, Math.round(-pan.dy / scale)));
  return { sx, sy, sw, sh };
}

/** Render a source rectangle of the photo to a fresh canvas (white-matted). */
export function cropToCanvas(
  source: ImageBitmap | HTMLImageElement,
  rect: SourceRect,
): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = rect.sw;
  canvas.height = rect.sh;
  const g = canvas.getContext('2d');
  if (!g) throw new PhotoError('canvas is not available in this browser.');
  g.fillStyle = '#ffffff'; // JPEG has no alpha — white mattes any edge pixels
  g.fillRect(0, 0, rect.sw, rect.sh);
  g.drawImage(source, rect.sx, rect.sy, rect.sw, rect.sh, 0, 0, rect.sw, rect.sh);
  return canvas;
}

/**
 * Open the adjustment dialog for a decoded photo. Resolves with the cropped
 * canvas, or null when the owner cancels (button or Esc).
 */
export function openCropper(
  source: ImageBitmap | HTMLImageElement,
): Promise<HTMLCanvasElement | null> {
  return new Promise((resolve, reject) => {
    const view: Size = { w: VIEW_W, h: VIEW_H };
    const img = photoDimensions(source);
    const dpr = Math.min(3, Math.max(1, window.devicePixelRatio || 1));

    const canvas = h('canvas', {
      class: 'crop-canvas',
      attrs: {
        tabindex: '0',
        role: 'application',
        'aria-label':
          'Crop area — drag with the pointer, or focus and use the arrow keys to reposition the photo',
      },
    });
    canvas.width = VIEW_W * dpr;
    canvas.height = VIEW_H * dpr;

    const slider = h('input', {
      class: 'crop-zoom-input',
      attrs: {
        type: 'range',
        min: String(MIN_ZOOM),
        max: String(MAX_ZOOM),
        step: '0.1',
        value: String(MIN_ZOOM),
        'aria-label': 'Zoom',
      },
    });
    const pct = h('span', {
      class: 'crop-zoom-value',
      text: '100%',
      attrs: { 'aria-hidden': 'true' },
    });

    let zoom = MIN_ZOOM;
    let dx = 0;
    let dy = 0;

    const scaleOf = (): number => coverScale(view, img) * zoom;

    const redraw = (): void => {
      const g = canvas.getContext('2d');
      if (!g) return;
      const s = scaleOf();
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, view.w, view.h);
      g.drawImage(source, dx, dy, img.w * s, img.h * s);
    };

    const syncControls = (): void => {
      slider.value = String(zoom);
      pct.textContent = `${Math.round(zoom * 100)}%`;
    };

    const pan = (nx: number, ny: number): void => {
      const c = clampPan(nx, ny, view, img, scaleOf());
      dx = c.dx;
      dy = c.dy;
      redraw();
    };

    /** Zoom while keeping the current viewport centre fixed on the photo. */
    const setZoom = (next: number): void => {
      const oldScale = scaleOf();
      const cx = (view.w / 2 - dx) / oldScale;
      const cy = (view.h / 2 - dy) / oldScale;
      zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, next));
      const s = scaleOf();
      pan(view.w / 2 - cx * s, view.h / 2 - cy * s);
      syncControls();
    };

    const resetView = (): void => {
      zoom = MIN_ZOOM;
      const s = scaleOf();
      pan((view.w - img.w * s) / 2, (view.h - img.h * s) / 2);
      syncControls();
    };

    // --- Pointer drag (mouse, touch and pen via Pointer Events) ---
    let drag: { x: number; y: number; dx: number; dy: number } | null = null;
    canvas.addEventListener('pointerdown', (e) => {
      drag = { x: e.clientX, y: e.clientY, dx, dy };
      canvas.setPointerCapture(e.pointerId);
      e.preventDefault();
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const rect = canvas.getBoundingClientRect();
      if (rect.width < 1 || rect.height < 1) return;
      // Map client px → logical viewport px (the canvas may be display-scaled).
      const kx = view.w / rect.width;
      const ky = view.h / rect.height;
      pan(drag.dx + (e.clientX - drag.x) * kx, drag.dy + (e.clientY - drag.y) * ky);
    });
    const endDrag = (): void => {
      drag = null;
    };
    canvas.addEventListener('pointerup', endDrag);
    canvas.addEventListener('pointercancel', endDrag);

    // --- Keyboard pan: reposition without a pointer ---
    canvas.addEventListener('keydown', (e) => {
      const step = e.shiftKey ? 24 : 8;
      const moves: Record<string, readonly [number, number]> = {
        ArrowLeft: [-step, 0],
        ArrowRight: [step, 0],
        ArrowUp: [0, -step],
        ArrowDown: [0, step],
      };
      const move = moves[e.key];
      if (!move) return;
      e.preventDefault();
      pan(dx + move[0], dy + move[1]);
    });

    slider.addEventListener('input', () => setZoom(Number(slider.value)));

    // --- Dialog shell (same pattern as confirmAction in panel.ts) ---
    const applyBtn = h('button', {
      class: 'btn btn-primary btn-sm',
      text: 'Apply photo',
      attrs: { type: 'button' },
    });
    const cancelBtn = h('button', {
      class: 'btn btn-ghost btn-sm',
      text: 'Cancel',
      attrs: { type: 'button' },
    });
    const resetBtn = h('button', {
      class: 'btn btn-ghost btn-sm',
      text: 'Reset',
      attrs: { type: 'button' },
    });

    const dialog = h('dialog', { class: 'admin-dialog crop-dialog' });
    let result: HTMLCanvasElement | null = null;
    let failure: unknown = null;

    applyBtn.addEventListener('click', () => {
      try {
        result = cropToCanvas(source, imageRect(view, img, zoom, dx, dy));
        dialog.close();
      } catch (error) {
        failure = error;
        dialog.close();
      }
    });
    cancelBtn.addEventListener('click', () => dialog.close());
    resetBtn.addEventListener('click', () => resetView());

    dialog.append(
      h('h2', { class: 'dialog-title', text: 'Adjust photo' }),
      h('p', {
        class: 'dialog-text',
        text: 'Drag the photo to choose the visible area and use the slider to zoom. The crop is the 3:4 portrait shown on your home page.',
      }),
      h('div', { class: 'crop-stage' }, canvas),
      h(
        'label',
        { class: 'crop-zoom' },
        h('span', { text: 'Zoom' }),
        slider,
        pct,
      ),
      h('div', { class: 'dialog-actions' }, cancelBtn, resetBtn, applyBtn),
    );

    document.body.append(dialog);
    dialog.addEventListener(
      'close',
      () => {
        dialog.remove();
        if (failure !== null) reject(failure);
        else resolve(result);
      },
      { once: true },
    );

    resetView();
    dialog.showModal();
    canvas.focus();
  });
}
