import type { CoreNode } from '../../CoreNode.js';
import { SubTexture } from '../../textures/SubTexture.js';
import { TextureType, type Texture } from '../../textures/Texture.js';
import type { CoreContextTexture } from '../CoreContextTexture.js';
import {
  CoreRenderer,
  type CoreRendererOptions,
  type RendererCapabilities,
} from '../CoreRenderer.js';
import { CanvasTexture } from './CanvasTexture.js';
import { parseColor } from '../../lib/colorParser.js';
import { CanvasShaderNode, type CanvasShaderType } from './CanvasShaderNode.js';
import { normalizeCanvasColor } from '../../lib/colorCache.js';

export class CanvasRenderer extends CoreRenderer {
  private context: CanvasRenderingContext2D;
  private canvas: HTMLCanvasElement;
  private pixelRatio: number;
  private clearColor: string;
  public renderToTextureActive = false;
  activeRttNode: CoreNode | null = null;

  constructor(options: CoreRendererOptions) {
    super(options);

    this.mode = 'canvas';
    const { canvas } = options;
    this.canvas = canvas as HTMLCanvasElement;
    this.context = canvas.getContext('2d') as CanvasRenderingContext2D;
    this.pixelRatio = this.stage.pixelRatio;
    this.clearColor = normalizeCanvasColor(this.stage.clearColor);
  }

  reset(): void {
    this.canvas.width = this.canvas.width; // quick reset canvas

    const ctx = this.context;

    if (this.clearColor) {
      ctx.fillStyle = this.clearColor;
      ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    }

    ctx.scale(this.pixelRatio, this.pixelRatio);
  }

  render(): void {
    // noop
  }

  addQuad(node: CoreNode): void {
    const ctx = this.context;
    const { tx, ty, ta, tb, tc, td } = node.globalTransform!;
    const clippingRect = node.clippingRect;
    // While a placeholder is showing, render the color-rect path (the default
    // ColorTexture) tinted by the node's premultiplied placeholder color.
    let texture = (
      node.placeholderActive === true
        ? this.stage.defaultTexture
        : node.props.texture || this.stage.defaultTexture
    ) as Texture;
    // The Canvas2D renderer only supports image textures, no textures are used for color blocks
    if (texture !== null) {
      const textureType = texture.type;
      if (
        textureType !== TextureType.image &&
        textureType !== TextureType.subTexture &&
        textureType !== TextureType.color &&
        textureType !== TextureType.noise
      ) {
        return;
      }
    }

    const hasTransform = ta !== 1;
    const clippingValid = clippingRect.valid === true;

    // If the clipping rect is valid but zero-area, the node is fully clipped — skip rendering
    if (
      clippingValid === true &&
      clippingRect.w === 0 &&
      clippingRect.h === 0
    ) {
      return;
    }

    const hasClipping =
      clippingValid === true && clippingRect.w !== 0 && clippingRect.h !== 0;
    const shader = node.props.shader;
    const hasShader = shader !== null;

    let saveAndRestore = hasTransform === true || hasClipping === true;
    if (hasShader === true) {
      saveAndRestore = saveAndRestore || (shader as CanvasShaderNode).applySNR;
    }

    if (saveAndRestore) {
      ctx.save();
    }

    if (hasClipping === true) {
      const path = new Path2D();
      const { x, y, w, h } = clippingRect;
      path.rect(x, y, w, h);
      ctx.clip(path);
    }

    if (hasTransform === true) {
      // Quad transform:
      // | ta tb tx |
      // | tc td ty |
      // | 0  0  1  |
      // C2D transform:
      // | a  c  e  |
      // | b  d  f  |
      // | 0  0  1  |
      const scale = this.pixelRatio;
      ctx.setTransform(ta, tc, tb, td, tx * scale, ty * scale);
      ctx.scale(scale, scale);
      ctx.translate(-tx, -ty);
    }

    if (hasShader === true) {
      let renderContext: (() => void) | null = () => {
        this.renderContext(node, texture);
      };

      (shader as CanvasShaderNode).render(ctx, node, renderContext);
      renderContext = null;
    } else {
      this.renderContext(node, texture);
    }

    if (saveAndRestore) {
      ctx.restore();
    }
  }

  renderContext(node: CoreNode, texture: Texture) {
    const color = node.premultipliedColorTl;
    const textureType = texture.type;
    const tx = node.globalTransform!.tx;
    const ty = node.globalTransform!.ty;
    const width = node.props.w;
    const height = node.props.h;

    if (textureType !== TextureType.color) {
      const tintColor = parseColor(color);
      let image: ImageBitmap | HTMLCanvasElement | HTMLImageElement | null;

      if (textureType === TextureType.subTexture) {
        image = (
          (texture as SubTexture).parentTexture.ctxTexture as CanvasTexture
        ).getImage(tintColor);
      } else {
        image = (texture.ctxTexture as CanvasTexture).getImage(tintColor);
      }

      // The texture can disappear while an async load/fetch is racing (e.g. 404);
      // skip drawing this frame instead of dereferencing an invalid image object.
      if (image === null || image === undefined) {
        return;
      }

      const imageWidth = image.width;
      const imageHeight = image.height;
      if (
        typeof imageWidth !== 'number' ||
        typeof imageHeight !== 'number' ||
        imageWidth <= 0 ||
        imageHeight <= 0
      ) {
        return;
      }

      this.context.globalAlpha = tintColor.a ?? node.worldAlpha;

      const txCoords = node.textureCoords;
      if (txCoords) {
        const ix = imageWidth;
        const iy = imageHeight;

        let sx = txCoords.x1 * ix;
        let sy = txCoords.y1 * iy;
        let sw = (txCoords.x2 - txCoords.x1) * ix;
        let sh = (txCoords.y2 - txCoords.y1) * iy;

        let flipX = false;
        let flipY = false;

        if (sw < 0) {
          flipX = true;
          sx += sw;
          sw = Math.abs(sw);
        }
        if (sh < 0) {
          flipY = true;
          sy += sh;
          sh = Math.abs(sh);
        }

        if (flipX || flipY) {
          this.context.save();
          this.context.translate(
            tx + (flipX ? width : 0),
            ty + (flipY ? height : 0),
          );
          this.context.scale(flipX ? -1 : 1, flipY ? -1 : 1);
          this.context.drawImage(image, sx, sy, sw, sh, 0, 0, width, height);
          this.context.restore();
        } else {
          this.context.drawImage(image, sx, sy, sw, sh, tx, ty, width, height);
        }
      } else {
        this.context.drawImage(image, tx, ty, width, height);
      }
      this.context.globalAlpha = 1;
      return;
    }
    const hasGradient =
      node.premultipliedColorTl !== node.premultipliedColorTr ||
      node.premultipliedColorTl !== node.premultipliedColorBr;
    if (hasGradient === true) {
      let endX: number = tx;
      let endY: number = ty;
      let endColor: number;
      if (node.premultipliedColorTl === node.premultipliedColorTr) {
        // vertical
        endX = tx;
        endY = ty + height;
        endColor = node.premultipliedColorBr;
      } else {
        // horizontal
        endX = tx + width;
        endY = ty;
        endColor = node.premultipliedColorTr;
      }

      let startColor = color;
      const startAlpha = (startColor >>> 24) & 0xff;
      const endAlpha = (endColor >>> 24) & 0xff;

      // if one of the colors has 0 alpha, we want to match the RGB channels
      // to the other color to prevent white bleed during zero alpha interpolation.
      if (startAlpha === 0 && endAlpha > 0) {
        startColor =
          ((startColor & 0xff000000) | (endColor & 0x00ffffff)) >>> 0;
      } else if (endAlpha === 0 && startAlpha > 0) {
        endColor = ((endColor & 0xff000000) | (startColor & 0x00ffffff)) >>> 0;
      }

      const gradient = this.context.createLinearGradient(tx, ty, endX, endY);
      gradient.addColorStop(0, normalizeCanvasColor(startColor));
      gradient.addColorStop(1, normalizeCanvasColor(endColor));
      this.context.fillStyle = gradient;
      this.context.fillRect(tx, ty, width, height);
    } else {
      this.context.fillStyle = normalizeCanvasColor(color);
      this.context.fillRect(tx, ty, width, height);
    }
  }

  createShaderNode(
    shaderKey: string,
    shaderType: Readonly<CanvasShaderType>,
    props?: Record<string, any>,
  ) {
    return new CanvasShaderNode(shaderKey, shaderType, this.stage, props);
  }

  createShaderProgram(_shaderConfig) {
    return null;
  }

  override supportsShaderType(shaderType: Readonly<CanvasShaderType>): boolean {
    return shaderType.render !== undefined;
  }

  createCtxTexture(textureSource: Texture): CoreContextTexture {
    return new CanvasTexture(this.stage.txMemManager, textureSource);
  }

  renderRTTNodes(): void {
    // noop
  }

  removeRTTNode(_node: CoreNode): void {
    // noop
  }

  renderToTexture(_node: CoreNode): void {
    // noop
  }
  getBufferInfo(): null {
    return null;
  }

  getQuadCount(): null {
    return null;
  }

  getRenderOpCount(): null {
    return null;
  }

  getCapabilities(): RendererCapabilities {
    return {
      renderMode: 'canvas',
      webGlVersion: null,
      vertexArrayObject: false,
      maxTextureSize: 0,
      maxTextureUnits: 0,
    };
  }

  // Canvas2D has no GPU out-of-memory signal to probe.
  checkForOutOfMemory(): boolean {
    return false;
  }

  /**
   * Updates the clear color of the canvas renderer.
   *
   * @param color - The color to set as the clear color.
   */
  updateClearColor(color: number) {
    this.clearColor = normalizeCanvasColor(color);
  }

  override getTextureCoords(
    node: CoreNode,
  ): import('../../textures/Texture.js').TextureCoords | undefined {
    const texture = node.texture;
    if (texture === null) {
      return undefined;
    }

    const ctxTexture =
      texture.type === TextureType.subTexture
        ? (texture as SubTexture).parentTexture.ctxTexture
        : texture.ctxTexture;
    if (ctxTexture === undefined) {
      return undefined;
    }

    const textureOptions = node.props.textureOptions;

    // early exit for textures with no options unless its a subtexture
    if (
      texture.type !== TextureType.subTexture &&
      textureOptions === undefined
    ) {
      return { x1: 0, y1: 0, x2: 1, y2: 1 };
    }

    let x1 = 0,
      y1 = 0,
      x2 = 1,
      y2 = 1;
    if (texture.type === TextureType.subTexture) {
      const { w: parentW, h: parentH } = (texture as SubTexture).parentTexture
        .dimensions!;
      const { x, y, w, h } = (texture as SubTexture).props;
      x1 = x / parentW;
      y1 = y / parentH;
      x2 = x1 + w / parentW;
      y2 = y1 + h / parentH;
    }

    if (textureOptions !== undefined && textureOptions !== null) {
      const resizeMode = textureOptions.resizeMode;
      if (
        resizeMode !== undefined &&
        resizeMode.type === 'cover' &&
        texture.dimensions !== null
      ) {
        const dimensions =
          texture.dimensions as import('../../../common/CommonTypes.js').Dimensions;
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
    }

    return {
      x1,
      y1,
      x2,
      y2,
    };
  }

  override updateViewport(): void {
    // noop
  }

  getDefaultShaderNode() {
    return null;
  }
}
