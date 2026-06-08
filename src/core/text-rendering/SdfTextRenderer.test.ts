import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { CoreTextNodeProps } from '../CoreTextNode.js';

// Mock the font handler so renderText/generateTextLayout can run without a
// real loaded font. getFontData is only invoked on a layout-cache MISS, so the
// call count is our probe for cache hits vs misses.
vi.mock('./SdfFontHandler.js', () => {
  const fontData = {
    data: {
      common: { base: 0, scaleW: 512, scaleH: 512, lineHeight: 50 },
      info: { size: 42 },
      distanceField: { distanceRange: 4 },
    },
    glyphMap: new Map(),
    kernings: {},
    atlasTexture: {},
    metrics: {},
    maxCharHeight: 50,
  };
  const metrics = {
    ascender: 40,
    descender: -10,
    lineGap: 0,
    capHeight: 30,
    xHeight: 20,
  };
  return {
    type: 'sdf',
    init: vi.fn(),
    getFontData: vi.fn(() => fontData),
    getFontMetrics: vi.fn(() => metrics),
    measureText: vi.fn((text: string) => text.length * 10),
    getAtlas: vi.fn(() => null),
  };
});

import SdfTextRenderer from './SdfTextRenderer.js';
import * as SdfFontHandler from './SdfFontHandler.js';

const makeProps = (text: string): CoreTextNodeProps =>
  ({
    text,
    fontFamily: 'Test',
    fontStyle: 'normal',
    fontSize: 42,
    letterSpacing: 0,
    lineHeight: 0,
    maxHeight: 0,
    maxWidth: 100000,
    maxLines: 0,
    textAlign: 'left',
    wordBreak: 'normal',
    overflowSuffix: '',
  } as unknown as CoreTextNodeProps);

const initRenderer = (cacheSize: number): void => {
  const fakeStage = {
    options: { textLayoutCacheSize: cacheSize },
    shManager: {
      registerShaderType: vi.fn(),
      createShader: vi.fn(() => ({})),
    },
  };
  SdfTextRenderer.init(fakeStage as never);
};

const render = (text: string): void => {
  SdfTextRenderer.renderText(makeProps(text));
};

describe('SdfTextRenderer layout cache', () => {
  beforeEach(() => {
    // Empty the module-level cache between tests, then reset call counts.
    initRenderer(0);
    SdfTextRenderer.cleanup();
    vi.clearAllMocks();
  });

  it('reuses the cached layout for identical strings', () => {
    initRenderer(10);

    render('Badge');
    render('Badge');

    // Second render is a cache hit: no fresh layout generation.
    expect(SdfFontHandler.getFontData).toHaveBeenCalledTimes(1);
  });

  it('caches long strings too (no length-based skip)', () => {
    initRenderer(10);
    const long = 'x'.repeat(500);

    render(long);
    render(long);

    // Bounded purely by the LRU cap, not by length.
    expect(SdfFontHandler.getFontData).toHaveBeenCalledTimes(1);
  });

  it('eagerly bounds the cache on insert (does not wait for idle cleanup)', () => {
    // An animating scene never goes idle, so the cache must be bounded on insert
    // rather than relying solely on idle `cleanup`. With cap 2, inserting a 3rd
    // entry must immediately evict the least-recently-used (oldest) one — 'A'.
    initRenderer(2);

    render('A'); // {A}
    render('B'); // {A, B}
    render('C'); // insert -> over cap -> eagerly evict LRU 'A' -> {B, C}

    vi.clearAllMocks();
    // Probe survivors first (hits only re-order, they don't change membership),
    // then the evicted entry last so its re-insert can't perturb the assertion.
    render('C'); // survived -> hit
    render('B'); // survived -> hit
    render('A'); // evicted -> miss (one layout regen)

    expect(SdfFontHandler.getFontData).toHaveBeenCalledTimes(1);
  });

  it('cleanup is a no-op while under the cap', () => {
    initRenderer(10);

    render('one');
    render('two');

    SdfTextRenderer.cleanup();

    vi.clearAllMocks();
    render('one'); // still cached -> hit
    render('two'); // still cached -> hit

    expect(SdfFontHandler.getFontData).toHaveBeenCalledTimes(0);
  });
});

describe('SdfTextRenderer lazy shader compile', () => {
  it('registers the SDF shader at init but defers compilation', () => {
    const shManager = {
      registerShaderType: vi.fn(),
      createShader: vi.fn(() => ({})),
    };
    const fakeStage = { options: { textLayoutCacheSize: 10 }, shManager };

    SdfTextRenderer.init(fakeStage as never);

    // Registration is cheap and stays at boot; the expensive compile + link is
    // deferred until the first SDF glyph actually renders (see getSdfShader).
    expect(shManager.registerShaderType).toHaveBeenCalledTimes(1);
    expect(shManager.createShader).not.toHaveBeenCalled();
  });
});
