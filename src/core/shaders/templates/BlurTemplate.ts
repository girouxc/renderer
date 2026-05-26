import type { CoreShaderType } from '../../renderers/CoreShaderNode.js';

/**
 * Properties of the {@link Blur} shader.
 *
 * Intended for nodes with an Image Texture. Applying it to color-only or text
 * nodes will just blur the solid fill.
 */
export interface BlurProps {
  /**
   * Blur amount in node-space pixels.
   *
   * Single-pass kernel — small values (1-8) look best. Larger values still
   * work but lose smoothness because there are only 9 samples per pixel.
   *
   * @default 4
   */
  amount: number;
}

export const BlurTemplate: CoreShaderType<BlurProps> = {
  props: {
    amount: 4,
  },
};
