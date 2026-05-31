import {
  createWebGLContext,
  USE_RTT,
  RENDER_TEXT_BATCHING,
  DIRTY_QUAD_BUFFER,
  mergeColorAlpha,
} from '../../../utils.js';
import {
  CoreRenderer,
  type BufferInfo,
  type CoreRendererOptions,
} from '../CoreRenderer.js';
import { SdfRenderOp } from './SdfRenderOp.js';
import type { CoreContextTexture } from '../CoreContextTexture.js';
import {
  createIndexBuffer,
  type CoreWebGlParameters,
  type CoreWebGlExtensions,
  getWebGlParameters,
  getWebGlExtensions,
  type WebGlColor,
} from './internal/RendererUtils.js';
import { WebGlCtxTexture } from './WebGlCtxTexture.js';
import {
  Texture,
  TextureType,
  type TextureCoords,
} from '../../textures/Texture.js';
import { SubTexture } from '../../textures/SubTexture.js';
import { WebGlCtxSubTexture } from './WebGlCtxSubTexture.js';
import { BufferCollection } from './internal/BufferCollection.js';
import { compareRect, getNormalizedRgbaComponents } from '../../lib/utils.js';
import { WebGlShaderProgram } from './WebGlShaderProgram.js';
import { WebGlContextWrapper } from '../../lib/WebGlContextWrapper.js';
import { RenderTexture } from '../../textures/RenderTexture.js';
import { CoreNodeRenderState, CoreNode } from '../../CoreNode.js';
import { WebGlCtxRenderTexture } from './WebGlCtxRenderTexture.js';
import { Default } from '../../shaders/webgl/Default.js';
import type { WebGlShaderType } from './WebGlShaderNode.js';
import { WebGlShaderNode } from './WebGlShaderNode.js';
import type { Dimensions } from '../../../common/CommonTypes.js';

export type WebGlRendererOptions = CoreRendererOptions;

interface CoreWebGlSystem {
  parameters: CoreWebGlParameters;
  extensions: CoreWebGlExtensions;
}

export type WebGlRenderOp = CoreNode | SdfRenderOp;

export class WebGlRenderer extends CoreRenderer {
  //// WebGL Native Context and Data
  glw: WebGlContextWrapper;
  system: CoreWebGlSystem;

  //// Persistent data
  quadBuffer: ArrayBuffer;
  fQuadBuffer: Float32Array;
  uiQuadBuffer: Uint32Array;
  /**
   * Separate buffer for RTT quad data. Required when DIRTY_QUAD_BUFFER is on:
   * main-scene nodes own permanent slots in `quadBuffer` and only rewrite when
   * dirty, so if RTT wrote into the same backing storage starting at index 0
   * it would silently overwrite (and corrupt) main-scene slots whose owners
   * aren't dirty this frame. Allocated lazily on first RTT.
   */
  rttQuadBuffer: ArrayBuffer | null = null;
  fRttQuadBuffer: Float32Array | null = null;
  uiRttQuadBuffer: Uint32Array | null = null;
  renderOps: WebGlRenderOp[] = [];
  /**
   * Deferred queue for SDF text render ops, used when RENDER_TEXT_BATCHING is
   * true. All text encountered during the frame is collected here and appended
   * to renderOps at the end (see flushTextRenderOps). This guarantees that all
   * text in a frame draws in a single contiguous run of draw calls, which is
   * the whole point of text batching.
   *
   * Side effect by design: text always draws on top of any non-text quads that
   * came after it in tree order (unless those quads carry an explicit zIndex,
   * which forces an early flush in addQuad). This is intentional — UI text
   * sitting above adjacent backgrounds/icons is the common case, and the
   * batching win is only worth taking if we don't break the run with mid-frame
   * flushes. If you need a non-text quad to land above earlier text, give it
   * a non-zero zIndex.
   */
  coreTextRenderOps: WebGlRenderOp[] = [];

  //// Render Op / Buffer Filling State
  curBufferIdx = 0;
  curRenderOp: WebGlRenderOp | null = null;
  override rttNodes: CoreNode[] = [];
  activeRttNode: CoreNode | null = null;

  //// Shared SDF Buffer
  /**
   * Shared vertex buffer for all SDF text glyphs.
   * Layout per vertex (6 floats = 24 bytes):
   *   [0] x (float) - world pixel X
   *   [1] y (float) - world pixel Y
   *   [2] u (float) - atlas U
   *   [3] v (float) - atlas V
   *   [4] color (uint32) - ABGR packed, read as vec4 normalized
   *   [5] distRange (float) - SDF distance range
   *
   * 4 vertices per glyph → 24 float units per glyph.
   * Triangles are formed via the shared element index buffer.
   */
  sdfBuffer: ArrayBuffer;
  fSdfBuffer: Float32Array;
  uiSdfBuffer: Uint32Array;
  sdfBufferIdx = 0;
  /** Running count of SDF quads written this frame (for element offset). */
  sdfQuadCount = 0;
  sdfQuadBufferCollection: BufferCollection;
  curSdfRenderOp: SdfRenderOp | null = null;

  /**
   * When true, the entire quad buffer is re-uploaded to the GPU via bufferData
   * (DYNAMIC_DRAW) rather than the surgical per-node bufferSubData path.
   * Set to true on first frame and whenever the renderList changes structurally
   * (node added / removed / reordered).
   */
  needsFullUpload: boolean = true;

  override defaultTextureCoords: TextureCoords = {
    x1: 0,
    y1: 0,
    x2: 1,
    y2: 1,
  };

  //// Default Shader
  defaultShaderNode: WebGlShaderNode | null = null;
  quadBufferCollection: BufferCollection;

  clearColor: WebGlColor = {
    raw: 0x00000000,
    normalized: [0, 0, 0, 0],
  };

  /**
   * White pixel texture used by default when no texture is specified.
   */

  quadBufferUsage = 0;
  numQuadsRendered = 0;

  /**
   * Number of float32 elements last uploaded to the GPU via bufferData.
   * Used to detect when curBufferIdx has grown beyond the GPU buffer's
   * capacity, requiring a full re-upload even when needsFullUpload is false.
   */
  lastUploadedBufferSize = 0;
  /**
   * Whether the renderer is currently rendering to a texture.
   */
  public renderToTextureActive = false;

  constructor(options: WebGlRendererOptions) {
    super(options);

    this.quadBuffer = new ArrayBuffer(this.stage.options.quadBufferSize);
    this.fQuadBuffer = new Float32Array(this.quadBuffer);
    this.uiQuadBuffer = new Uint32Array(this.quadBuffer);

    this.mode = 'webgl';

    const gl = createWebGLContext(
      options.canvas,
      options.forceWebGL2,
      options.contextSpy,
    );
    const glw = (this.glw = new WebGlContextWrapper(gl));
    glw.viewport(0, 0, options.canvas.width, options.canvas.height);

    this.attachContextLossListeners(options.canvas);

    this.updateClearColor(this.stage.clearColor);

    glw.setBlend(true);
    glw.blendFunc(glw.ONE, glw.ONE_MINUS_SRC_ALPHA);

    createIndexBuffer(glw, this.stage.bufferMemory);

    this.system = {
      parameters: getWebGlParameters(this.glw),
      extensions: getWebGlExtensions(this.glw),
    };

    // Create the static node coords buffer
    // 80 is the magic number used in createIndexBuffer
    // @see RendererUtils.ts
    const maxQuads = ~~(this.stage.bufferMemory / 80);
    const nodeCoords = new Float32Array(maxQuads * 8);
    for (let i = 0; i < maxQuads * 8; i += 8) {
      nodeCoords[i] = 0;
      nodeCoords[i + 1] = 0;
      nodeCoords[i + 2] = 1;
      nodeCoords[i + 3] = 0;
      nodeCoords[i + 4] = 0;
      nodeCoords[i + 5] = 1;
      nodeCoords[i + 6] = 1;
      nodeCoords[i + 7] = 1;
    }
    const nodeCoordsBuffer = glw.createBuffer();
    glw.arrayBufferData(nodeCoordsBuffer, nodeCoords, glw.STATIC_DRAW);

    const quadBuffer = glw.createBuffer();
    const stride = 5 * Float32Array.BYTES_PER_ELEMENT;
    this.quadBufferCollection = new BufferCollection([
      {
        buffer: quadBuffer!,
        attributes: {
          a_position: {
            name: 'a_position',
            size: 2, // 2 components per iteration
            type: glw.FLOAT, // the data is 32bit floats
            normalized: false, // don't normalize the data
            stride, // 0 = move forward size * sizeof(type) each iteration to get the next position
            offset: 0, // start at the beginning of the buffer
          },
          a_textureCoords: {
            name: 'a_textureCoords',
            size: 2,
            type: glw.FLOAT,
            normalized: false,
            stride,
            offset: 2 * Float32Array.BYTES_PER_ELEMENT,
          },
          a_color: {
            name: 'a_color',
            size: 4,
            type: glw.UNSIGNED_BYTE,
            normalized: true,
            stride,
            offset: 4 * Float32Array.BYTES_PER_ELEMENT,
          },
        },
      },
      {
        buffer: nodeCoordsBuffer!,
        attributes: {
          a_nodeCoords: {
            name: 'a_nodeCoords',
            size: 2,
            type: glw.FLOAT,
            normalized: false,
            stride: 2 * Float32Array.BYTES_PER_ELEMENT,
            offset: 0,
          },
        },
      },
    ]);
    // --- Shared SDF buffer ---------------------------------------------------
    // Allocate 512 KB for SDF vertex data (~3600 glyphs).
    const sdfBufSize = 512 * 1024;
    this.sdfBuffer = new ArrayBuffer(sdfBufSize);
    this.fSdfBuffer = new Float32Array(this.sdfBuffer);
    this.uiSdfBuffer = new Uint32Array(this.sdfBuffer);

    const sdfWebGlBuffer = glw.createBuffer();
    const sdfStride = 6 * Float32Array.BYTES_PER_ELEMENT; // 24 bytes
    this.sdfQuadBufferCollection = new BufferCollection([
      {
        buffer: sdfWebGlBuffer!,
        attributes: {
          a_position: {
            name: 'a_position',
            size: 2,
            type: glw.FLOAT,
            normalized: false,
            stride: sdfStride,
            offset: 0,
          },
          a_textureCoords: {
            name: 'a_textureCoords',
            size: 2,
            type: glw.FLOAT,
            normalized: false,
            stride: sdfStride,
            offset: 2 * Float32Array.BYTES_PER_ELEMENT,
          },
          a_color: {
            name: 'a_color',
            size: 4,
            type: glw.UNSIGNED_BYTE,
            normalized: true,
            stride: sdfStride,
            offset: 4 * Float32Array.BYTES_PER_ELEMENT,
          },
          a_distRange: {
            name: 'a_distRange',
            size: 1,
            type: glw.FLOAT,
            normalized: false,
            stride: sdfStride,
            offset: 5 * Float32Array.BYTES_PER_ELEMENT,
          },
        },
      },
    ]);
  }

  /**
   * Listen for WebGL context loss on the canvas.
   *
   * @remarks
   * On low-RAM devices (e.g. Chromium 123+ after backgrounding) the GPU
   * context is dropped, after which `gl.createTexture()` and friends return
   * null and the engine would crash. We pause the render loop via the Stage
   * flag and surface a `contextLost` event so consumers can react.
   *
   * We intentionally do NOT call `event.preventDefault()` (which would ask the
   * browser to restore the context) and do NOT listen for
   * `webglcontextrestored`: the engine cannot rebuild its GPU resources
   * in-place, so the supported recovery is to reload the app. See BROWSERS.md.
   */
  private attachContextLossListeners(
    canvas: HTMLCanvasElement | OffscreenCanvas,
  ): void {
    if ('addEventListener' in canvas === false) {
      return;
    }
    const target = canvas as HTMLCanvasElement;
    target.addEventListener('webglcontextlost', () => {
      this.stage.setContextLost();
    });
  }

  reset() {
    const { glw } = this;
    if (DIRTY_QUAD_BUFFER) {
      // NOTE: curBufferIdx is intentionally NOT reset here.
      // Each node owns a permanent slot in the quad buffer (assigned in addQuad
      // on first use). Resetting the index is only done when the renderList
      // changes structurally (see Stage.requestRenderListUpdate).
    } else {
      this.curBufferIdx = 0;
    }
    this.curRenderOp = null;
    this.curSdfRenderOp = null;
    this.sdfBufferIdx = 0;
    this.sdfQuadCount = 0;
    this.renderOps.length = 0;
    this.coreTextRenderOps.length = 0;
    glw.setScissorTest(false);
    if (this.stage.options.enableClear !== false) {
      glw.clear();
    }
  }

  createShaderProgram(
    shaderType: WebGlShaderType,
    props: Record<string, unknown>,
  ): WebGlShaderProgram {
    return new WebGlShaderProgram(this, shaderType, props);
  }

  createShaderNode(
    shaderKey: string,
    shaderType: WebGlShaderType,
    props?: Record<string, unknown>,
    program?: WebGlShaderProgram,
  ) {
    return new WebGlShaderNode(
      shaderKey,
      shaderType,
      program!,
      this.stage,
      props,
    );
  }

  override supportsShaderType(shaderType: Readonly<WebGlShaderType>): boolean {
    //if shadertype doesnt have a fragment source we cant use it
    return shaderType.fragment !== undefined;
  }

  createCtxTexture(textureSource: Texture): CoreContextTexture {
    if (textureSource instanceof SubTexture) {
      return new WebGlCtxSubTexture(
        this.glw,
        this.stage.txMemManager,
        textureSource,
      );
    } else if (textureSource instanceof RenderTexture) {
      return new WebGlCtxRenderTexture(
        this.glw,
        this.stage.txMemManager,
        textureSource,
      );
    }
    return new WebGlCtxTexture(
      this.glw,
      this.stage.txMemManager,
      textureSource,
    );
  }

  /**
   * This function adds a quad (a rectangle composed of two triangles) to the WebGL rendering pipeline.
   *
   * It takes a set of options that define the quad's properties, such as its dimensions, colors, texture, shader, and transformation matrix.
   * The function first updates the shader properties with the current dimensions if necessary, then sets the default texture if none is provided.
   * It then checks if a new render operation is needed, based on the current shader and clipping rectangle.
   * If a new render operation is needed, it creates one and updates the current render operation.
   * The function then adjusts the texture coordinates based on the texture options and adds the texture to the texture manager.
   *
   * Finally, it calculates the vertices for the quad, taking into account any transformations, and adds them to the quad buffer.
   * The function updates the length and number of quads in the current render operation, and updates the current buffer index.
   */
  addQuad(node: CoreNode) {
    let f = this.fQuadBuffer;
    let u = this.uiQuadBuffer;
    if (USE_RTT && this.renderToTextureActive === true) {
      if (this.fRttQuadBuffer === null) {
        this.rttQuadBuffer = new ArrayBuffer(this.stage.options.quadBufferSize);
        this.fRttQuadBuffer = new Float32Array(this.rttQuadBuffer);
        this.uiRttQuadBuffer = new Uint32Array(this.rttQuadBuffer);
      }
      f = this.fRttQuadBuffer;
      u = this.uiRttQuadBuffer!;
    }

    // Explicit zIndex on a non-text quad opts out of the text-batching
    // ordering: flush deferred text now so this quad lands above any text
    // that came earlier in tree order. See coreTextRenderOps for the
    // intentional default behavior.
    if (RENDER_TEXT_BATCHING === true && node.props.zIndex) {
      this.flushTextRenderOps();
    }

    // With batching off, SDF ops live inside renderOps interleaved with quad
    // ops. A non-text quad inserted here would otherwise still let the next
    // text node extend the previous SDF op (same atlas/clipping), drawing
    // those glyphs at the earlier position and getting overdrawn by this quad.
    if (RENDER_TEXT_BATCHING === false) {
      this.curSdfRenderOp = null;
    }

    const props = node.props;
    let tx = props.texture || this.stage.defaultTexture!;

    if (tx.type === TextureType.subTexture) {
      tx = (tx as SubTexture).parentTexture;
    }

    const ctx = tx.ctxTexture as WebGlCtxTexture | undefined;
    if (ctx === undefined) {
      return;
    }

    const reuse = this.reuseRenderOp(node);

    // During RTT rendering, always use sequential allocation and write data
    // since the buffer is rebuilt from scratch each frame for RTT passes.
    // The DIRTY_QUAD_BUFFER permanent slot optimization only applies to the
    // main scene.
    const isRTT = this.renderToTextureActive;

    // Assign a permanent buffer slot if this node hasn't been registered yet.
    // Once assigned, the slot index never changes unless the renderList is
    // rebuilt (which resets quadBufferIndex to -1 for all nodes).
    if (DIRTY_QUAD_BUFFER && !isRTT) {
      if (node.quadBufferIndex === -1) {
        node.quadBufferIndex = this.curBufferIdx;
        this.curBufferIdx += 20;
      }
    } else {
      // Legacy / RTT path: always advance from curBufferIdx sequentially.
      node.quadBufferIndex = this.curBufferIdx;
      this.curBufferIdx += 20;
    }

    const i = node.quadBufferIndex;

    if (reuse === false) {
      this.newRenderOp(node, i);
    }

    let tidx = this.curRenderOp!.addTexture(ctx);

    if (tidx === 0xffffffff) {
      this.newRenderOp(node, i);
      tidx = this.curRenderOp!.addTexture(ctx);
    }

    // Only rewrite the CPU-side buffer when the node is dirty.
    // The GPU upload is deferred to render().
    // During RTT, always write since the buffer is rebuilt from scratch.
    if (!DIRTY_QUAD_BUFFER || isRTT || node.isQuadDirty) {
      const rc = node.renderCoords!;
      const tc = node.textureCoords || this.defaultTextureCoords;

      const cTl = node.premultipliedColorTl;
      const cTr = node.premultipliedColorTr;
      const cBl = node.premultipliedColorBl;
      const cBr = node.premultipliedColorBr;

      // Upper-Left
      f[i] = rc.x1;
      f[i + 1] = rc.y1;
      f[i + 2] = tc.x1;
      f[i + 3] = tc.y1;
      u[i + 4] = cTl;

      // Upper-Right
      f[i + 5] = rc.x2;
      f[i + 6] = rc.y2;
      f[i + 7] = tc.x2;
      f[i + 8] = tc.y1;
      u[i + 9] = cTr;

      // Lower-Left
      f[i + 10] = rc.x4;
      f[i + 11] = rc.y4;
      f[i + 12] = tc.x1;
      f[i + 13] = tc.y2;
      u[i + 14] = cBl;

      // Lower-Right
      f[i + 15] = rc.x3;
      f[i + 16] = rc.y3;
      f[i + 17] = tc.x2;
      f[i + 18] = tc.y2;
      u[i + 19] = cBr;
    }

    this.curRenderOp!.numQuads++;
  }

  /**
   * Replace the existing RenderOp with a new one that uses the specified Shader
   * and starts at the specified buffer index.
   *
   * @param shader
   * @param bufferIdx
   */
  private newRenderOp(node: CoreNode, bufferIdx: number) {
    const curRenderOp = node;
    curRenderOp.renderOpBufferIdx = bufferIdx;
    curRenderOp.numQuads = 0;
    curRenderOp.renderOpTextures.length = 0;

    this.curRenderOp = curRenderOp;
    this.renderOps.push(curRenderOp);
  }

  /**
   * Test if the current Render operation can be reused for the specified parameters.
   * @param params
   * @returns
   */
  reuseRenderOp(node: CoreNode): boolean {
    const curRenderOp = this.curRenderOp;
    if (curRenderOp === null) {
      return false;
    }

    // Correctness checks first — these MUST pass regardless of shader.
    // RTT mismatch and clipping rect differences can't be batched: the
    // draw call applies one framebuffer / one scissor to every quad in
    // the op.

    // Force new render operation if rendering to texture is different
    if (
      USE_RTT &&
      (curRenderOp.parentHasRenderTexture !== node.parentHasRenderTexture ||
        (curRenderOp.rtt === true) !== (node.props.rtt === true))
    ) {
      return false;
    }

    // Switching clipping rect will require a new render operation
    if (compareRect(curRenderOp.clippingRect, node.clippingRect) === false) {
      return false;
    }

    const shader = node.props.shader as WebGlShaderNode;
    const curShader = curRenderOp.shader as WebGlShaderNode;

    if (curShader.shaderKey === 'default' && shader.shaderKey === 'default') {
      return true;
    }

    // Check if the shader is the same
    if (curShader !== shader) {
      return false;
    }

    if (
      USE_RTT &&
      node.parentHasRenderTexture === true &&
      node.parentFramebufferDimensions !== null
    ) {
      const curFbDims = curRenderOp.isCoreNode
        ? curRenderOp.parentFramebufferDimensions
        : curRenderOp.framebufferDimensions;
      if (
        curFbDims === null ||
        curFbDims.w !== node.parentFramebufferDimensions.w ||
        curFbDims.h !== node.parentFramebufferDimensions.h
      ) {
        return false;
      }
    }

    // Check if the shader can batch the shader properties
    if (curShader.program.reuseRenderOp(node, curRenderOp) === false) {
      return false;
    }

    return true;
  }

  /**
   * add RenderOp to the render pipeline
   */
  addRenderOp(renderable: WebGlRenderOp) {
    if (RENDER_TEXT_BATCHING === true) {
      // We are batching text nodes to be added later
      this.coreTextRenderOps.push(renderable);
      return;
    }
    this.renderOps.push(renderable);
    this.curRenderOp = null;
  }

  flushTextRenderOps() {
    const len = this.coreTextRenderOps.length;
    if (len === 0) {
      return;
    }
    for (let i = 0; i < len; i++) {
      this.renderOps.push(this.coreTextRenderOps[i]!);
    }
    this.coreTextRenderOps.length = 0;
    this.curRenderOp = null;
    this.curSdfRenderOp = null;
  }

  /**
   * Append pre-transformed SDF glyph vertices to the shared SDF buffer
   * and manage SDF render op batching.
   *
   * @remarks
   * This method pre-transforms glyph positions from design units to world
   * pixel space on the CPU, packs per-vertex color and distanceRange, and
   * writes them into the shared SDF buffer. Compatible consecutive calls
   * (same atlas, same clipping, same RTT state) are merged into a single
   * SdfRenderOp, resulting in one draw call for many text nodes.
   */
  addSdfQuads(
    glyphs: import('../../text-rendering/TextRenderer.js').GlyphLayout[],
    fontScale: number,
    transform: Float32Array,
    color: number,
    worldAlpha: number,
    distanceRange: number,
    atlasTexture: WebGlCtxTexture,
    clippingRect: import('../../lib/utils.js').RectWithValid,
    width: number,
    height: number,
    parentHasRenderTexture: boolean,
    framebufferDimensions:
      | import('../../../common/CommonTypes.js').Dimensions
      | null,
    sdfShader: WebGlShaderNode,
  ): void {
    const glyphCount = glyphs.length;
    if (glyphCount === 0) {
      return;
    }

    let idx = this.sdfBufferIdx;
    this.ensureSdfBufferCapacity(idx + glyphCount * 24);

    const f = this.fSdfBuffer;
    const u = this.uiSdfBuffer;

    // Pre-compute the merged color (with alpha) packed as ABGR for
    // UNSIGNED_BYTE normalized attribute.
    // NOTE: Do NOT premultiply RGB by alpha here — the SDF fragment shader
    // already multiplies v_color.rgb by the computed opacity (which includes
    // v_color.a).
    const mergedColor = mergeColorAlpha(color, worldAlpha);
    const r = mergedColor >>> 24;
    const g = (mergedColor >>> 16) & 0xff;
    const b = (mergedColor >>> 8) & 0xff;
    const a = mergedColor & 0xff;
    // Pack as ABGR uint32 (little-endian read as vec4(r,g,b,a) normalized)
    const packedColor = ((a << 24) | (b << 16) | (g << 8) | r) >>> 0;

    // Transform matrix components (column-major 3x3)
    // Pre-multiply fontScale here to save 4 multiplications per glyph in the hot loop
    const m0 = transform[0]! * fontScale;
    const m1 = transform[1]! * fontScale;
    const m3 = transform[3]! * fontScale;
    const m4 = transform[4]! * fontScale;
    const m6 = transform[6]!;
    const m7 = transform[7]!;

    // Record start quad for this batch segment
    const startQuad = this.sdfQuadCount;

    for (let gi = 0; gi < glyphCount; gi++) {
      const glyph = glyphs[gi]!;

      // Glyph corners in design units
      const gx1 = glyph.x;
      const gy1 = glyph.y;
      const gx2 = gx1 + glyph.width;
      const gy2 = gy1 + glyph.height;

      // Atlas UVs
      const u1 = glyph.atlasX;
      const v1 = glyph.atlasY;
      const u2 = u1 + glyph.atlasWidth;
      const v2 = v1 + glyph.atlasHeight;

      // Transform to world space
      // Note: we use gx/y directly since m0,m1,m3,m4 are already pre-scaled
      // Top-left
      const wx_tl = m0 * gx1 + m3 * gy1 + m6;
      const wy_tl = m1 * gx1 + m4 * gy1 + m7;
      // Top-right
      const wx_tr = m0 * gx2 + m3 * gy1 + m6;
      const wy_tr = m1 * gx2 + m4 * gy1 + m7;
      // Bottom-left
      const wx_bl = m0 * gx1 + m3 * gy2 + m6;
      const wy_bl = m1 * gx1 + m4 * gy2 + m7;
      // Bottom-right
      const wx_br = m0 * gx2 + m3 * gy2 + m6;
      const wy_br = m1 * gx2 + m4 * gy2 + m7;

      // 4 vertices per glyph: TL, TR, BL, BR
      // Index buffer supplies the two-triangle winding: [0,1,2, 2,1,3]
      f[idx] = wx_tl;
      f[idx + 1] = wy_tl;
      f[idx + 2] = u1;
      f[idx + 3] = v1;
      u[idx + 4] = packedColor;
      f[idx + 5] = distanceRange;
      idx += 6;
      f[idx] = wx_tr;
      f[idx + 1] = wy_tr;
      f[idx + 2] = u2;
      f[idx + 3] = v1;
      u[idx + 4] = packedColor;
      f[idx + 5] = distanceRange;
      idx += 6;
      f[idx] = wx_bl;
      f[idx + 1] = wy_bl;
      f[idx + 2] = u1;
      f[idx + 3] = v2;
      u[idx + 4] = packedColor;
      f[idx + 5] = distanceRange;
      idx += 6;
      f[idx] = wx_br;
      f[idx + 1] = wy_br;
      f[idx + 2] = u2;
      f[idx + 3] = v2;
      u[idx + 4] = packedColor;
      f[idx + 5] = distanceRange;
      idx += 6;
    }

    this.sdfBufferIdx = idx;
    this.sdfQuadCount += glyphCount;

    this.finalizeSdfBatch(
      startQuad,
      glyphCount,
      atlasTexture,
      clippingRect,
      worldAlpha,
      width,
      height,
      parentHasRenderTexture,
      framebufferDimensions,
      sdfShader,
    );
  }

  /**
   * Fast path: copy pre-computed cached SDF vertex data into the shared
   * buffer and create/extend an SdfRenderOp.
   *
   * @remarks
   * When a text node hasn't changed (same layout, transform, color, alpha),
   * the per-glyph matrix multiplication is skipped entirely. The cached
   * Float32Array is written via a single `Float32Array.set()` (memcpy),
   * which is orders of magnitude faster than the per-glyph computation path.
   */
  addSdfCachedQuads(
    cachedVertices: Float32Array,
    numGlyphs: number,
    atlasTexture: WebGlCtxTexture,
    clippingRect: import('../../lib/utils.js').RectWithValid,
    worldAlpha: number,
    width: number,
    height: number,
    parentHasRenderTexture: boolean,
    framebufferDimensions:
      | import('../../../common/CommonTypes.js').Dimensions
      | null,
    sdfShader: WebGlShaderNode,
  ): void {
    if (numGlyphs === 0) {
      return;
    }

    const startQuad = this.sdfQuadCount;

    this.ensureSdfBufferCapacity(this.sdfBufferIdx + cachedVertices.length);

    // Single memcpy — much faster than per-glyph matrix math
    this.fSdfBuffer.set(cachedVertices, this.sdfBufferIdx);
    this.sdfBufferIdx += cachedVertices.length;
    this.sdfQuadCount += numGlyphs;

    this.finalizeSdfBatch(
      startQuad,
      numGlyphs,
      atlasTexture,
      clippingRect,
      worldAlpha,
      width,
      height,
      parentHasRenderTexture,
      framebufferDimensions,
      sdfShader,
    );
  }

  /**
   * Shared batching logic for SDF render ops.
   * Called by both `addSdfQuads` (full compute) and `addSdfCachedQuads` (fast copy).
   */
  private finalizeSdfBatch(
    startQuad: number,
    glyphCount: number,
    atlasTexture: WebGlCtxTexture,
    clippingRect: import('../../lib/utils.js').RectWithValid,
    worldAlpha: number,
    width: number,
    height: number,
    parentHasRenderTexture: boolean,
    framebufferDimensions:
      | import('../../../common/CommonTypes.js').Dimensions
      | null,
    sdfShader: WebGlShaderNode,
  ): void {
    // --- Batching: try to extend the current SDF render op ---------------
    const opList =
      RENDER_TEXT_BATCHING === true ? this.coreTextRenderOps : this.renderOps;

    const cur = this.curSdfRenderOp;
    let canBatch = false;

    if (cur !== null) {
      // Same atlas texture?
      if (
        cur.renderOpTextures.length === 1 &&
        cur.renderOpTextures[0] === (atlasTexture as unknown as WebGlCtxTexture)
      ) {
        // Same clipping rect?
        if (compareRect(cur.clippingRect, clippingRect)) {
          // Same RTT state?
          if (
            !USE_RTT ||
            (cur.parentHasRenderTexture === parentHasRenderTexture &&
              cur.rtt === false)
          ) {
            canBatch = true;
          }
        }
      }
    }

    if (canBatch && cur !== null) {
      // Extend existing op
      cur.numQuads += glyphCount;
    } else {
      // Create a new SdfRenderOp referencing the shared buffer
      const op = new SdfRenderOp(
        this,
        sdfShader,
        this.sdfQuadBufferCollection,
        worldAlpha,
        clippingRect,
        width,
        height,
        false,
        parentHasRenderTexture,
        framebufferDimensions,
      );
      op.startQuad = startQuad;
      op.numQuads = glyphCount;
      op.addTexture(atlasTexture as unknown as WebGlCtxTexture);

      opList.push(op);
      this.curSdfRenderOp = op;

      // Break the regular quad render op chain so subsequent image/rect
      // nodes don't try to extend an SDF op.
      this.curRenderOp = null;
    }
  }

  /**
   * Resizes the shared SDF ArrayBuffer if the required size (in floats) goes beyond
   * the current buffer capacity.
   */
  private ensureSdfBufferCapacity(requiredSize: number): void {
    if (requiredSize <= this.fSdfBuffer.length) {
      return;
    }

    let newCapacity = this.fSdfBuffer.length * 2;
    while (newCapacity < requiredSize) {
      newCapacity *= 2;
    }

    const sdfBufSize = newCapacity * Float32Array.BYTES_PER_ELEMENT;
    const newBuffer = new ArrayBuffer(sdfBufSize);
    const newFSdfBuffer = new Float32Array(newBuffer);
    const newUiSdfBuffer = new Uint32Array(newBuffer);

    // Copy existing data to new buffers
    newFSdfBuffer.set(this.fSdfBuffer);

    // Swap allocations
    this.sdfBuffer = newBuffer;
    this.fSdfBuffer = newFSdfBuffer;
    this.uiSdfBuffer = newUiSdfBuffer;
  }

  /**
   * Render the current set of RenderOps to render to the specified surface.
   *
   * On the first frame after a renderList structural change (`needsFullUpload`
   * is true) the entire quad buffer is re-allocated on the GPU with
   * `bufferData(DYNAMIC_DRAW)`. On every subsequent frame only the slots of
   * nodes flagged `isQuadDirty` are surgically updated via `bufferSubData`,
   * leaving the rest of the GPU's buffer unchanged.
   *
   * TODO: 'screen' is the only supported surface at the moment.
   *
   * @param surface
   */
  render(surface: 'screen' | CoreContextTexture = 'screen'): void {
    if (RENDER_TEXT_BATCHING === true) {
      this.flushTextRenderOps();
    }
    const { glw, quadBuffer } = this;
    const buffer = this.quadBufferCollection.getBuffer('a_position') || null;
    const BYTES = Float32Array.BYTES_PER_ELEMENT;

    if (DIRTY_QUAD_BUFFER) {
      if (
        this.needsFullUpload ||
        this.curBufferIdx > this.lastUploadedBufferSize
      ) {
        // Full GPU re-allocation: covers new nodes and structural reorders.
        // Also triggered when curBufferIdx has grown beyond the last uploaded
        // size (e.g. after RTT rendering consumed needsFullUpload and then
        // the main scene added more quads).
        // Uses DYNAMIC_DRAW to signal to the driver that the buffer will be
        // updated frequently in smaller pieces going forward.
        const arr = new Float32Array(quadBuffer, 0, this.curBufferIdx);
        glw.arrayBufferData(buffer, arr, glw.DYNAMIC_DRAW);
        this.needsFullUpload = false;
        this.lastUploadedBufferSize = this.curBufferIdx;

        // Clear dirty flags since we just uploaded everything.
        const renderList = this.stage.renderList;
        for (let i = 0, len = renderList.length; i < len; i++) {
          renderList[i]!.isQuadDirty = false;
        }
      } else {
        // Surgical per-node uploads: only write the 20 float32s for nodes
        // whose quad data changed since the last frame.
        const renderList = this.stage.renderList;
        for (let i = 0, len = renderList.length; i < len; i++) {
          const node = renderList[i]!;
          if (node.isQuadDirty && node.quadBufferIndex !== -1) {
            const byteOffset = node.quadBufferIndex * BYTES;
            // Create a view directly into the existing CPU buffer — no allocation.
            const view = new Float32Array(quadBuffer, byteOffset, 20);
            glw.arrayBufferSubData(buffer, byteOffset, view);
            node.isQuadDirty = false;
          }
        }
      }
    } else {
      // Legacy path: full buffer upload every frame.
      const arr = new Float32Array(quadBuffer, 0, this.curBufferIdx);
      glw.arrayBufferData(buffer, arr, glw.STATIC_DRAW);
    }

    // Upload the shared SDF buffer if any SDF glyphs were written this frame.
    if (this.sdfBufferIdx > 0) {
      const sdfBuf =
        this.sdfQuadBufferCollection.getBuffer('a_position') || null;
      const sdfArr = new Float32Array(this.sdfBuffer, 0, this.sdfBufferIdx);
      glw.arrayBufferData(sdfBuf, sdfArr, glw.DYNAMIC_DRAW);
    }

    for (let i = 0, length = this.renderOps.length; i < length; i++) {
      this.renderOps[i]!.draw(this);
    }

    const BYTES_PER_ELEMENT = Float32Array.BYTES_PER_ELEMENT;
    this.quadBufferUsage = this.curBufferIdx * BYTES_PER_ELEMENT;

    // Calculate the size of each quad in bytes (4 vertices per quad) times the size of each vertex in bytes
    const QUAD_SIZE_IN_BYTES = 4 * (5 * BYTES_PER_ELEMENT); // 5 attributes per vertex
    this.numQuadsRendered = this.quadBufferUsage / QUAD_SIZE_IN_BYTES;
  }

  getQuadCount(): number {
    return this.numQuadsRendered;
  }

  getRenderOpCount(): number {
    return this.renderOps.length;
  }

  renderToTexture(node: CoreNode) {
    for (let i = 0; i < this.rttNodes.length; i++) {
      if (this.rttNodes[i] === node) {
        return;
      }
    }

    this.insertRTTNodeInOrder(node);
  }

  /**
   * Inserts an RTT node into `this.rttNodes` while maintaining the correct rendering order based on hierarchy.
   *
   * Rendering order for RTT nodes is critical when nested RTT nodes exist in a parent-child relationship.
   * Specifically:
   *  - Child RTT nodes must be rendered before their RTT-enabled parents to ensure proper texture composition.
   *  - If an RTT node is added and it has existing RTT children, it should be rendered after those children.
   *
   * This function addresses both cases by:
   * 1. **Checking Upwards**: It traverses the node's hierarchy upwards to identify any RTT parent
   *    already in `rttNodes`. If an RTT parent is found, the new node is placed before this parent.
   * 2. **Checking Downwards**: It traverses the node’s children recursively to find any RTT-enabled
   *    children that are already in `rttNodes`. If such children are found, the new node is inserted
   *    after the last (highest index) RTT child node.
   *
   * The final calculated insertion index ensures the new node is positioned in `rttNodes` to respect
   * both parent-before-child and child-before-parent rendering rules, preserving the correct order
   * for the WebGL renderer.
   *
   * @param node - The RTT-enabled CoreNode to be added to `rttNodes` in the appropriate hierarchical position.
   */
  private insertRTTNodeInOrder(node: CoreNode) {
    let insertIndex = this.rttNodes.length; // Default to the end of the array

    // 1. Traverse upwards to ensure the node is placed before its RTT parent (if any).
    let currentNode: CoreNode = node;
    while (currentNode) {
      if (!currentNode.parent) {
        break;
      }

      const parentIndex = this.rttNodes.indexOf(currentNode.parent);
      if (parentIndex !== -1) {
        // Found an RTT parent in the list; set insertIndex to place node before the parent
        insertIndex = parentIndex;
        break;
      }

      currentNode = currentNode.parent;
    }

    // 2. Traverse downwards to ensure the node is placed after any RTT children.
    // Look through each child recursively to see if any are already in rttNodes.
    const maxChildIndex = this.findMaxChildRTTIndex(node);
    if (maxChildIndex !== -1) {
      // Adjust insertIndex to be after the last child RTT node
      insertIndex = Math.max(insertIndex, maxChildIndex + 1);
    }

    // 3. Insert the node at the calculated position
    this.rttNodes.splice(insertIndex, 0, node);
  }

  // Helper function to find the highest index of any RTT children of a node within rttNodes
  private findMaxChildRTTIndex(node: CoreNode): number {
    let maxIndex = -1;

    const traverseChildren = (currentNode: CoreNode) => {
      const currentIndex = this.rttNodes.indexOf(currentNode);
      if (currentIndex !== -1) {
        maxIndex = Math.max(maxIndex, currentIndex);
      }

      // Recursively check all children of the current node
      for (const child of currentNode.children) {
        traverseChildren(child);
      }
    };

    // Start traversal directly with the provided node
    traverseChildren(node);

    return maxIndex;
  }

  renderRTTNodes() {
    const { glw } = this;

    // Save main scene buffer index so RTT rendering doesn't interfere
    // with the dirty quad buffer optimization.
    const savedBufferIdx = this.curBufferIdx;

    // Render all associated RTT nodes to their textures
    for (let i = 0; i < this.rttNodes.length; i++) {
      const node = this.rttNodes[i];

      // Skip nodes that don't have RTT updates
      if (node === undefined || node.hasRTTupdates === false) {
        continue;
      }

      // Skip nodes that are not visible
      if (
        node.worldAlpha === 0 ||
        node.renderState === CoreNodeRenderState.OutOfBounds
      ) {
        continue;
      }

      // Skip nodes that do not have a loaded texture
      if (node.texture === null || node.texture.state !== 'loaded') {
        continue;
      }

      // Set the active RTT node to the current node
      // So we can prevent rendering children of nested RTT nodes
      this.activeRttNode = node;
      const ctxTexture = node.texture.ctxTexture as WebGlCtxRenderTexture;
      this.renderToTextureActive = true;

      // Bind the the texture's framebuffer
      glw.bindFramebuffer(ctxTexture.framebuffer);

      glw.viewport(0, 0, ctxTexture.w, ctxTexture.h);
      // Set the clear color to transparent
      glw.clearColor(0, 0, 0, 0);
      glw.clear();

      // RTT uses its own sequential buffer from index 0.
      // This avoids interference with the main scene's permanent slot assignments.
      this.curBufferIdx = 0;
      this.needsFullUpload = true;
      this.lastUploadedBufferSize = 0;

      // Clear merge anchors so the first addQuad / addSdfQuads in this pass
      // can't extend a stale op left over from the previous RTT pass (whose
      // node is no longer in renderOps and would silently swallow the draw).
      this.curRenderOp = null;
      this.curSdfRenderOp = null;

      // Recursively render the full subtree into the RTT framebuffer.
      // The old code only called renderQuads on direct children, missing
      // grandchildren and deeper descendants.
      this.addRTTQuads(node);

      // Render all associated quads to the texture
      this.renderRTT();

      // Reset render operations
      this.renderOps.length = 0;
      this.coreTextRenderOps.length = 0;
      node.hasRTTupdates = false;
    }

    // Restore main scene buffer index.
    // The RTT pass replaced the GPU buffer (via arrayBufferData) with a
    // smaller RTT-sized buffer. We must force a full re-upload so the main
    // scene's render() reallocates the GPU buffer to the correct size.
    this.curBufferIdx = savedBufferIdx;
    this.needsFullUpload = true;
    this.lastUploadedBufferSize = 0;

    const clearColor = this.clearColor.normalized;
    // Restore the default clear color
    glw.clearColor(clearColor[0], clearColor[1], clearColor[2], clearColor[3]);

    // Bind the default framebuffer
    glw.bindFramebuffer(null);

    glw.viewport(0, 0, this.glw.canvas.width, this.glw.canvas.height);
    this.renderToTextureActive = false;
  }

  /**
   * Recursively walk the subtree of an RTT node and add quads for all
   * renderable descendants. This restores the recursive behavior that was
   * lost when `stage.addQuads(child)` was replaced with `child.renderQuads(this)`.
   */
  private addRTTQuads(node: CoreNode) {
    const children = node.children;
    for (let i = 0, len = children.length; i < len; i++) {
      const child = children[i];
      if (
        child === undefined ||
        child.worldAlpha === 0 ||
        child.renderState === CoreNodeRenderState.OutOfBounds
      ) {
        continue;
      }

      if (child.isRenderable === true) {
        child.renderQuads(this);
      }

      child.hasRTTupdates = false;

      // Recurse into children (unless this child is itself an RTT node,
      // whose children are rendered in their own pass)
      if (!child.props.rtt) {
        this.addRTTQuads(child);
      }
    }
  }

  /**
   * Render pass for RTT: always does a full buffer upload since RTT quads
   * use temporary sequential buffer slots that are rebuilt each frame.
   */
  private renderRTT(): void {
    if (RENDER_TEXT_BATCHING === true) {
      this.flushTextRenderOps();
    }
    const { glw } = this;
    const buffer = this.quadBufferCollection.getBuffer('a_position') || null;

    // Always do a full upload for RTT — the buffer is rebuilt from scratch
    // each frame with sequential slots starting at index 0. Upload from the
    // dedicated RTT ArrayBuffer so we don't read stale main-scene data.
    const arr = new Float32Array(this.rttQuadBuffer!, 0, this.curBufferIdx);
    glw.arrayBufferData(buffer, arr, glw.STATIC_DRAW);

    // Upload the shared SDF buffer so any text rendered into this RTT pass
    // has its vertex data available on the GPU before drawElements runs.
    if (this.sdfBufferIdx > 0) {
      const sdfBuf =
        this.sdfQuadBufferCollection.getBuffer('a_position') || null;
      const sdfArr = new Float32Array(this.sdfBuffer, 0, this.sdfBufferIdx);
      glw.arrayBufferData(sdfBuf, sdfArr, glw.DYNAMIC_DRAW);
    }

    for (let i = 0, length = this.renderOps.length; i < length; i++) {
      this.renderOps[i]!.draw(this);
    }
  }

  updateViewport(): void {
    this.glw.viewport(0, 0, this.glw.canvas.width, this.glw.canvas.height);
  }

  removeRTTNode(node: CoreNode) {
    const index = this.rttNodes.indexOf(node);
    if (index === -1) {
      return;
    }
    this.rttNodes.splice(index, 1);
  }

  getBufferInfo(): BufferInfo | null {
    const bufferInfo: BufferInfo = {
      totalAvailable: this.stage.options.quadBufferSize,
      totalUsed: this.quadBufferUsage,
    };
    return bufferInfo;
  }

  getDefaultShaderNode(): WebGlShaderNode {
    if (this.defaultShaderNode !== null) {
      return this.defaultShaderNode as WebGlShaderNode;
    }
    this.stage.shManager.registerShaderType('default', Default);
    this.defaultShaderNode = this.stage.shManager.createShader(
      'default',
    ) as WebGlShaderNode;
    return this.defaultShaderNode;
  }

  override getTextureCoords(node: CoreNode): TextureCoords | undefined {
    const texture = node.texture;
    if (texture === null) {
      return undefined;
    }

    //this stuff needs to be properly moved to CtxSubTexture at some point in the future.
    const ctxTexture =
      (texture as SubTexture).parentTexture !== undefined
        ? (texture as SubTexture).parentTexture.ctxTexture
        : texture.ctxTexture;
    if (ctxTexture === undefined) {
      return undefined;
    }

    const textureOptions = node.props.textureOptions;

    //early exit for textures with no options unless its a subtexture
    if (
      texture.type !== TextureType.subTexture &&
      textureOptions === undefined
    ) {
      return (ctxTexture as WebGlCtxTexture).txCoords;
    }

    let { x1, x2, y1, y2 } = (ctxTexture as WebGlCtxTexture).txCoords;
    if (texture.type === TextureType.subTexture) {
      const { w: parentW, h: parentH } = (texture as SubTexture).parentTexture
        .dimensions!;
      const { x, y, w, h } = (texture as SubTexture).props;
      x1 = x / parentW;
      y1 = y / parentH;
      x2 = x1 + w / parentW;
      y2 = y1 + h / parentH;
    }

    const resizeMode = textureOptions.resizeMode;
    if (
      resizeMode !== undefined &&
      resizeMode.type === 'cover' &&
      texture.dimensions !== null
    ) {
      const dimensions = texture.dimensions as Dimensions;
      const w = node.props.w;
      const h = node.props.h;
      const scaleX = w / dimensions.w;
      const scaleY = h / dimensions.h;
      const scale = Math.max(scaleX, scaleY);
      const precision = 1 / scale;

      // Determine based on width
      if (scaleX < scale) {
        const desiredSize = precision * node.props.w;
        x1 = (1 - desiredSize / dimensions.w) * (resizeMode.clipX ?? 0.5);
        x2 = x1 + desiredSize / dimensions.w;
      }
      // Determine based on height
      if (scaleY < scale) {
        const desiredSize = precision * node.props.h;
        y1 = (1 - desiredSize / dimensions.h) * (resizeMode.clipY ?? 0.5);
        y2 = y1 + desiredSize / dimensions.h;
      }
    }

    if (textureOptions.flipX === true) {
      [x1, x2] = [x2, x1];
    }
    if (textureOptions.flipY === true) {
      [y1, y2] = [y2, y1];
    }
    return {
      x1,
      y1,
      x2,
      y2,
    };
  }

  /**
   * Resets all per-node quad buffer slot assignments and schedules a full GPU
   * buffer re-upload on the next render call.
   *
   * Called by Stage.requestRenderListUpdate() whenever the render list changes
   * structurally (node added, removed, or reordered). After this call, the
   * next addQuad() pass will reassign compact, contiguous slots starting from 0.
   */
  override invalidateQuadBuffer(): void {
    if (!DIRTY_QUAD_BUFFER) {
      return;
    }
    const renderList = this.stage.renderList;
    for (let i = 0, len = renderList.length; i < len; i++) {
      renderList[i]!.quadBufferIndex = -1;
      renderList[i]!.isQuadDirty = true;
    }
    this.curBufferIdx = 0;
    this.lastUploadedBufferSize = 0;
    this.needsFullUpload = true;
  }

  /**
   * Sets the glClearColor to the specified color.   *
   * @param color - The color to set as the clear color, represented as a 32-bit integer.
   */
  updateClearColor(color: number) {
    if (this.clearColor.raw === color) {
      return;
    }
    const glw = this.glw;
    const normalizedColor = getNormalizedRgbaComponents(color);
    glw.clearColor(
      normalizedColor[0],
      normalizedColor[1],
      normalizedColor[2],
      normalizedColor[3],
    );
    this.clearColor = {
      raw: color,
      normalized: normalizedColor,
    };
  }
}
