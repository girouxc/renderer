import { describe, expect, it, vi } from 'vitest';
import { mock } from 'vitest-mock-extended';
import { CoreTextNode, type CoreTextNodeProps } from './CoreTextNode.js';
import { Stage } from './Stage.js';
import { CoreRenderer } from './renderers/CoreRenderer.js';
import { createBound } from './lib/utils.js';
import type {
  FontHandler,
  TextRenderer,
  TextRenderInfo,
} from './text-rendering/TextRenderer.js';
import type { Texture } from './textures/Texture.js';

const defaultProps = (
  overrides?: Partial<CoreTextNodeProps>,
): CoreTextNodeProps => ({
  // CoreNodeProps
  alpha: 1,
  autosize: false,
  boundsMargin: null,
  clipping: false,
  color: 0xffffffff,
  colorBl: 0xffffffff,
  colorBottom: 0xffffffff,
  colorBr: 0xffffffff,
  colorLeft: 0xffffffff,
  colorRight: 0xffffffff,
  colorTl: 0xffffffff,
  colorTop: 0xffffffff,
  colorTr: 0xffffffff,
  h: 0,
  mount: 0,
  mountX: 0,
  mountY: 0,
  parent: null,
  pivot: 0,
  pivotX: 0,
  pivotY: 0,
  rotation: 0,
  rtt: false,
  scale: 1,
  scaleX: 1,
  scaleY: 1,
  shader: null,
  src: '',
  texture: null,
  textureOptions: {} as never,
  w: 0,
  x: 0,
  y: 0,
  zIndex: 0,
  preventDestroy: false,
  // TrProps
  text: '',
  textAlign: 'left',
  fontFamily: 'Ubuntu',
  fontStyle: 'normal',
  fontSize: 100,
  maxWidth: 0,
  maxHeight: 0,
  offsetY: 0,
  letterSpacing: 0,
  lineHeight: 0,
  maxLines: 0,
  verticalAlign: 'top',
  overflowSuffix: '...',
  wordBreak: 'break-word',
  contain: 'none',
  // CoreTextNodeProps
  textRendererOverride: null,
  forceLoad: false,
  ...overrides,
});

const makeStage = (texture: Texture) =>
  mock<Stage>({
    strictBound: createBound(0, 0, 200, 200),
    preloadBound: createBound(0, 0, 200, 200),
    defaultTexture: { state: 'loaded' } as never,
    defShaderNode: null as never,
    renderer: mock<CoreRenderer>() as CoreRenderer,
    txManager: { createTexture: vi.fn(() => texture) } as never,
  });

const makeCanvasRenderer = (): TextRenderer => {
  const font = mock<FontHandler>({ type: 'canvas' });
  return {
    type: 'canvas',
    font,
    renderText: vi.fn(),
    addQuads: vi.fn(),
    renderQuads: vi.fn(),
    init: vi.fn(),
  } as unknown as TextRenderer;
};

const makeLoadedTexture = () =>
  ({
    state: 'loaded',
    dimensions: { w: 100, h: 50 },
    retryCount: 0,
    maxRetryCount: 0,
    on: vi.fn(),
    off: vi.fn(),
    once: vi.fn(),
    setRenderableOwner: vi.fn(),
  } as unknown as Texture);

describe('CoreTextNode (canvas) clearing text', () => {
  it('clears the stale texture when text becomes empty', () => {
    const renderer = makeCanvasRenderer();
    const texture = makeLoadedTexture();
    const stage = makeStage(texture);

    const node = new CoreTextNode(
      stage,
      defaultProps({ text: 'Hello' }),
      renderer,
    );

    // Simulate "Hello" having been rendered: canvas returns ImageData and a
    // texture is created/assigned.
    const helloResult: TextRenderInfo = {
      imageData: {} as ImageData,
      width: 100,
      height: 50,
    };
    (
      node as unknown as { handleRenderResult(r: TextRenderInfo): void }
    ).handleRenderResult(helloResult);

    expect(node.texture).toBe(texture);

    // Now set text to empty. The canvas renderer returns no imageData.
    const emptyResult: TextRenderInfo = { width: 0, height: 0 };
    (
      node as unknown as { handleRenderResult(r: TextRenderInfo): void }
    ).handleRenderResult(emptyResult);

    // The previously-rendered texture must be cleared so the old text does not
    // linger and get re-marked renderable by CoreNode.updateIsRenderable.
    expect(node.texture).toBe(null);
    expect(node.isRenderable).toBe(false);
  });
});
