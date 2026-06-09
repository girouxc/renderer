import type { WebGlContextWrapper } from '../../../lib/WebGlContextWrapper.js';

/**
 * Allocate big memory chunk that we
 * can re-use to draw quads
 *
 * @param glw
 * @param size
 */
export function createIndexBuffer(
  glw: WebGlContextWrapper,
  size: number,
): WebGLBuffer | null {
  // 4 vertices per quad. Element indices are Uint16, so the largest vertex id
  // we can address is 65535 — i.e. 16384 quads (16384 * 4 = 65536). Never claim
  // more than that, regardless of the requested byte budget.
  const maxQuads = Math.min(~~(size / 80), 16384);
  const indices = new Uint16Array(maxQuads * 6);

  // i walks the index slot (6 per quad), j the vertex base (4 per quad). The
  // bound must be maxQuads * 6 to fill every slot — stopping at maxQuads left
  // ~5/6 of the buffer zeroed, collapsing every quad past ~maxQuads/6 into a
  // degenerate triangle (the cause of tail geometry silently disappearing).
  for (let i = 0, j = 0; i < maxQuads * 6; i += 6, j += 4) {
    indices[i] = j;
    indices[i + 1] = j + 1;
    indices[i + 2] = j + 2;
    indices[i + 3] = j + 2;
    indices[i + 4] = j + 1;
    indices[i + 5] = j + 3;
  }

  const buffer = glw.createBuffer();
  glw.elementArrayBufferData(buffer, indices, glw.STATIC_DRAW);
  return buffer;
}

/**
 * Checks if an object is of type HTMLImageElement.
 * This is used because we cant check for HTMLImageElement directly when the
 * renderer is running in a seperate web worker context.
 *
 * @param obj
 * @returns
 */
export function isHTMLImageElement(obj: unknown): obj is HTMLImageElement {
  return (
    obj !== null &&
    ((typeof obj === 'object' &&
      obj.constructor &&
      obj.constructor.name === 'HTMLImageElement') ||
      (typeof HTMLImageElement !== 'undefined' &&
        obj instanceof HTMLImageElement))
  );
}

export interface WebGlColor {
  raw: number;
  normalized: [number, number, number, number];
}
