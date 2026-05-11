import type { CoreTextureManager } from '../CoreTextureManager.js';
import { Texture, TextureType, type TextureData } from './Texture.js';

/**
 * Properties of the {@link ColorTexture}
 */
export interface ColorTextureProps {
  /**
   * Color to use to generate the texture
   *
   * @default 0xffffffff (opaque white)
   */
  color?: number;
}

/**
 * Texture consisting of only a 1x1 color pixel
 *
 * @remarks
 * The pixel color is set with the {@link ColorTextureProps.color} prop.
 *
 * This is the default texture used for a Node if it's
 * {@link INodeProps.texture} prop is set to `null` (the default)
 *
 * Generally the 1x1 color pixel is stretched to whatever the set dimensions of
 * a Node are.
 */
export class ColorTexture extends Texture {
  public override type: TextureType = TextureType.color;

  props: Required<ColorTextureProps>;

  constructor(
    txManager: CoreTextureManager,
    props: Required<ColorTextureProps>,
  ) {
    super(txManager);
    this.props = props;
  }

  get color() {
    return this.props.color;
  }

  set color(color: number) {
    this.props.color = color;
  }

  override async getTextureSource(): Promise<TextureData> {
    const pixelData = new Uint8Array(4);

    if (this.color === 0xffffffff) {
      pixelData[0] = 255;
      pixelData[1] = 255;
      pixelData[2] = 255;
      pixelData[3] = 255;
    } else {
      pixelData[0] = (this.color >> 16) & 0xff; // Red
      pixelData[1] = (this.color >> 8) & 0xff; // Green
      pixelData[2] = this.color & 0xff; // Blue
      pixelData[3] = (this.color >>> 24) & 0xff; // Alpha
    }

    this.setState('fetched', { w: 1, h: 1 });

    return {
      data: pixelData,
      premultiplyAlpha: true,
    };
  }

  static override makeCacheKey(props: ColorTextureProps): string {
    // Mirror the default from resolveDefaults so the key is stable whether
    // or not the caller has run defaults first.
    return `ColorTexture,${props.color || 0xffffffff}`;
  }

  static override resolveDefaults(
    props: ColorTextureProps,
  ): Required<ColorTextureProps> {
    return {
      color: props.color || 0xffffffff,
    };
  }

  static z$__type__Props: ColorTextureProps;
}
