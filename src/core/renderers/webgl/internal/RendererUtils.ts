import type { WebGlContextWrapper } from '../../../lib/WebGlContextWrapper.js';

/**
 * Allocate big memory chunk that we
 * can re-use to draw quads
 *
 * @param glw
 * @param size
 */
export function createIndexBuffer(glw: WebGlContextWrapper, size: number) {
  const maxQuads = ~~(size / 80);
  const indices = new Uint16Array(maxQuads * 6);

  for (let i = 0, j = 0; i < maxQuads; i += 6, j += 4) {
    indices[i] = j;
    indices[i + 1] = j + 1;
    indices[i + 2] = j + 2;
    indices[i + 3] = j + 2;
    indices[i + 4] = j + 1;
    indices[i + 5] = j + 3;
  }

  const buffer = glw.createBuffer();
  glw.elementArrayBufferData(buffer, indices, glw.STATIC_DRAW);
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
