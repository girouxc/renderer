import type { WebGlContextWrapper } from '../../lib/WebGlContextWrapper.js';
import { USE_RTT } from '../../../utils.js';
import { Default } from '../../shaders/webgl/Default.js';
import type { CoreShaderProgram } from '../CoreShaderProgram.js';
import type { WebGlCtxTexture } from './WebGlCtxTexture.js';
import type { WebGlRenderer, WebGlRenderOp } from './WebGlRenderer.js';
import type { WebGlShaderType } from './WebGlShaderNode.js';
import { WebGlShaderNode } from './WebGlShaderNode.js';
import type { BufferCollection } from './internal/BufferCollection.js';
import {
  createProgram,
  createShader,
  type UniformSet1Param,
  type UniformSet2Params,
  type UniformSet3Params,
  type UniformSet4Params,
} from './internal/ShaderUtils.js';
import { CoreNode } from '../../CoreNode.js';

export class WebGlShaderProgram implements CoreShaderProgram {
  protected program: WebGLProgram | null;
  protected renderer: WebGlRenderer;
  protected glw: WebGlContextWrapper;
  protected attributeLocations: string[];
  protected uniformLocations: Record<string, WebGLUniformLocation> | null;
  protected lifecycle: Pick<WebGlShaderType, 'update' | 'canBatch'>;
  protected useSystemAlpha = false;
  protected useSystemDimensions = false;
  protected useTimeValue = false;
  public isDestroyed = false;
  supportsIndexedTextures = false;

  /**
   * Cached Vertex Array Objects, keyed by the buffer collection they capture.
   *
   * @remarks
   * A VAO records this program's attribute layout (enabled arrays, pointers and
   * their source buffers) plus the shared element index buffer, so a draw only
   * needs a single `bindVertexArray` instead of re-pointing every attribute. In
   * practice a program only ever binds one collection, but keying by collection
   * keeps it correct if that ever changes. Empty / unused when the context has
   * no VAO support (see {@link WebGlContextWrapper.canUseVertexArrayObject}).
   */
  protected vaos = new Map<BufferCollection, WebGLVertexArrayObject | null>();

  constructor(
    renderer: WebGlRenderer,
    config: WebGlShaderType,
    resolvedProps: Record<string, any>,
  ) {
    this.renderer = renderer;
    const glw = (this.glw = renderer.glw);

    this.supportsIndexedTextures =
      config.supportsIndexedTextures || this.supportsIndexedTextures;

    // Check that required extensions are supported
    const requiredExtensions = config.webgl1Extensions || [];
    requiredExtensions.forEach((extensionName) => {
      if (!glw.getExtension(extensionName)) {
        throw new Error(
          `Shader "${this.constructor.name}" requires extension "${extensionName}" for WebGL 1.0 but wasn't found`,
        );
      }
    });

    let vertexSource =
      config.vertex instanceof Function
        ? config.vertex(renderer, resolvedProps)
        : config.vertex;

    if (vertexSource === undefined) {
      vertexSource = Default.vertex as string;
    }

    const fragmentSource =
      config.fragment instanceof Function
        ? config.fragment(renderer, resolvedProps)
        : config.fragment;

    const vertexShader = createShader(glw, glw.VERTEX_SHADER, vertexSource);
    if (!vertexShader) {
      throw new Error('Vertex shader creation failed');
    }

    const fragmentShader = createShader(
      glw,
      glw.FRAGMENT_SHADER,
      fragmentSource,
    );

    if (!fragmentShader) {
      throw new Error('fragment shader creation failed');
    }

    const program = createProgram(glw, vertexShader, fragmentShader);
    this.program = program;
    this.attributeLocations = glw.getAttributeLocations(program);

    const uniLocs = (this.uniformLocations = glw.getUniformLocations(program));

    this.useSystemAlpha = uniLocs['u_alpha'] !== undefined;
    this.useSystemDimensions = uniLocs['u_dimensions'] !== undefined;

    this.useTimeValue =
      this.glw.getUniformLocation(program, 'u_dimensions') !== null &&
      config.time !== undefined;

    this.lifecycle = {
      update: config.update,
      canBatch: config.canBatch,
    };
  }

  disableAttribute(location: number) {
    this.glw.disableVertexAttribArray(location);
  }

  disableAttributes() {
    const glw = this.glw;
    const attribLen = this.attributeLocations.length;
    for (let i = 0; i < attribLen; i++) {
      glw.disableVertexAttribArray(i);
    }
  }

  reuseRenderOp(node: CoreNode, currentRenderOp: WebGlRenderOp): boolean {
    if (this.lifecycle.canBatch !== undefined) {
      return this.lifecycle.canBatch(node, currentRenderOp);
    }

    const { time, worldAlpha, w, h } = node;

    if (this.useTimeValue === true) {
      if (time !== currentRenderOp.time) {
        return false;
      }
    }

    if (this.useSystemAlpha === true) {
      if (worldAlpha !== currentRenderOp.worldAlpha) {
        return false;
      }
    }

    if (this.useSystemDimensions === true) {
      if (w !== currentRenderOp.w || h !== currentRenderOp.h) {
        return false;
      }
    }

    let shaderPropsA: Record<string, unknown> | undefined = undefined;
    let shaderPropsB: Record<string, unknown> | undefined = undefined;

    const shader = node.props.shader;

    if (shader !== null) {
      shaderPropsA = (shader as WebGlShaderNode).resolvedProps;
    }

    const opShader = currentRenderOp.shader;
    if (opShader !== null) {
      shaderPropsB = (opShader as WebGlShaderNode).resolvedProps;
    }

    if (
      (shaderPropsA === undefined && shaderPropsB !== undefined) ||
      (shaderPropsA !== undefined && shaderPropsB === undefined)
    ) {
      return false;
    }

    if (shaderPropsA !== undefined && shaderPropsB !== undefined) {
      for (const key in shaderPropsA) {
        if (shaderPropsA[key] !== shaderPropsB[key]) {
          return false;
        }
      }
    }

    return true;
  }

  bindRenderOp(renderOp: WebGlRenderOp) {
    const isCoreNode = renderOp.isCoreNode;

    this.bindTextures(renderOp.renderOpTextures);
    this.bindBufferCollection(renderOp.quadBufferCollection);

    const parentHasRenderTexture = renderOp.parentHasRenderTexture;
    const framebufferDimensions =
      isCoreNode && renderOp.parentHasRenderTexture
        ? renderOp.parentFramebufferDimensions
        : renderOp.framebufferDimensions;

    // Skip if the parent and current operation both have render textures
    if (USE_RTT && renderOp.rtt === true && parentHasRenderTexture === true) {
      return;
    }

    // Bind render texture framebuffer dimensions as resolution
    // if the parent has a render texture
    if (USE_RTT && parentHasRenderTexture === true && framebufferDimensions) {
      const { w, h } = framebufferDimensions;
      // Force pixel ratio to 1.0 for render textures since they are always 1:1
      // the final render texture will be rendered to the screen with the correct pixel ratio
      this.glw.uniform1f('u_pixelRatio', 1.0);

      // Set resolution to the framebuffer dimensions
      this.glw.uniform2f('u_resolution', w, h);
    } else {
      this.glw.uniform1f('u_pixelRatio', renderOp.stage.pixelRatio);

      this.glw.uniform2f(
        'u_resolution',
        this.glw.canvas.width,
        this.glw.canvas.height,
      );
    }

    if (this.useTimeValue === true) {
      this.glw.uniform1f('u_time', renderOp.time);
    }

    if (this.useSystemAlpha === true) {
      this.glw.uniform1f('u_alpha', renderOp.worldAlpha);
    }

    if (this.useSystemDimensions === true) {
      this.glw.uniform2f('u_dimensions', renderOp.w, renderOp.h);
    }

    const shader = renderOp.shader as WebGlShaderNode;
    if (shader.props !== undefined) {
      /**
       * loop over all precalculated uniform types
       */
      const uniforms = shader.uniforms;

      for (const key in uniforms.single) {
        const { method, value } = uniforms.single[key]!;
        this.glw[method as keyof UniformSet1Param](key, value as never);
      }

      for (const key in uniforms.vec2) {
        const { method, value } = uniforms.vec2[key]!;
        this.glw[method as keyof UniformSet2Params](key, value[0], value[1]);
      }

      for (const key in uniforms.vec3) {
        const { method, value } = uniforms.vec3[key]!;
        this.glw[method as keyof UniformSet3Params](
          key,
          value[0],
          value[1],
          value[2],
        );
      }

      for (const key in uniforms.vec4) {
        const { method, value } = uniforms.vec4[key]!;
        this.glw[method as keyof UniformSet4Params](
          key,
          value[0],
          value[1],
          value[2],
          value[3],
        );
      }
    }
  }

  bindBufferCollection(buffer: BufferCollection) {
    const { glw } = this;

    if (glw.canUseVertexArrayObject === true) {
      let vao = this.vaos.get(buffer);
      if (vao === undefined) {
        // First draw with this collection: try to capture the attribute layout
        // in a VAO. Cache the result — including a null on allocation failure,
        // so we don't retry createVertexArray every frame.
        vao = this.createVao(buffer);
        this.vaos.set(buffer, vao);
      }
      if (vao !== null) {
        // createVao leaves a freshly built VAO bound; re-binding is cheap and
        // keeps the build and reuse paths identical.
        glw.bindVertexArray(vao);
        return;
      }
      // VAO allocation failed (e.g. under GL OOM). Bind the default VAO so the
      // per-draw attribute setup below records into it rather than corrupting
      // another program's cached VAO, then fall through.
      glw.bindVertexArray(null);
    }

    // No (usable) VAO: re-point every attribute on each draw.
    this.bindAttributes(buffer);
  }

  /**
   * Point this program's vertex attributes at the given buffer collection.
   * When a VAO is bound this records into it; otherwise it mutates global state.
   */
  private bindAttributes(buffer: BufferCollection) {
    const { glw } = this;
    const attribs = this.attributeLocations;
    const attribLen = attribs.length;

    for (let i = 0; i < attribLen; i++) {
      const name = attribs[i]!;
      const resolvedBuffer = buffer.getBuffer(name);
      const resolvedInfo = buffer.getAttributeInfo(name);
      if (resolvedBuffer === undefined || resolvedInfo === undefined) {
        continue;
      }
      glw.enableVertexAttribArray(i);
      glw.vertexAttribPointer(
        resolvedBuffer,
        i,
        resolvedInfo.size,
        resolvedInfo.type,
        resolvedInfo.normalized,
        resolvedInfo.stride,
        resolvedInfo.offset,
      );
    }
  }

  /**
   * Create and populate a Vertex Array Object capturing this program's
   * attribute layout for the given buffer collection. The new VAO is left bound.
   * Returns null if the context reports VAO support but allocation fails (e.g.
   * under GL OOM), in which case the caller falls back to per-draw binding.
   */
  private createVao(buffer: BufferCollection): WebGLVertexArrayObject | null {
    const { glw } = this;
    const vao = glw.createVertexArray();
    if (vao === null) {
      return null;
    }
    glw.bindVertexArray(vao);

    this.bindAttributes(buffer);

    // The element-array binding is part of VAO state and starts out null on a
    // fresh VAO, so record the shared index buffer into it or indexed
    // drawElements would read from no buffer.
    glw.bindElementArrayBuffer(this.renderer.indexBuffer);

    return vao;
  }

  bindTextures(textures: WebGlCtxTexture[]) {
    const t = textures[0];
    if (t === undefined) {
      return;
    }
    this.glw.activeTexture(0);
    this.glw.bindTexture(t.ctxTexture);
  }

  attach(): void {
    if (this.isDestroyed === true) {
      return;
    }
    this.glw.useProgram(this.program, this.uniformLocations!);
  }

  detach(): void {
    // With VAOs the enabled-attribute state lives in each per-collection VAO,
    // not in global context state. Disabling here would mutate whichever VAO is
    // currently bound and corrupt it for the next draw, so there's nothing to
    // do on a program switch.
    if (this.glw.canUseVertexArrayObject === true) {
      return;
    }
    this.disableAttributes();
  }

  destroy() {
    if (this.isDestroyed === true) {
      return;
    }
    const glw = this.glw;

    this.detach();

    for (const vao of this.vaos.values()) {
      if (vao !== null) {
        glw.deleteVertexArray(vao);
      }
    }
    this.vaos.clear();

    glw.deleteProgram(this.program!);
    this.program = null;
    this.uniformLocations = null;

    const attribs = this.attributeLocations;
    const attribLen = this.attributeLocations.length;
    for (let i = 0; i < attribLen; i++) {
      this.glw.deleteBuffer(attribs[i]!);
    }
  }
}
