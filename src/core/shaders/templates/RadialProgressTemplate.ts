import type { CoreShaderType } from '../../renderers/CoreShaderNode.js';

/**
 * Properties of the {@link RadialProgress} shader
 */
export interface RadialProgressProps {
  /**
   * Stroke width of the ring in pixels
   *
   * @default 8
   */
  width: number;
  /**
   * Outer radius of the ring in pixels. When 0, auto-fits the node:
   * `min(node.w, node.h) / 2 - width / 2`
   *
   * @default 0
   */
  radius: number;
  /**
   * Portion of the ring that is filled, in `[0, 1]`
   *
   * @default 1
   */
  progress: number;
  /**
   * Angle (in radians) where the filled arc starts. `-PI/2` is 12 o'clock.
   *
   * @default -Math.PI / 2
   */
  startAngle: number;
  /**
   * Sweep direction. `1` = clockwise, `-1` = counter-clockwise.
   *
   * @default 1
   */
  direction: 1 | -1;
  /**
   * Colors swept along the filled arc.
   *
   * @default [0xffffffff]
   */
  colors: number[];
  /**
   * Color stops along the filled arc, in `[0, 1]`. Auto-distributed when omitted
   * or when length doesn't match `colors`.
   */
  stops: number[];
  /**
   * Background ring color (drawn under the full circle). `0x00000000` disables.
   *
   * @default 0x00000000
   */
  trackColor: number;
  /**
   * Arc end-cap style. `0` = butt, `1` = round.
   *
   * @default 1
   */
  cap: 0 | 1;
  /**
   * When > 0, the shader self-animates one full cycle every `duration` ms,
   * looping. Overrides the static `progress` prop. `0` disables (use `progress`).
   *
   * Pair with `countdown` to choose fill vs. drain.
   *
   * @default 0
   */
  duration: number;
  /**
   * Animation direction when `duration > 0`. `0` fills (0→1 over a cycle),
   * `1` drains (1→0 over a cycle). Ignored when `duration === 0`.
   *
   * @default 1
   */
  countdown: 0 | 1;
}

export const RadialProgressTemplate: CoreShaderType<RadialProgressProps> = {
  props: {
    width: 8,
    radius: 0,
    progress: {
      default: 1,
      resolve(value) {
        if (value === undefined) return this.default;
        if (value < 0) return 0;
        if (value > 1) return 1;
        return value;
      },
    },
    startAngle: -Math.PI / 2,
    direction: 1,
    colors: {
      default: [0xffffffff],
      resolve(value) {
        if (value !== undefined && value.length > 0) {
          return value;
        }
        return ([] as number[]).concat(this.default);
      },
    },
    stops: {
      default: [0],
      resolve(value, props) {
        if (value !== undefined && value.length === props.colors.length) {
          return value;
        }
        if (value === undefined) {
          value = [];
        }
        const len = props.colors.length;
        if (len === 1) {
          value[0] = 0;
          value.length = 1;
          return value;
        }
        for (let i = 0; i < len; i++) {
          value[i] = i * (1 / (len - 1));
        }
        value.length = len;
        return value;
      },
    },
    trackColor: 0x00000000,
    cap: 1,
    duration: {
      default: 0,
      resolve(value) {
        if (value === undefined) return this.default;
        if (value < 0) return 0;
        return value;
      },
    },
    countdown: 1,
  },
};
