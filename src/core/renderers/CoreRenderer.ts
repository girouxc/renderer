import type { CoreNode } from '../CoreNode.js';
import type { Stage } from '../Stage.js';
import type { ContextSpy } from '../lib/ContextSpy.js';
import type { CoreShaderProgram } from './CoreShaderProgram.js';
import type { Texture, TextureCoords } from '../textures/Texture.js';
import { CoreContextTexture } from './CoreContextTexture.js';
import type { CoreShaderType, CoreShaderNode } from './CoreShaderNode.js';

export interface CoreRendererOptions {
  stage: Stage;
  canvas: HTMLCanvasElement | OffscreenCanvas;
  contextSpy: ContextSpy | null;
  forceWebGL2: boolean;
}

export interface BufferInfo {
  totalUsed: number;
  totalAvailable: number;
}

/**
 * Backend and device capabilities of an active renderer.
 *
 * @remarks
 * Intended as a one-shot startup diagnostic (some fields are GL round-trips,
 * see {@link CoreRenderer.getCapabilities}). Useful for confirming which
 * rendering path a given device actually took (e.g. whether Vertex Array
 * Objects engaged) and for logging device limits from the field.
 */
export interface RendererCapabilities {
  /** Active rendering backend. */
  renderMode: 'webgl' | 'canvas';
  /**
   * WebGL major version of the active context (`1` or `2`), or `null` for the
   * Canvas2D backend.
   */
  webGlVersion: 1 | 2 | null;
  /**
   * Whether attribute layout is cached in Vertex Array Objects (native WebGL2
   * or the `OES_vertex_array_object` WebGL1 extension). `false` on Canvas2D or
   * when neither is available.
   */
  vertexArrayObject: boolean;
  /** Maximum texture dimension in pixels (`0` when not applicable). */
  maxTextureSize: number;
  /** Maximum simultaneously bound texture units (`0` when not applicable). */
  maxTextureUnits: number;
}

export abstract class CoreRenderer {
  public options: CoreRendererOptions;
  public mode: 'webgl' | 'canvas' | undefined;
  defaultTextureCoords: TextureCoords | undefined = undefined;
  readonly stage: Stage;

  //// Core Managers
  rttNodes: CoreNode[] = [];

  constructor(options: CoreRendererOptions) {
    this.options = options;
    this.stage = options.stage;
  }

  abstract reset(): void;
  abstract render(surface?: 'screen' | CoreContextTexture): void;
  abstract addQuad(node: CoreNode): void;
  abstract createCtxTexture(textureSource: Texture): CoreContextTexture;
  abstract createShaderProgram(
    shaderConfig: Readonly<CoreShaderType>,
    props?: Record<string, unknown>,
  ): CoreShaderProgram | null;
  abstract createShaderNode(
    shaderKey: string,
    shaderType: Readonly<CoreShaderType>,
    props?: Record<string, unknown>,
    program?: CoreShaderProgram,
  ): CoreShaderNode;
  abstract supportsShaderType(shaderType: Readonly<CoreShaderType>): boolean;
  abstract getDefaultShaderNode(): CoreShaderNode | null;
  abstract get renderToTextureActive(): boolean;
  abstract get activeRttNode(): CoreNode | null;
  abstract renderRTTNodes(): void;
  abstract removeRTTNode(node: CoreNode): void;
  abstract renderToTexture(node: CoreNode): void;
  abstract getBufferInfo(): BufferInfo | null;
  abstract getQuadCount(): number | null;
  abstract getRenderOpCount(): number | null;
  /**
   * Report the active backend and device capabilities.
   *
   * @remarks
   * Reads live GL parameters, which are CPU↔GPU round-trips, so call this once
   * at startup (e.g. to log) rather than per frame.
   */
  abstract getCapabilities(): RendererCapabilities;
  abstract updateViewport(): void;
  abstract updateClearColor(color: number): void;
  getTextureCoords?(node: CoreNode): TextureCoords | undefined;

  /**
   * Optional hook called when the render list changes structurally
   * (node added / removed / reordered). Implementations may use this to
   * invalidate any cached GPU buffer layouts and force a full re-upload
   * on the next render call.
   */
  invalidateQuadBuffer?(): void;

  /**
   * Probe the backend for a GPU out-of-memory condition since the last call.
   * Returns `true` when an out-of-memory was seen. Backends that cannot detect
   * this (e.g. Canvas2D) return `false`.
   *
   * @remarks
   * Called once per frame by the Stage. Backends where the probe is expensive
   * (a CPU/GPU sync, e.g. WebGL `gl.getError()`) rely on this once-per-frame
   * cadence rather than checking per draw/upload.
   */
  abstract checkForOutOfMemory(): boolean;
}
