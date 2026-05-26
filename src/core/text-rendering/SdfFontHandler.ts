import type {
  FontFamilyMap,
  FontMetrics,
  NormalizedFontMetrics,
  TrProps,
  FontLoadOptions,
} from './TextRenderer.js';
import type { ImageTexture } from '../textures/ImageTexture.js';
import type { Stage } from '../Stage.js';
import type { CoreTextNode } from '../CoreTextNode.js';
import { UpdateType } from '../CoreNode.js';
import { hasZeroWidthSpace } from './Utils.js';
import { normalizeFontMetrics } from './TextLayoutEngine.js';
import { isProductionEnvironment } from '../../utils.js';

/**
 * SDF Font Data structure matching msdf-bmfont-xml output
 */
export interface SdfFontData {
  pages: string[];
  chars: Array<{
    id: number;
    char: string;
    x: number;
    y: number;
    width: number;
    height: number;
    xoffset: number;
    yoffset: number;
    xadvance: number;
    page: number;
    chnl: number;
  }>;

  kernings: Array<{
    first: number;
    second: number;
    amount: number;
  }>;
  info: {
    face: string;
    size: number;
    bold: number;
    italic: number;
    charset: string[];
    unicode: number;
    stretchH: number;
    smooth: number;
    aa: number;
    padding: [number, number, number, number]; // [up, right, down, left]
    spacing: [number, number]; // [horizontal, vertical]
    outline: number;
  };
  common: {
    lineHeight: number;
    base: number;
    scaleW: number;
    scaleH: number;
    pages: number;
    packed: number;
    alphaChnl: number;
    redChnl: number;
    greenChnl: number;
    blueChnl: number;
  };
  distanceField: {
    // msdf-bmfont-xml uses the string 'sdf' for single-channel SDF.
    fieldType: 'sdf' | 'msdf';
    distanceRange: number;
  };
  lightningMetrics?: FontMetrics;
}

/**
 * @typedef {Object} SdfGlyph
 * @property {number} id - Glyph ID
 * @property {string} char - Character
 * @property {number} x - Atlas x position
 * @property {number} y - Atlas y position
 * @property {number} width - Glyph width
 * @property {number} height - Glyph height
 * @property {number} xoffset - X offset
 * @property {number} yoffset - Y offset
 * @property {number} xadvance - Character advance width
 * @property {number} page - Page number
 * @property {number} chnl - Channel
 */

/**
 * @typedef {Object} KerningTable
 * Fast lookup table for kerning values
 */
type KerningTable = Record<
  number,
  Record<number, number | undefined> | undefined
>;

/**
 * @typedef {Object} SdfFontCache
 * Cached font data for performance
 */
export interface SdfFont {
  data: SdfFontData;
  glyphMap: Map<number, SdfFontData['chars'][0]>;
  kernings: KerningTable;
  atlasTexture: ImageTexture;
  metrics: FontMetrics;
  maxCharHeight: number;
}

//global state variables for SdfFontHandler
const fontCache = new Map<string, SdfFont>();
const fontLoadPromises = new Map<string, Promise<void>>();
const normalizedMetrics = new Map<string, NormalizedFontMetrics>();
const nodesWaitingForFont: Record<string, CoreTextNode[]> = Object.create(
  null,
) as Record<string, CoreTextNode[]>;
let initialized = false;

/**
 * Build kerning lookup table for fast access
 * @param {Array} kernings - Kerning data from font
 * @returns {KerningTable} Optimized kerning lookup table
 */
const buildKerningTable = (kernings: SdfFontData['kernings']): KerningTable => {
  const kerningTable: KerningTable = {};

  let i = 0;
  const length = kernings.length;

  while (i < length) {
    const kerning = kernings[i];
    i++;
    if (kerning === undefined) {
      continue;
    }
    const second = kerning.second;

    let firsts = kerningTable[second];
    if (firsts === undefined) {
      firsts = {};
      kerningTable[second] = firsts;
    }
    firsts[kerning.first] = kerning.amount;
  }

  return kerningTable;
};

/**
 * Build glyph map from font data for fast character lookup
 * @param {Array} chars - Character data from font
 * @returns {Map} Glyph map for character to glyph lookup
 */
const buildGlyphMap = (
  chars: SdfFontData['chars'],
): Map<number, SdfFontData['chars'][0]> => {
  const glyphMap = new Map<number, SdfFontData['chars'][0]>();
  let maxCharHeight = 0;

  let i = 0;
  const length = chars.length;

  while (i < length) {
    const glyph = chars[i];

    i++;
    if (glyph === undefined) {
      continue;
    }

    glyphMap.set(glyph.id, glyph);

    const charHeight = glyph.yoffset + glyph.height;
    if (charHeight > maxCharHeight) {
      maxCharHeight = charHeight;
    }
  }

  return glyphMap;
};

/**
 * Process font data and create optimized cache entry
 * @param {string} fontFamily - Font family name
 * @param {SdfFontData} fontData - Raw font data
 * @param {ImageTexture} atlasTexture - Atlas texture
 * @param {FontMetrics} metrics - Font metrics
 */
const processFontData = (
  fontFamily: string,
  fontData: SdfFontData,
  atlasTexture: ImageTexture,
  metrics?: FontMetrics,
): void => {
  // Build optimized data structures
  const glyphMap = buildGlyphMap(fontData.chars);
  const kernings = buildKerningTable(fontData.kernings);

  // Calculate max char height
  let maxCharHeight = 0;
  let i = 0;
  const length = fontData.chars.length;

  while (i < length) {
    const glyph = fontData.chars[i];
    if (glyph !== undefined) {
      const charHeight = glyph.yoffset + glyph.height;
      if (charHeight > maxCharHeight) {
        maxCharHeight = charHeight;
      }
    }
    i++;
  }

  if (metrics === undefined && fontData.lightningMetrics === undefined) {
    console.warn(
      `Font metrics not found for SDF font ${fontFamily}. ` +
        'Make sure you are using the latest version of the Lightning ' +
        '3 msdf-generator tool to generate your SDF fonts. Using default metrics.',
    );
  }

  metrics = metrics ||
    fontData.lightningMetrics || {
      ascender: 800,
      descender: -200,
      lineGap: 200,
      unitsPerEm: 1000,
    };

  // Derive cap-height from the atlas when the metrics block doesn't already
  // supply it. The layout engine uses this value to vertically center
  // capital letters on each line. BMFont stores per-glyph `yoffset` as the
  // distance from the line-box top to the glyph's top, and `common.base` as
  // the distance from the line-box top to the alphabetic baseline — so the
  // distance from the baseline up to the top of 'H' (atlas design px) is
  // `common.base - H.yoffset`. Converted into font units it slots into
  // `FontMetrics.capHeight` alongside the existing ascender / descender
  // values and flows through `normalizeFontMetrics`.
  if (metrics.capHeight === undefined) {
    const capGlyph = glyphMap.get(72); // 'H'
    if (capGlyph !== undefined) {
      const capHeightAtlasPx = fontData.common.base - capGlyph.yoffset;
      metrics = {
        ...metrics,
        capHeight: (capHeightAtlasPx / fontData.info.size) * metrics.unitsPerEm,
      };
    }
    // If 'H' isn't in the atlas (icon-only fonts, etc.) we leave capHeight
    // undefined and rely on the 0.7 × ascender fallback inside
    // normalizeFontMetrics.
  }

  // Same derivation for x-height using glyph 'x' (id 120). Consumed by
  // both `textBaselineMode === 'x'` and `'optical'` (which uses the mean
  // of cap-height and x-height); the 0.5 × ascender fallback inside
  // `normalizeFontMetrics` covers fonts that ship without an 'x' glyph.
  if (metrics.xHeight === undefined) {
    const xGlyph = glyphMap.get(120); // 'x'
    if (xGlyph !== undefined) {
      const xHeightAtlasPx = fontData.common.base - xGlyph.yoffset;
      metrics = {
        ...metrics,
        xHeight: (xHeightAtlasPx / fontData.info.size) * metrics.unitsPerEm,
      };
    }
  }

  // Cache processed data
  fontCache.set(fontFamily, {
    data: fontData,
    glyphMap,
    kernings,
    atlasTexture,
    metrics,
    maxCharHeight,
  });
};

/**
 * Check if the SDF font handler can render a font
 * @param {TrProps} trProps - Text rendering properties
 * @returns {boolean} True if the font can be rendered
 */
export const canRenderFont = (trProps: TrProps): boolean => {
  return (
    isFontLoaded(trProps.fontFamily) || fontLoadPromises.has(trProps.fontFamily)
  );
};

/**
 * Load SDF font from JSON + PNG atlas
 * @param {Object} options - Font loading options
 * @param {string} options.fontFamily - Font family name
 * @param {string} options.fontUrl - JSON font data URL (atlasDataUrl)
 * @param {string} options.atlasUrl - PNG atlas texture URL
 * @param {FontMetrics} options.metrics - Optional font metrics
 */
export const loadFont = (
  stage: Stage,
  options: FontLoadOptions,
): Promise<void> => {
  const { fontFamily, atlasUrl, atlasDataUrl, metrics } = options;
  // Early return if already loaded
  if (fontCache.get(fontFamily) !== undefined) {
    return Promise.resolve();
  }

  // Early return if already loading
  const existingPromise = fontLoadPromises.get(fontFamily);
  if (existingPromise !== undefined) {
    return existingPromise;
  }

  if (atlasDataUrl === undefined) {
    return Promise.reject(
      new Error(`Atlas data URL must be provided for SDF font: ${fontFamily}`),
    );
  }

  const nwff: CoreTextNode[] = (nodesWaitingForFont[fontFamily] = []);
  // Create loading promise
  const loadPromise = (async (): Promise<void> => {
    const fontData = await new Promise<SdfFontData>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('GET', atlasDataUrl, true);
      xhr.responseType = 'json';
      xhr.onload = () => {
        if ((xhr.status >= 200 && xhr.status < 300) || xhr.status === 0) {
          let data = xhr.response;
          if (typeof data === 'string') {
            try {
              data = JSON.parse(data);
            } catch (e) {
              reject(new Error('Failed to parse font data JSON'));
              return;
            }
          }
          resolve(data as SdfFontData);
        } else {
          reject(new Error(`Failed to load font data: ${xhr.statusText}`));
        }
      };
      xhr.onerror = () => {
        reject(
          new Error(
            'Network error occurred while trying to load the font data.',
          ),
        );
      };
      xhr.send(null);
    });
    if (!fontData || !fontData.chars) {
      throw new Error('Invalid SDF font data format');
    }

    // Atlas texture should be provided externally
    if (!atlasUrl) {
      throw new Error('Atlas texture must be provided for SDF fonts');
    }

    // Wait for atlas texture to load
    return new Promise<void>((resolve, reject) => {
      // create new atlas texture using ImageTexture
      const atlasTexture = stage.txManager.createTexture('ImageTexture', {
        src: atlasUrl,
        premultiplyAlpha: false,
      });

      atlasTexture.setRenderableOwner(fontFamily, true);
      atlasTexture.preventCleanup = true; // Prevent automatic cleanup

      if (atlasTexture.state === 'loaded') {
        // If already loaded, process immediately
        processFontData(fontFamily, fontData, atlasTexture, metrics);
        fontLoadPromises.delete(fontFamily);

        for (let key in nwff) {
          nwff[key]!.setUpdateType(UpdateType.Local);
        }
        delete nodesWaitingForFont[fontFamily];
        return resolve();
      }

      atlasTexture.on('loaded', () => {
        // Process and cache font data
        processFontData(fontFamily, fontData, atlasTexture, metrics);

        // remove from promises
        fontLoadPromises.delete(fontFamily);

        for (let key in nwff) {
          nwff[key]!.setUpdateType(UpdateType.Local);
        }
        delete nodesWaitingForFont[fontFamily];
        resolve();
      });

      atlasTexture.on('failed', (error: Error) => {
        // Cleanup on error
        fontLoadPromises.delete(fontFamily);
        if (fontCache[fontFamily]) {
          delete fontCache[fontFamily];
        }
        console.error(`Failed to load SDF font: ${fontFamily}`, error);
        reject(error);
      });
    });
  })();

  fontLoadPromises.set(fontFamily, loadPromise);
  return loadPromise;
};

/**
 * Stop waiting for a font to load
 * @param {string} fontFamily - Font family name
 * @param {CoreTextNode} node - Node that was waiting for the font
 */
export const waitingForFont = (fontFamily: string, node: CoreTextNode) => {
  if (nodesWaitingForFont[fontFamily] === undefined) {
    return;
  }
  nodesWaitingForFont[fontFamily]![node.id] = node;
};

/**
 * Stop waiting for a font to load
 *
 * @param fontFamily
 * @param node
 * @returns
 */
export const stopWaitingForFont = (fontFamily: string, node: CoreTextNode) => {
  if (nodesWaitingForFont[fontFamily] === undefined) {
    return;
  }
  delete nodesWaitingForFont[fontFamily][node.id];
};

/**
 * Get the font families map for resolving fonts
 */
export const getFontFamilies = (): FontFamilyMap => {
  const families: FontFamilyMap = {};

  // SDF fonts don't use the traditional FontFamilyMap structure
  // Return empty map since SDF fonts are handled differently
  return families;
};

/**
 * Initialize the SDF font handler
 */
export const init = (
  c?: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
): void => {
  if (initialized === true) {
    return;
  }

  initialized = true;
};

export const type = 'sdf';

/**
 * Check if a font is already loaded by font family
 */
export const isFontLoaded = (fontFamily: string): boolean => {
  return fontCache.has(fontFamily);
};

/**
 * Get normalized font metrics for a font family
 */
export const getFontMetrics = (
  fontFamily: string,
  fontSize: number,
): NormalizedFontMetrics => {
  const label = fontFamily + '_' + fontSize;
  const metricsCache = normalizedMetrics.get(label);

  if (metricsCache !== undefined) {
    return metricsCache;
  }
  let metrics = fontCache.get(fontFamily)!.metrics;
  return processFontMetrics(fontFamily, fontSize, metrics);
};

export const processFontMetrics = (
  fontFamily: string,
  fontSize: number,
  metrics: FontMetrics,
): NormalizedFontMetrics => {
  const label = fontFamily + '_' + fontSize;
  const normalized = normalizeFontMetrics(metrics, fontSize);
  normalizedMetrics.set(label, normalized);
  return normalized;
};

/**
 * Get atlas texture for a font family
 * @param {string} fontFamily - Font family name
 * @returns {ImageTexture|null} Atlas texture or null
 */
export const getAtlas = (fontFamily: string): ImageTexture | null => {
  const cache = fontCache.get(fontFamily);
  return cache !== undefined ? cache.atlasTexture : null;
};

/**
 * Get font data for a font family
 * @param {string} fontFamily - Font family name
 * @returns {SdfFontData|null} Font data or null
 */
export const getFontData = (fontFamily: string): SdfFont | undefined => {
  return fontCache.get(fontFamily);
};

/**
 * Get maximum character height for a font family
 * @param {string} fontFamily - Font family name
 * @returns {number} Max character height or 0
 */
export const getMaxCharHeight = (fontFamily: string): number => {
  const cache = fontCache.get(fontFamily);
  return cache !== undefined ? cache.maxCharHeight : 0;
};

/**
 * Get all loaded font families
 * @returns {string[]} Array of font family names
 */
export const getLoadedFonts = (): string[] => {
  return Array.from(fontCache.keys());
};

/**
 * Unload a font and free resources
 * @param {string} fontFamily - Font family name
 */
export const unloadFont = (fontFamily: string): void => {
  const cache = fontCache.get(fontFamily);
  if (cache !== undefined) {
    // Free texture if needed
    if (typeof cache.atlasTexture.free === 'function') {
      cache.atlasTexture.free();
    }

    fontCache.delete(fontFamily);
  }
};

export const measureText = (
  text: string,
  fontFamily: string,
  letterSpacing: number,
): number => {
  const cache = fontCache.get(fontFamily);
  if (cache === undefined) return 0;

  const glyphMap = cache.glyphMap;
  const kernings = cache.kernings;
  const fallbackGlyphId = isProductionEnvironment ? 32 : 63;
  const textLength = text.length;

  if (textLength === 1) {
    const codepoint = text.codePointAt(0) as number;
    if (codepoint === 0x200b) return 0;
    const char = text[0] as string;
    if (hasZeroWidthSpace(char) === true) return 0;

    let glyph = glyphMap.get(codepoint);
    if (glyph === undefined) {
      glyph = glyphMap.get(fallbackGlyphId);
      if (glyph === undefined) return 0;
    }
    return glyph.xadvance + letterSpacing;
  }

  let width = 0;
  let prevGlyphId = 0;
  for (let i = 0; i < textLength; i++) {
    const codepoint = text.codePointAt(i) as number;
    if (codepoint > 0xffff) {
      i++;
    }

    if (codepoint === 0x200b) {
      continue;
    }

    const char = text[i] as string;
    // Skip zero-width spaces in width calculations
    if (hasZeroWidthSpace(char) === true) {
      continue;
    }

    let glyph = glyphMap.get(codepoint);
    if (glyph === undefined) {
      glyph = glyphMap.get(fallbackGlyphId);
      if (glyph === undefined) {
        continue;
      }
    }

    let advance = glyph.xadvance;

    // Add kerning if there's a previous character
    if (prevGlyphId !== 0) {
      const seconds = kernings[glyph.id];
      if (seconds !== undefined) {
        const amount = seconds[prevGlyphId];
        if (amount !== undefined) {
          advance += amount;
        }
      }
    }

    width += advance + letterSpacing;
    prevGlyphId = glyph.id;
  }

  return width;
};
