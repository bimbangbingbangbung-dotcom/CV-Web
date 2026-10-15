/**
 * Cropper geometry — the pure cover / pan / zoom math behind the photo
 * adjustment dialog (#admin owner.photo). The interactive flow itself
 * (drag, slider, apply/cancel) is covered by the e2e upload tests.
 */
import { describe, it, expect } from 'vitest';
import {
  CROP_RATIO,
  MAX_ZOOM,
  VIEW_H,
  VIEW_W,
  clampPan,
  coverScale,
  imageRect,
} from '../../src/admin/crop';

const view = { w: VIEW_W, h: VIEW_H }; // 264 × 352 logical px

describe('viewport', () => {
  it('is a 3:4 portrait, matching the hero avatar', () => {
    expect(VIEW_W / VIEW_H).toBeCloseTo(CROP_RATIO, 5);
    expect(VIEW_H).toBeGreaterThan(VIEW_W);
    expect(MAX_ZOOM).toBeGreaterThan(1);
  });
});

describe('coverScale', () => {
  it('scales a square photo until the height is covered (portrait viewport)', () => {
    expect(coverScale(view, { w: 1000, h: 1000 })).toBeCloseTo(352 / 1000, 5);
  });

  it('is width-driven for a narrow portrait photo', () => {
    expect(coverScale(view, { w: 500, h: 2000 })).toBeCloseTo(264 / 500, 5);
  });

  it('never scales a large photo up beyond the viewport needs', () => {
    //4000×3000 phone photo: height-driven, 0.117 px per image px.
    expect(coverScale(view, { w: 4000, h: 3000 })).toBeCloseTo(352 / 3000, 5);
  });
});

describe('clampPan', () => {
  const img = { w: 1000, h: 1000 };
  const scale = coverScale(view, img); // image draws at 352×352 logical px

  it('clamps offsets so the photo always covers the viewport', () => {
    const pushed = clampPan(500, -500, view, img, scale);
    expect(pushed.dx).toBe(0); // right edge allowed, never past it
    expect(pushed.dy).toBe(0); // square: the height fits exactly, no slack

    const pulled = clampPan(-500, 500, view, img, scale);
    expect(pulled.dx).toBeCloseTo(264 - 1000 * scale, 5); // left edge, still covering
    expect(pulled.dy).toBe(0);
  });

  it('leaves valid offsets untouched', () => {
    expect(clampPan(-40, 0, view, img, scale)).toEqual({ dx: -40, dy: 0 });
    expect(clampPan(0, 0, view, img, scale)).toEqual({ dx: 0, dy: 0 });
  });
});

describe('imageRect', () => {
  it('returns the full-height strip of a square photo at zoom 1', () => {
    const rect = imageRect(view, { w: 1000, h: 1000 }, 1, 0, 0);
    expect(rect).toEqual({ sx: 0, sy: 0, sw: 750, sh: 1000 });
  });

  it('halves the visible pixels when the zoom doubles', () => {
    const rect = imageRect(view, { w: 1000, h: 1000 }, 2, 0, 0);
    expect(rect.sw).toBe(375);
    expect(rect.sh).toBe(500);
  });

  it('crops the sides of a landscape photo (height-driven cover)', () => {
    // Panned hard left: clamped to the right edge, full height kept.
    const rect = imageRect(view, { w: 4000, h: 3000 }, 1, -5000, 0);
    expect(rect.sw).toBe(2250);
    expect(rect.sh).toBe(3000);
    expect(rect.sx).toBe(1750); // flush with the right edge of the photo
    expect(rect.sy).toBe(0);
  });

  it('stays inside the photo even with out-of-range pan values', () => {
    const rect = imageRect(view, { w: 1000, h: 1000 }, 1, 9999, -9999);
    expect(rect.sx).toBeGreaterThanOrEqual(0);
    expect(rect.sy).toBeGreaterThanOrEqual(0);
    expect(rect.sx + rect.sw).toBeLessThanOrEqual(1000);
    expect(rect.sy + rect.sh).toBeLessThanOrEqual(1000);
  });
});
