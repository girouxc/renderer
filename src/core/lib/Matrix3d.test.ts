import { describe, expect, it } from 'vitest';
import { Matrix3d } from './Matrix3d.js';

describe('Matrix3d.setTranslate', () => {
  it('writes tx/ty without touching ta/tb/tc/td', () => {
    const m = Matrix3d.identity();
    m.setTranslate(10, 20);
    expect(m.tx).toBe(10);
    expect(m.ty).toBe(20);
    expect(m.ta).toBe(1);
    expect(m.tb).toBe(0);
    expect(m.tc).toBe(0);
    expect(m.td).toBe(1);
  });

  it('updates the float array on subsequent getFloatArr() calls', () => {
    const m = Matrix3d.identity();
    m.setTranslate(5, 7);
    // First read populates the array
    const arr = m.getFloatArr();
    expect(arr[6]).toBe(5);
    expect(arr[7]).toBe(7);

    // Mutate, then expect getFloatArr() to pick up the change.
    m.setTranslate(9, 11);
    const arr2 = m.getFloatArr();
    expect(arr2[6]).toBe(9);
    expect(arr2[7]).toBe(11);
    // Same array reference reused (no GC pressure).
    expect(arr2).toBe(arr);
  });

  it('overwrites prior tx/ty values', () => {
    const m = Matrix3d.translate(100, 200);
    m.setTranslate(0, 0);
    expect(m.tx).toBe(0);
    expect(m.ty).toBe(0);
  });
});

describe('Matrix3d.rotate(0) fast path', () => {
  it('produces an identity matrix for angle=0', () => {
    const m = Matrix3d.rotate(0);
    expect(m.ta).toBe(1);
    expect(m.tb).toBe(0);
    expect(m.tc).toBe(0);
    expect(m.td).toBe(1);
    expect(m.tx).toBe(0);
    expect(m.ty).toBe(0);
  });

  it('resets a pre-populated out matrix to identity on angle=0', () => {
    const m = Matrix3d.rotate(Math.PI / 4);
    // Now reuse `m` with angle=0; should overwrite to identity.
    Matrix3d.rotate(0, m);
    expect(m.ta).toBe(1);
    expect(m.tb).toBe(0);
    expect(m.tc).toBe(0);
    expect(m.td).toBe(1);
    expect(m.tx).toBe(0);
    expect(m.ty).toBe(0);
  });

  it('still produces a real rotation when angle != 0', () => {
    const m = Matrix3d.rotate(Math.PI / 2);
    // cos(pi/2) ~ 0, sin(pi/2) = 1
    expect(Math.abs(m.ta)).toBeLessThan(1e-10);
    expect(m.tb).toBeCloseTo(-1, 10);
    expect(m.tc).toBeCloseTo(1, 10);
    expect(Math.abs(m.td)).toBeLessThan(1e-10);
  });
});
