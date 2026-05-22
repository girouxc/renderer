import type { Stage } from '../Stage.js';
import type {
  FontHandler,
  TextLineStruct,
  TextRenderInfo,
  TextRenderProps,
} from './TextRenderer.js';
import type { CoreTextNodeProps } from '../CoreTextNode.js';
import { hasZeroWidthSpace } from './Utils.js';
import * as SdfFontHandler from './SdfFontHandler.js';
import type { CoreRenderer } from '../renderers/CoreRenderer.js';
import { WebGlRenderer } from '../renderers/webgl/WebGlRenderer.js';
import { Sdf } from '../shaders/webgl/SdfShader.js';
import type { WebGlCtxTexture } from '../renderers/webgl/WebGlCtxTexture.js';
import type { WebGlShaderNode } from '../renderers/webgl/WebGlShaderNode.js';
import { isProductionEnvironment } from '../../utils.js';
import type { TextLayout, GlyphLayout } from './TextRenderer.js';
import { mapTextLayout } from './TextLayoutEngine.js';
import type { RectWithValid } from '../lib/utils.js';
import type { Dimensions } from '../../common/CommonTypes.js';

// Type definition to match interface
const type = 'sdf' as const;

let sdfShader: WebGlShaderNode | null = null;

// Initialize the SDF text renderer
const init = (stage: Stage): void => {
  SdfFontHandler.init();

  // Register SDF shader with the shader manager
  stage.shManager.registerShaderType('Sdf', Sdf);
  sdfShader = stage.shManager.createShader('Sdf') as WebGlShaderNode;
};

const font: FontHandler = SdfFontHandler;
const layoutCache = new Map<string, TextLayout>();

const getLayoutCacheKey = (props: CoreTextNodeProps): string =>
  `${props.fontFamily}-${props.fontStyle}-${props.fontSize}-${props.letterSpacing}-${props.lineHeight}-${props.maxHeight}-${props.maxWidth}-${props.maxLines}-${props.textAlign}-${props.wordBreak}-${props.overflowSuffix}-${props.text}`;

/**
 * SDF text renderer using MSDF/SDF fonts with WebGL
 *
 * @param stage - Stage instance for font resolution
 * @param props - Text rendering properties
 * @returns Object containing ImageData and dimensions
 */
const renderText = (props: CoreTextNodeProps): TextRenderInfo => {
  // Early return if no text
  if (props.text.length === 0) {
    return {
      width: 0,
      height: 0,
      trimmedHeight: 0,
    };
  }

  const cacheKey = getLayoutCacheKey(props);
  let layout = layoutCache.get(cacheKey);
  if (layout !== undefined) {
    return {
      remainingLines: 0,
      hasRemainingText: false,
      width: layout.width,
      height: layout.height,
      trimmedHeight: layout.trimmedHeight,
      layout,
    };
  }

  // Get font cache for this font family
  const fontData = SdfFontHandler.getFontData(props.fontFamily);
  if (fontData === undefined) {
    // Font not loaded, return empty result
    return {
      width: 0,
      height: 0,
      trimmedHeight: 0,
    };
  }

  // Calculate text layout and generate glyph data for caching
  layout = generateTextLayout(props, fontData);
  layoutCache.set(cacheKey, layout);

  // For SDF renderer, ImageData is null since we render via WebGL
  return {
    remainingLines: 0,
    hasRemainingText: false,
    width: layout.width,
    height: layout.height,
    trimmedHeight: layout.trimmedHeight,
    layout,
  };
};

/**
 * addQuads is a no-op for the batched SDF path.
 * Vertex data is now written directly into the shared SDF buffer
 * by `WebGlRenderer.addSdfQuads` during `renderQuads`.
 */
const addQuads = (_layout?: TextLayout): Float32Array | null => {
  return null;
};

/**
 * Submit SDF glyphs to the renderer's shared batched buffer.
 *
 * Two paths:
 * 1. **Cache hit** — layout, transform, color, and alpha haven't changed.
 *    The cached pre-transformed Float32Array is mem-copied directly into the
 *    shared SDF buffer (no per-glyph matrix math).
 * 2. **Cache miss** — re-computes per-glyph world-space vertices via
 *    `addSdfQuads`, then snapshots the result into the cache.
 */
const renderQuads = (
  renderer: CoreRenderer,
  layout: TextLayout,
  _vertexBuffer: Float32Array,
  renderProps: TextRenderProps,
): null => {
  const fontFamily = renderProps.fontFamily;

  const atlasTexture = SdfFontHandler.getAtlas(fontFamily);
  if (atlasTexture === null) {
    return null;
  }

  const webGlRenderer = renderer as WebGlRenderer;
  const cache = renderProps.sdfCache;
  const ctxTexture = atlasTexture.ctxTexture as WebGlCtxTexture;

  // --- Cache-hit fast path ------------------------------------------------
  if (cache !== undefined && cache.vertices !== null) {
    const ct = cache.transform;
    const t = renderProps.globalTransform;
    if (
      cache.layoutRef === layout &&
      cache.color === renderProps.color &&
      cache.alpha === renderProps.worldAlpha &&
      ct[0] === t[0] &&
      ct[1] === t[1] &&
      ct[2] === t[3] &&
      ct[3] === t[4] &&
      ct[4] === t[6] &&
      ct[5] === t[7]
    ) {
      webGlRenderer.addSdfCachedQuads(
        cache.vertices,
        cache.glyphCount,
        ctxTexture,
        renderProps.clippingRect,
        renderProps.worldAlpha,
        layout.width,
        layout.height,
        renderProps.parentHasRenderTexture,
        renderProps.framebufferDimensions,
        sdfShader!,
      );
      return null;
    }
  }

  // --- Cache-miss slow path -----------------------------------------------
  const startIdx = webGlRenderer.sdfBufferIdx;
  webGlRenderer.addSdfQuads(
    layout.glyphs,
    layout.fontScale,
    renderProps.globalTransform,
    renderProps.color,
    renderProps.worldAlpha,
    layout.distanceRange,
    ctxTexture,

    renderProps.clippingRect,
    layout.width,
    layout.height,
    renderProps.parentHasRenderTexture,
    renderProps.framebufferDimensions,
    sdfShader!,
  );

  // Snapshot the written vertex data into the cache for future frames
  if (cache !== undefined) {
    const endIdx = webGlRenderer.sdfBufferIdx;
    const len = endIdx - startIdx;
    if (len > 0) {
      if (cache.vertices === null || cache.vertices.length !== len) {
        cache.vertices = new Float32Array(len);
      }
      cache.vertices.set(webGlRenderer.fSdfBuffer.subarray(startIdx, endIdx));
      cache.glyphCount = layout.glyphs.length;
      cache.color = renderProps.color;
      cache.alpha = renderProps.worldAlpha;
      cache.layoutRef = layout;

      const t = renderProps.globalTransform;
      const ct = cache.transform;
      ct[0] = t[0]!;
      ct[1] = t[1]!;
      ct[2] = t[3]!;
      ct[3] = t[4]!;
      ct[4] = t[6]!;
      ct[5] = t[7]!;
    }
  }

  return null;
};

/**
 * Generate complete text layout with glyph positioning for caching
 */
const generateTextLayout = (
  props: CoreTextNodeProps,
  fontCache: SdfFontHandler.SdfFont,
): TextLayout => {
  const fontSize = props.fontSize;
  const fontFamily = props.fontFamily;
  const metrics = SdfFontHandler.getFontMetrics(fontFamily, fontSize);

  const fontData = fontCache.data;
  const commonFontData = fontData.common;
  const designFontSize = fontData.info.size;
  // common.base = distance from BMFont line-box top to the alphabetic baseline,
  // in atlas design units. Used to convert per-glyph yoffset (BMFont top -> glyph top)
  // into baseline-relative placement.
  const atlasBase = commonFontData.base;
  // When the user does not specify lineHeight, fall back to the engine's
  // 'normal' line height (ascender + lineGap - descender) computed inside
  // mapTextLayout via the supplied metrics. Passing 0 below triggers that path.
  const lineHeight = props.lineHeight;

  const atlasWidth = commonFontData.scaleW;
  const atlasHeight = commonFontData.scaleH;
  const invAtlasWidth = 1 / atlasWidth;
  const invAtlasHeight = 1 / atlasHeight;

  const glyphMap = fontCache.glyphMap;
  const kernings = fontCache.kernings;
  const fallbackGlyphId = isProductionEnvironment ? 32 : 63;

  // Calculate the pixel scale from design units to pixels
  const fontScale = fontSize / designFontSize;
  const letterSpacing = props.letterSpacing / fontScale;

  const maxWidth = props.maxWidth / fontScale;
  const maxHeight = props.maxHeight;
  const [
    lines,
    _remainingLines,
    _hasRemainingText,
    _bareLineHeight,
    lineHeightPx,
    effectiveWidth,
    effectiveHeight,
  ] = mapTextLayout(
    SdfFontHandler.measureText,
    metrics,
    props.text,
    props.textAlign,
    fontFamily,
    lineHeight,
    props.overflowSuffix,
    props.wordBreak,
    letterSpacing,
    props.maxLines,
    maxWidth,
    maxHeight,
  );

  const lineAmount = lines.length;

  const glyphs: GlyphLayout[] = [];
  let currentX = 0;
  let baselineY = 0;
  for (let i = 0; i < lineAmount; i++) {
    const line = lines[i] as TextLineStruct;
    const textLine = line[0];
    const textLineLength = textLine.length;
    let prevGlyphId = 0;
    currentX = line[3];
    // line[4] is the alphabetic baseline Y in screen px. Convert to atlas
    // design units (where glyph.yoffset and atlasBase live).
    baselineY = line[4] / fontScale;

    for (let j = 0; j < textLineLength; j++) {
      const codepoint = textLine.codePointAt(j) as number;
      if (codepoint > 0xffff) {
        j++;
      }

      if (codepoint === 0x200b) {
        continue;
      }

      const char = textLine[j] as string;
      if (hasZeroWidthSpace(char) === true) {
        continue;
      }

      // Get glyph data from font handler
      let glyph = glyphMap.get(codepoint);
      if (glyph === undefined) {
        glyph = glyphMap.get(fallbackGlyphId);
        if (glyph === undefined) {
          continue;
        }
      }

      // Kerning offsets the current glyph relative to the previous glyph.
      let kerning = 0;

      // Add kerning if there's a previous character
      if (prevGlyphId !== 0) {
        const seconds = kernings[glyph.id];
        if (seconds !== undefined) {
          const amount = seconds[prevGlyphId];
          if (amount !== undefined) {
            kerning = amount;
          }
        }
      }

      // Apply pair kerning before placing this glyph.
      currentX += kerning;

      // Glyph position in atlas design units. yoffset is measured from the
      // BMFont line-box top; subtracting atlasBase re-anchors it relative to
      // the alphabetic baseline so fonts with different BMFont 'base' values
      // share the same on-screen baseline.
      const glyphLayout: GlyphLayout = {
        x: currentX + glyph.xoffset,
        y: baselineY + glyph.yoffset - atlasBase,
        width: glyph.width,
        height: glyph.height,
        atlasX: glyph.x * invAtlasWidth,
        atlasY: glyph.y * invAtlasHeight,
        atlasWidth: glyph.width * invAtlasWidth,
        atlasHeight: glyph.height * invAtlasHeight,
      };

      glyphs.push(glyphLayout);

      // Advance position with letter spacing (in design units)
      currentX += glyph.xadvance + letterSpacing;
      prevGlyphId = glyph.id;
    }
  }

  // Cap-top of first line to descender bottom of last line.
  // descender is negative in NormalizedFontMetrics, so subtracting it
  // adds the descender depth. Zero when there are no rendered lines.
  const trimmedHeight =
    lineAmount > 0
      ? metrics.capHeight - metrics.descender + (lineAmount - 1) * lineHeightPx
      : 0;

  // Convert final dimensions to pixel space for the layout
  return {
    glyphs,
    distanceRange: fontScale * fontData.distanceField.distanceRange,
    width: effectiveWidth * fontScale,
    height: effectiveHeight,
    trimmedHeight,
    fontScale: fontScale,
    lineHeight: lineHeightPx,
    fontFamily,
  };
};

/**
 * SDF Text Renderer - implements TextRenderer interface
 */
const SdfTextRenderer = {
  type,
  font,
  renderText,
  addQuads,
  renderQuads,
  init,
};

export default SdfTextRenderer;
