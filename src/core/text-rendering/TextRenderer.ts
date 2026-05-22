import type { Dimensions } from '../../common/CommonTypes.js';
import type { CoreTextNodeProps } from '../CoreTextNode.js';
import type { RectWithValid } from '../lib/utils.js';
import type { CoreRenderer } from '../renderers/CoreRenderer.js';
import type { SdfRenderOp } from '../renderers/webgl/SdfRenderOp.js';
import type { Stage } from '../Stage.js';

// Text baseline and vertical align types
export type TextBaseline =
  | 'alphabetic'
  | 'hanging'
  | 'middle'
  | 'ideographic'
  | 'bottom';
export type TextVerticalAlign = 'top' | 'middle' | 'bottom';
export type TextRenderers = 'canvas' | 'sdf';

/**
 * Selects which font-derived height the text layout engine centers on each
 * line's geometric mid-line. Configured via {@link RendererMainSettings} and
 * cannot be overridden per node — see the engine-wide reasoning in
 * `TextLayoutEngine.mapTextLayout`.
 *
 * - `'cap'` (default): capital letters centered. Best for UI text — button
 *   labels, headings, badges. Capitals and digits bracket the center
 *   symmetrically; descenders hang slightly below, matching CSS button
 *   behavior in browsers.
 * - `'x'`: lowercase x-height centered. Better for running body text;
 *   capitals appear slightly high in headings.
 * - `'linebox'`: legacy. Centers the abstract asc-to-desc-plus-leading
 *   rectangle. Mathematically tidy but visually unbalanced because most
 *   Latin fonts have asymmetric asc/desc ratios.
 */
export type TextBaselineMode = 'cap' | 'x' | 'linebox';
/**
 * Structure mapping font family names to a set of font faces.
 */
export interface FontFamilyMap {
  [familyName: string]: FontFace;
}

/**
 * Font metrics used for layout and default line height calculations.
 */
export interface FontMetrics {
  /**
   * The distance, in font units, from the baseline to the highest point of the font.
   */
  ascender: number;
  /**
   * The distance, in font units, from the baseline to the lowest point of the font.
   */
  descender: number;
  /**
   * The additional space used in the calculation of the default line height in font units.
   */
  lineGap: number;
  /**
   * The number of font units per 1 EM.
   */
  unitsPerEm: number;
  /**
   * The distance, in font units, from the baseline to the top of an uppercase
   * letter (OS/2 sCapHeight).
   *
   * Used by the layout engine to vertically center capital letters on each
   * line's geometric mid-line. When absent, the SDF backend derives this
   * value from glyph `H` (id 72) in the BMFont atlas; the Canvas backend
   * falls back to `0.7 × ascender` (a generic Latin-font approximation).
   */
  capHeight?: number;
  /**
   * The distance, in font units, from the baseline to the top of a lowercase
   * letter (OS/2 sxHeight). Optional; used only when the baseline-anchor
   * mode is set to x-height centering (experimental).
   */
  xHeight?: number;
}

/**
 * Normalized font metrics where values are expressed in pixels at the
 * configured font size (em-px).
 */
export interface NormalizedFontMetrics {
  /**
   * The distance, in em-px, from the baseline to the highest point of the font.
   */
  ascender: number;
  /**
   * The distance, in em-px, from the baseline to the lowest point of the font.
   */
  descender: number;
  /**
   * The additional space used in the calculation of the default line height, in em-px.
   */
  lineGap: number;
  /**
   * The distance, in em-px, from the baseline to the top of an uppercase letter.
   * Always populated; derived or approximated when {@link FontMetrics.capHeight}
   * is not provided by the caller.
   */
  capHeight: number;
  /**
   * The distance, in em-px, from the baseline to the top of a lowercase letter.
   * Always populated; derived from glyph `x` for SDF, falls back to
   * `0.5 × ascender` otherwise. Only used by the experimental x-height
   * baseline-anchor mode.
   */
  xHeight: number;
}

/**
 * Text renderer properties that are used in resolving appropriate font faces
 *
 * @remarks
 * Extended by {@link TrProps}
 */
export interface TrFontProps {
  /**
   * Font Family
   *
   * @internalRemarks
   * `fontFamily` is defined currently as single string, but in the future we may want to
   * support multiple font family fallbacks, as this is supported by CSS / Canvas2d. We can
   * do this in a backwards compatible way by unioning an array of strings to the
   * `fontFamily` property.
   */
  fontFamily: string;
  /**
   * Font Style
   *
   * @remarks
   * The font style to use when looking up the font face. This can be one of the
   * following strings:
   * - `'normal'`
   * - `'italic'`
   * - `'oblique'`
   */
  fontStyle: 'normal' | 'italic' | 'oblique';
  /**
   * Font Size
   *
   * @remarks
   * The font size to use when looking up the font face.
   *
   * The font size is specified in pixels and is the height of the font's
   * em-square. The em-square is essentially the height of the capital letters
   * for the font. The actual height of the text can be larger than the
   * specified font size, as the font may have ascenders and descenders that
   * extend beyond the em-square.
   *
   * @default 16
   */
  fontSize: number;
}

export interface TrProps extends TrFontProps {
  /**
   * Text to display
   *
   * @default ''
   */
  text: string;
  /**
   * Text alignment
   *
   * @remarks
   * Alignment of the text relative to it's contained bounds. For best results,
   * use {@link contain} mode `'width'` or `'both'` and a set an explicit
   * {@link width} for the text to be aligned within.
   *
   * @default 'left'
   */
  textAlign: 'left' | 'center' | 'right';
  /**
   * Color of text
   *
   * @remarks
   * The color value is a number in the format 0xRRGGBBAA, where RR is the red
   * component, GG is the green component, BB is the blue component, and AA is
   * the alpha component.
   *
   * @default 0xffffffff (opaque white)
   */
  color: number;
  x: number;
  y: number;

  maxWidth: number;
  maxHeight: number;
  /**
   * Vertical offset for text
   *
   * @remarks
   * The vertical offset of the text.
   *
   * @default 0
   */
  offsetY: number;
  /**
   * Letter spacing for text (in pixels)
   *
   * @remarks
   * This property sets additional (or reduced, if value is negative) spacing
   * between characters in the text.
   *
   * @default 0
   */
  letterSpacing: number;
  /**
   * Line height for text (in pixels)
   *
   * @remarks
   * This property sets the height of each line. If set to `undefined`, the
   * line height will be calculated based on the font and font size to be the
   * minimal height required to completely contain a line of text.
   *
   * See: https://github.com/lightning-js/renderer/issues/170
   *
   * @default `undefined`
   */
  lineHeight: number;
  /**
   * Max lines for text
   *
   * @remarks
   * This property sets max number of lines of a text paragraph.
   * Not yet implemented in the SDF renderer.
   *
   * @default 0
   */
  maxLines: number;
  /**
   * Vertical alignment of the text block within its containing box.
   *
   * @remarks
   * The containing box is `maxHeight` if set, otherwise the node's
   * own `h` (which a flex parent or the user may have grown beyond
   * the intrinsic text height). Activates whenever the box is taller
   * than the intrinsic text height. Composes with `textBaselineMode`
   * (per-line anchor). CSS line-box semantics — `'top'` leaves
   * half-leading above the first line's cap-top; `'bottom'` leaves
   * half-leading below the last line's descender.
   *
   * @default top
   */
  verticalAlign: TextVerticalAlign;
  /**
   * Overflow Suffix for text
   *
   * @remarks
   * The suffix to be added when text is cropped due to overflow.
   * Not yet implemented in the SDF renderer.
   *
   * @default "..."
   */
  overflowSuffix: string;

  /**
   * Word Break for text
   *
   * @remarks
   * This property sets how words should break when reaching the end of a line.
   *
   * - `'overflow'`: Uses the Css/HTML normal word-break behavior, generally not used in app development.
   * - `'break-all'`: To prevent overflow, word breaks should happen between any two characters.
   * - `'break-word'`: To prevent overflow, word breaks should happen between words. If words are too long word breaks happen between any two characters.
   *
   * @default "break-word"
   */
  wordBreak: 'overflow' | 'break-all' | 'break-word';

  /**
   * contain mode for text
   *
   * @remarks
   *
   * This property sets how the text should be contained within its bounding box.
   *
   * - 'width': The text is contained within the specified maxWidth, horizontal position of text will adjust according to {@link textAlign}.
   * - 'height': The text is contained within the specified maxHeight, vertical position of text will adjust according to {@link verticalAlign}.
   * - 'both': The text is contained within both the specified maxWidth and maxHeight.
   * - 'none': The text is not contained within any bounding box.
   *
   * @default 'none'
   */
  contain: 'width' | 'height' | 'both' | 'none';
}

/**
 * Glyph layout information for WebGL rendering
 */
export interface GlyphLayout {
  x: number;
  y: number;
  width: number;
  height: number;
  atlasX: number;
  atlasY: number;
  atlasWidth: number;
  atlasHeight: number;
}

/**
 * Complete text layout information for caching
 */
export interface TextLayout {
  /**
   * Individual glyph layouts
   */
  glyphs: GlyphLayout[];
  /**
   * Total text width
   */
  width: number;
  /**
   * Total text height
   */
  height: number;
  /**
   * Trimmed text height — cap-top of the first line to descender bottom
   * of the last line. See `TextRenderInfo.trimmedHeight`.
   */
  trimmedHeight: number;
  /**
   * Font scale factor
   */
  fontScale: number;
  /**
   * Line height
   */
  lineHeight: number;
  /**
   * Font family used
   */
  fontFamily: string;
  /**
   * distanceRange used
   */
  distanceRange: number;
}

export interface FontLoadOptions {
  fontFamily: string;
  metrics?: FontMetrics;
  // For Canvas/traditional font loading
  fontUrl?: string;
  // For SDF/atlas-based font loading
  atlasUrl?: string;
  atlasDataUrl?: string;
}

/**
 * Measure Width of Text function to be defined in font handlers, used in TextLayoutEngine
 */
export type MeasureTextFn = (
  text: string,
  fontFamily: string,
  letterSpacing: number,
) => number;

export interface FontHandler {
  init: (
    c: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  ) => void;
  type: 'canvas' | 'sdf';
  isFontLoaded: (fontFamily: string) => boolean;
  loadFont: (stage: Stage, options: FontLoadOptions) => Promise<void>;
  waitingForFont: (fontFamily: string, CoreTextNode) => void;
  stopWaitingForFont: (fontFamily: string, CoreTextNode) => void;
  getFontFamilies: () => FontFamilyMap;
  canRenderFont: (trProps: TrProps) => boolean;
  getFontMetrics: (
    fontFamily: string,
    fontSize: number,
  ) => NormalizedFontMetrics;
  measureText: MeasureTextFn;
}

/**
 * Cached SDF vertex data for a single text node.
 * When nothing changes (layout, transform, color, alpha), the pre-transformed
 * vertex Float32Array can be mem-copied into the shared SDF buffer instead of
 * re-computing per-glyph matrix transforms each frame.
 */
export interface SdfVertexCache {
  /** Pre-transformed vertex Float32Array (null = cache miss). */
  vertices: Float32Array | null;
  /** Number of glyphs in the cached data. */
  glyphCount: number;
  /** RGBA color at the time the cache was built. */
  color: number;
  /** worldAlpha at the time the cache was built. */
  alpha: number;
  /** The 6 relevant transform matrix components [m0,m1,m3,m4,m6,m7]. */
  transform: Float32Array;
  /** Reference to the TextLayout the cache was built from. */
  layoutRef: TextLayout | null;
}

export interface TextRenderProps {
  fontFamily: string;
  fontSize: number;
  color: number;
  offsetY: number;
  worldAlpha: number;
  globalTransform: Float32Array;
  clippingRect: RectWithValid;
  width: number;
  height: number;
  parentHasRenderTexture: boolean;
  framebufferDimensions: Dimensions | null;
  stage: Stage;
  /** Optional SDF vertex cache — passed by CoreTextNode for cache-hit fast path. */
  sdfCache?: SdfVertexCache;
}

export interface TextRenderInfo {
  width: number;
  height: number;
  /**
   * Height of the visible glyph extent — from the first line's cap-top to
   * the last line's descender bottom. Excludes half-leading and the slack
   * between the font's ascender and cap-top.
   *
   * @remarks
   * Formula: `capHeight − descender + (lines − 1) × lineHeightPx`
   * (descender is negative in font metrics, so subtracting it adds the
   * descender depth). For empty text, this is 0.
   *
   * Use this when you want flex `alignItems: 'center'` (or any layout
   * that aligns by node `h`) to optically center the visible glyphs.
   * Set `node.h = node.trimmedHeight` after the `loaded` event.
   */
  trimmedHeight: number;
  hasRemainingText?: boolean;
  remainingLines?: number;
  imageData?: ImageData | null; // Image data for Canvas Text Renderer
  layout?: TextLayout; // Layout data for SDF renderer caching
}

export interface TextRenderer {
  type: 'canvas' | 'sdf';
  font: FontHandler;
  renderText: (props: CoreTextNodeProps) => TextRenderInfo;
  // Updated to accept layout data and return vertex buffer for performance
  addQuads: (layout?: TextLayout) => Float32Array | null;
  renderQuads: (
    renderer: CoreRenderer,
    layout: TextLayout,
    vertexBuffer: Float32Array,
    renderProps: TextRenderProps,
  ) => void | SdfRenderOp | null;
  init: (stage: Stage) => void;
}

/**
 * Text line struct for text mapping
 * 0 - text
 * 1 - width
 * 2 - truncated
 * 3 - line offset x
 * 4 - line offset y
 */
export type TextLineStruct = [string, number, boolean, number, number];

/**
 * Wrapped lines struct for text mapping
 * 0 - line structs
 * 1 - remaining lines
 * 2 - remaining text
 */
export type WrappedLinesStruct = [TextLineStruct[], number, boolean];

/**
 * Wrapped lines struct for text mapping
 * 0 - line structs
 * 1 - remaining lines
 * 2 - remaining text
 * 3 - bare line height
 * 4 - line height pixels
 * 5 - effective width
 * 6 - effective height
 */
export type TextLayoutStruct = [
  TextLineStruct[],
  number,
  boolean,
  number,
  number,
  number,
  number,
];
