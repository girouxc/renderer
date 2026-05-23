import type { CoreNode } from '../../CoreNode.js';
import { getNormalizedRgbaComponents } from '../../lib/utils.js';
import {
  RadialProgressTemplate,
  type RadialProgressProps,
} from '../templates/RadialProgressTemplate.js';
import type { WebGlShaderType } from '../../renderers/webgl/WebGlShaderNode.js';
import type { WebGlRenderer } from '../../renderers/webgl/WebGlRenderer.js';

export const RadialProgress: WebGlShaderType<RadialProgressProps> = {
  props: RadialProgressTemplate.props,
  time: true,
  update(node: CoreNode) {
    const props = this.props!;

    const autoRadius = Math.min(node.w, node.h) * 0.5 - props.width * 0.5;
    const radius = props.radius > 0 ? props.radius : autoRadius;

    this.uniform2f('u_center', node.w * 0.5, node.h * 0.5);
    this.uniform1f('u_radius', radius);
    this.uniform1f('u_width', props.width);
    this.uniform1f('u_progress', props.progress);
    this.uniform1f('u_startAngle', props.startAngle);
    this.uniform1f('u_direction', props.direction);
    this.uniform1f('u_duration', props.duration);
    this.uniform1f('u_countdown', props.countdown);
    this.uniform1fv('u_stops', new Float32Array(props.stops));

    const colors: number[] = [];
    for (let i = 0; i < props.colors.length; i++) {
      const norm = getNormalizedRgbaComponents(props.colors[i]!);
      colors.push(norm[0]!, norm[1]!, norm[2]!, norm[3]!);
    }
    this.uniform4fv('u_colors', new Float32Array(colors));

    const trackNorm = getNormalizedRgbaComponents(props.trackColor);
    this.uniform4f(
      'u_trackColor',
      trackNorm[0]!,
      trackNorm[1]!,
      trackNorm[2]!,
      trackNorm[3]!,
    );
  },
  getCacheMarkers(props: RadialProgressProps) {
    return `colors:${props.colors.length}|cap:${props.cap}|track:${
      props.trackColor !== 0 ? 1 : 0
    }`;
  },
  fragment(renderer: WebGlRenderer, props: RadialProgressProps) {
    const maxStops = Math.max(props.colors.length, 1);
    return `
      # ifdef GL_FRAGMENT_PRECISION_HIGH
      precision highp float;
      # else
      precision mediump float;
      # endif

      #define MAX_STOPS ${maxStops}
      #define LAST_STOP ${maxStops - 1}
      #define CAP_ROUND ${props.cap}
      #define HAS_TRACK ${props.trackColor !== 0 ? 1 : 0}

      #define TWO_PI 6.28318530717958647692

      uniform float u_alpha;
      uniform float u_time;
      uniform vec2 u_dimensions;
      uniform sampler2D u_texture;

      uniform vec2 u_center;
      uniform float u_radius;
      uniform float u_width;
      uniform float u_progress;
      uniform float u_startAngle;
      uniform float u_direction;
      uniform float u_duration;
      uniform float u_countdown;

      uniform float u_stops[MAX_STOPS];
      uniform vec4 u_colors[MAX_STOPS];
      uniform vec4 u_trackColor;

      varying vec4 v_color;
      varying vec2 v_textureCoords;
      varying vec2 v_nodeCoords;

      vec4 getGradientColor(float dist) {
        dist = clamp(dist, 0.0, 1.0);

        if (dist <= u_stops[0]) {
          return u_colors[0];
        }
        if (dist >= u_stops[LAST_STOP]) {
          return u_colors[LAST_STOP];
        }
        for (int i = 0; i < LAST_STOP; i++) {
          float left = u_stops[i];
          float right = u_stops[i + 1];
          if (dist >= left && dist <= right) {
            float lDist = smoothstep(left, right, dist);
            return mix(u_colors[i], u_colors[i + 1], lDist);
          }
        }
        return u_colors[LAST_STOP];
      }

      // Coverage of a disc centered at \`c\` with radius \`r\` at pixel \`p\` (with 1px AA)
      float discCoverage(vec2 p, vec2 c, float r) {
        return 1.0 - smoothstep(r - 1.0, r + 1.0, length(p - c));
      }

      void main() {
        vec4 base = texture2D(u_texture, v_textureCoords) * v_color;

        // Effective progress: when u_duration > 0 the shader self-animates from
        // u_time, otherwise we use the static u_progress prop. countdown == 1
        // drains (1 -> 0), countdown == 0 fills (0 -> 1).
        float cyclePos = u_duration > 0.0 ? fract(u_time / u_duration) : 0.0;
        float animProgress = u_countdown > 0.5 ? 1.0 - cyclePos : cyclePos;
        float progress = u_duration > 0.0 ? animProgress : u_progress;

        vec2 p = v_nodeCoords.xy * u_dimensions - u_center;
        float dist = length(p);
        float halfW = u_width * 0.5;

        // Ring coverage: 1 inside the stroke band, 0 outside (with 1px AA on both edges)
        float ringCoverage =
          smoothstep(u_radius - halfW - 1.0, u_radius - halfW + 1.0, dist) *
          (1.0 - smoothstep(u_radius + halfW - 1.0, u_radius + halfW + 1.0, dist));

        // Angle along the arc, normalized to [0, 1) starting at u_startAngle
        float ang = atan(p.y, p.x);
        float t = mod((ang - u_startAngle) * u_direction, TWO_PI) / TWO_PI;

        // Filled arc coverage (1 if in filled arc, else 0). When progress >= 1 the
        // whole ring is filled regardless of \`t\` -- guards against the mod() seam.
        float arcCoverage = progress >= 1.0 ? 1.0 : step(t, progress);
        float fillCoverage = ringCoverage * arcCoverage;

        #if CAP_ROUND
          // Round caps: discs of radius halfW at the start and head of the arc
          float a0 = u_startAngle;
          float a1 = u_startAngle + u_direction * progress * TWO_PI;
          vec2 cap0 = vec2(cos(a0), sin(a0)) * u_radius;
          vec2 cap1 = vec2(cos(a1), sin(a1)) * u_radius;
          float capMask = max(discCoverage(p, cap0, halfW), discCoverage(p, cap1, halfW));
          // Caps only visible when there's something to cap (progress > 0 and < 1).
          float capGate = step(0.0001, progress) * step(progress, 0.9999);
          fillCoverage = max(fillCoverage, capMask * capGate);
        #endif

        // Sample gradient. Normalize \`t\` to the *filled* portion so the gradient
        // spans the visible arc end-to-end regardless of progress.
        float gradT = progress > 0.0 ? clamp(t / progress, 0.0, 1.0) : 0.0;
        vec4 fillCol = getGradientColor(gradT);

        // Composite: track under fill (if track enabled), both gated by ringCoverage
        vec4 layer = vec4(0.0);
        #if HAS_TRACK
          float trackCoverage = ringCoverage * (1.0 - fillCoverage);
          layer = u_trackColor * trackCoverage + fillCol * fillCoverage;
        #else
          layer = fillCol * fillCoverage;
        #endif

        // Composite layer over base. Output alpha = base.a + layer.a*(1-base.a)
        // so the ring is visible even when the node's base color is fully transparent.
        float la = clamp(layer.a, 0.0, 1.0);
        vec3 blended = mix(base.rgb, layer.rgb, la);
        float outA = base.a + la * (1.0 - base.a);
        gl_FragColor = vec4(blended, outA);
      }
    `;
  },
};
