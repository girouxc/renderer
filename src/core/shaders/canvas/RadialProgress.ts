import type { CanvasShaderType } from '../../renderers/canvas/CanvasShaderNode.js';
import {
  RadialProgressTemplate,
  type RadialProgressProps,
} from '../templates/RadialProgressTemplate.js';

export interface ComputedRadialProgressValues {
  cx: number;
  cy: number;
  radius: number;
  colorChannels: number[][]; // [r,g,b,a] per stop color, 0..255 (a in 0..1)
  trackColor: string | null;
}

const SEGMENTS = 64;

function lerpColor(a: number[], b: number[], t: number): string {
  const r = Math.round(a[0]! + (b[0]! - a[0]!) * t);
  const g = Math.round(a[1]! + (b[1]! - a[1]!) * t);
  const bl = Math.round(a[2]! + (b[2]! - a[2]!) * t);
  const al = a[3]! + (b[3]! - a[3]!) * t;
  return `rgba(${r},${g},${bl},${al})`;
}

function colorAt(channels: number[][], stops: number[], t: number): string {
  const last = channels.length - 1;
  if (t <= stops[0]!) return lerpColor(channels[0]!, channels[0]!, 0);
  if (t >= stops[last]!) return lerpColor(channels[last]!, channels[last]!, 0);
  for (let i = 0; i < last; i++) {
    const left = stops[i]!;
    const right = stops[i + 1]!;
    if (t >= left && t <= right) {
      const lt = (t - left) / (right - left);
      return lerpColor(channels[i]!, channels[i + 1]!, lt);
    }
  }
  return lerpColor(channels[last]!, channels[last]!, 0);
}

function toChannels(rgba: number): number[] {
  return [
    (rgba >>> 24) & 0xff,
    (rgba >>> 16) & 0xff,
    (rgba >>> 8) & 0xff,
    (rgba & 0xff) / 255,
  ];
}

export const RadialProgress: CanvasShaderType<
  RadialProgressProps,
  ComputedRadialProgressValues
> = {
  props: RadialProgressTemplate.props,
  time: true,
  update(node) {
    const props = this.props!;
    const autoRadius = Math.min(node.w, node.h) * 0.5 - props.width * 0.5;
    const radius = props.radius > 0 ? props.radius : autoRadius;

    const colorChannels: number[][] = [];
    for (let i = 0; i < props.colors.length; i++) {
      colorChannels.push(toChannels(props.colors[i]!));
    }

    this.computed = {
      cx: node.w * 0.5,
      cy: node.h * 0.5,
      radius,
      colorChannels,
      trackColor:
        props.trackColor !== 0 ? this.toColorString(props.trackColor) : null,
    };
  },
  render(ctx, node, renderContext) {
    renderContext();
    const { cx, cy, radius, colorChannels, trackColor } = this
      .computed as ComputedRadialProgressValues;
    const { tx, ty } = node.globalTransform!;
    const props = this.props!;
    const { width, startAngle, direction, cap, duration, countdown } = props;
    const stops = props.stops;

    // Effective progress: when duration > 0 the shader self-animates from
    // node.time (millis since stage start). Otherwise use the static prop.
    let progress = props.progress;
    if (duration > 0) {
      const cyclePos = (node.time % duration) / duration;
      progress = countdown === 1 ? 1 - cyclePos : cyclePos;
    }

    const ax = tx + cx;
    const ay = ty + cy;

    ctx.lineWidth = width;
    ctx.lineCap = cap === 1 ? 'round' : 'butt';

    if (trackColor !== null) {
      ctx.strokeStyle = trackColor;
      ctx.beginPath();
      ctx.arc(ax, ay, radius, 0, Math.PI * 2);
      ctx.stroke();
    }

    if (progress <= 0) return;

    const sweep = Math.PI * 2 * progress * direction;
    const step = sweep / SEGMENTS;
    // Overlap segments by a tiny amount so the seams don't show on canvas AA
    const overlap = Math.abs(step) * 0.02;

    for (let i = 0; i < SEGMENTS; i++) {
      const t = i / (SEGMENTS - 1);
      ctx.strokeStyle = colorAt(colorChannels, stops, t);
      ctx.beginPath();
      const a0 = startAngle + step * i;
      const a1 =
        startAngle + step * (i + 1) + (direction === 1 ? overlap : -overlap);
      ctx.arc(ax, ay, radius, a0, a1, direction === -1);
      ctx.stroke();
    }
  },
};
