import { describe, it, expect } from 'vitest';
import { createIndexBuffer } from './RendererUtils.js';
import type { WebGlContextWrapper } from '../../../lib/WebGlContextWrapper.js';

// Capture the Uint16Array handed to elementArrayBufferData so we can assert on
// the generated quad indices without a real GL context.
function mockGlw(): {
  glw: WebGlContextWrapper;
  getIndices: () => Uint16Array;
} {
  let captured: Uint16Array | null = null;
  const glw = {
    STATIC_DRAW: 0,
    createBuffer: () => ({}),
    elementArrayBufferData: (_buffer: unknown, indices: Uint16Array) => {
      captured = indices;
    },
  } as unknown as WebGlContextWrapper;
  return {
    glw,
    getIndices: () => {
      if (captured === null) {
        throw new Error('elementArrayBufferData was not called');
      }
      return captured;
    },
  };
}

// The expected 6 element indices for quad `q`: two triangles over the quad's
// four vertices [4q, 4q+1, 4q+2, 4q+3] wound as [0,1,2, 2,1,3].
const expectedQuad = (q: number): number[] => {
  const j = q * 4;
  return [j, j + 1, j + 2, j + 2, j + 1, j + 3];
};

describe('createIndexBuffer', () => {
  it('fills indices for EVERY quad, not just the first 1/6', () => {
    // size / 80 = 800 quads, comfortably under the Uint16 cap.
    const { glw, getIndices } = mockGlw();
    createIndexBuffer(glw, 800 * 80);
    const indices = getIndices();
    const maxQuads = 800;

    expect(indices.length).toBe(maxQuads * 6);

    // First, middle and — critically — the LAST quad must be populated. The
    // original bug stopped the loop at `i < maxQuads`, zeroing every quad past
    // ~maxQuads/6 and collapsing it into a degenerate triangle.
    for (const q of [0, 1, maxQuads >> 1, maxQuads - 2, maxQuads - 1]) {
      const slice = Array.from(indices.subarray(q * 6, q * 6 + 6));
      expect(slice).toEqual(expectedQuad(q));
    }

    // No trailing zeroed slots (every quad past index 0 references vertices > 0).
    const lastQuad = Array.from(indices.subarray((maxQuads - 1) * 6));
    expect(lastQuad.some((v) => v !== 0)).toBe(true);
  });

  it('caps at 16384 quads so Uint16 vertex ids never overflow', () => {
    // Request far more than Uint16 can address (25000 quads worth of bytes).
    const { glw, getIndices } = mockGlw();
    createIndexBuffer(glw, 25000 * 80);
    const indices = getIndices();

    expect(indices.length).toBe(16384 * 6);
    // The very last vertex id is 16384*4 - 1 = 65535, the Uint16 maximum.
    expect(indices[indices.length - 1]).toBe(65535);
    expect(Array.from(indices.subarray(16383 * 6, 16383 * 6 + 6))).toEqual(
      expectedQuad(16383),
    );
  });
});
