import { describe, expect, it, vi } from 'vitest';
import { CanvasRenderer } from './CanvasRenderer.js';
import { TextureType } from '../../textures/Texture.js';

describe('CanvasRenderer.renderContext', () => {
  it('skips drawing when canvas texture image is undefined', () => {
    const drawImage = vi.fn();

    const renderer = Object.create(CanvasRenderer.prototype) as CanvasRenderer;
    (renderer as any).context = {
      drawImage,
      globalAlpha: 1,
    };

    const node = {
      premultipliedColorTl: 0xffffffff,
      globalTransform: { tx: 10, ty: 20 },
      props: { w: 100, h: 50 },
      worldAlpha: 1,
      textureCoords: { x1: 0, y1: 0, x2: 1, y2: 1 },
    } as any;

    const texture = {
      type: TextureType.image,
      ctxTexture: {
        getImage: () => undefined,
      },
    } as any;

    expect(() => renderer.renderContext(node, texture)).not.toThrow();
    expect(drawImage).not.toHaveBeenCalled();
    expect((renderer as any).context.globalAlpha).toBe(1);
  });
});

describe('CanvasRenderer.getCapabilities', () => {
  it('reports the canvas backend with no WebGL or VAO support', () => {
    const renderer = Object.create(CanvasRenderer.prototype) as CanvasRenderer;

    expect(renderer.getCapabilities()).toEqual({
      renderMode: 'canvas',
      webGlVersion: null,
      vertexArrayObject: false,
      maxTextureSize: 0,
      maxTextureUnits: 0,
    });
  });
});
