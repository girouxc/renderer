import type { CoreShaderType } from '../../renderers/CoreShaderNode.js';
import type { Vec4 } from '../../renderers/webgl/internal/ShaderUtils.js';
import { validateArrayLength4, type PrefixedType } from '../utils.js';

/**
 * Properties of the {@link Border} shader
 */
export interface BorderProps {
  /**
   * Width of the border in pixels
   *
   * @default 0
   */
  w: number | [number, number, number, number];
  /**
   * Color of the border in 0xRRGGBBAA
   *
   * @default 0xffffffff
   */
  color: number;
  /**
   * Alignment of the border
   *
   * @default 'outside'
   */
  align: number | 'inside' | 'center' | 'outside';
  /**
   * Gap between node and border baseline. Default is 0. and generally edge of node)
   */
  gap: number;
  /**
   * Top width
   */
  top: number;
  /**
   * Right width
   */
  right: number;
  /**
   * Bottom width
   */
  bottom: number;
  /**
   * Left width
   */
  left: number;
}

export function getBorderProps<P extends string>(
  prefix?: P,
): PrefixedType<BorderProps, P> {
  const pf = prefix && prefix.length > 0 ? `${prefix}-` : '';
  const w = pf + 'w';
  return {
    [w]: {
      default: [0, 0, 0, 0],
      resolve(value) {
        if (value !== undefined) {
          return validateArrayLength4(value);
        }
        return ([] as number[]).concat(this.default);
      },
    },
    [pf + 'color']: 0xffffffff,
    [pf + 'align']: {
      default: 1, //outside,
      resolve(value) {
        if (!isNaN(value)) {
          return value as number;
        }
        if (typeof value === 'string') {
          switch (value) {
            case 'inside':
              return 0;
            case 'center':
              return 0.5;
            case 'outside':
              return 1;
          }
        }
        return this.default;
      },
    },
    [pf + 'gap']: 0,
    [pf + 'top']: {
      default: 0,
      set(value, props) {
        (props[w] as Vec4)[0] = value;
      },
      get(props) {
        return (props[w] as Vec4)[0];
      },
    },
    [pf + 'right']: {
      default: 0,
      set(value, props) {
        (props[w] as Vec4)[1] = value;
      },
      get(props) {
        return (props[w] as Vec4)[1];
      },
    },
    [pf + 'bottom']: {
      default: 0,
      set(value, props) {
        (props[w] as Vec4)[2] = value;
      },
      get(props) {
        return (props[w] as Vec4)[2];
      },
    },
    [pf + 'left']: {
      default: 0,
      set(value, props) {
        (props[w] as Vec4)[3] = value;
      },
      get(props) {
        return (props[w] as Vec4)[3];
      },
    },
  } as PrefixedType<BorderProps, P>;
}

type PlainBorderProps = PrefixedType<BorderProps>;

export const BorderTemplate: CoreShaderType<BorderProps> = {
  props: getBorderProps() as PlainBorderProps,
};
