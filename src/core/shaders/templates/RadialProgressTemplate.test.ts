import { describe, it, expect } from 'vitest';
import {
  RadialProgressTemplate,
  type RadialProgressProps,
} from './RadialProgressTemplate.js';
import {
  isAdvancedShaderProp,
  resolveShaderProps,
} from '../../renderers/CoreShaderNode.js';

function resolve(input: Partial<RadialProgressProps>): RadialProgressProps {
  const props = { ...input } as Record<string, unknown>;
  resolveShaderProps(props, RadialProgressTemplate.props as never);
  return props as unknown as RadialProgressProps;
}

describe('RadialProgressTemplate', () => {
  describe('progress', () => {
    const cfg = RadialProgressTemplate.props!.progress;
    if (!isAdvancedShaderProp(cfg))
      throw new Error('progress should be advanced');

    it('clamps values below 0 to 0', () => {
      expect(cfg.resolve!(-0.5, {} as never)).toBe(0);
    });

    it('clamps values above 1 to 1', () => {
      expect(cfg.resolve!(2, {} as never)).toBe(1);
    });

    it('passes through in-range values', () => {
      expect(cfg.resolve!(0.42, {} as never)).toBe(0.42);
    });

    it('returns default when undefined', () => {
      expect(cfg.resolve!(undefined as never, {} as never)).toBe(1);
    });
  });

  describe('colors', () => {
    const cfg = RadialProgressTemplate.props!.colors;
    if (!isAdvancedShaderProp(cfg))
      throw new Error('colors should be advanced');

    it('falls back to default on undefined', () => {
      expect(cfg.resolve!(undefined as never, {} as never)).toEqual([
        0xffffffff,
      ]);
    });

    it('falls back to default on empty array', () => {
      expect(cfg.resolve!([] as never, {} as never)).toEqual([0xffffffff]);
    });

    it('passes through user-provided colors', () => {
      const input = [0xff0000ff, 0x00ff00ff];
      expect(cfg.resolve!(input, {} as never)).toEqual(input);
    });
  });

  describe('stops', () => {
    const cfg = RadialProgressTemplate.props!.stops;
    if (!isAdvancedShaderProp(cfg)) throw new Error('stops should be advanced');

    it('auto-distributes when omitted (n=3)', () => {
      const out = cfg.resolve!(
        undefined as never,
        {
          colors: [1, 2, 3],
        } as never,
      );
      expect(out).toEqual([0, 0.5, 1]);
    });

    it('auto-distributes when length mismatches', () => {
      const out = cfg.resolve!(
        [0, 1] as never,
        {
          colors: [1, 2, 3],
        } as never,
      );
      expect(out).toEqual([0, 0.5, 1]);
    });

    it('handles single color (n=1) without NaN', () => {
      const out = cfg.resolve!(undefined as never, { colors: [1] } as never);
      expect(out).toEqual([0]);
    });

    it('passes through valid stops', () => {
      const out = cfg.resolve!(
        [0, 0.3, 1] as never,
        {
          colors: [1, 2, 3],
        } as never,
      );
      expect(out).toEqual([0, 0.3, 1]);
    });
  });

  describe('duration', () => {
    const cfg = RadialProgressTemplate.props!.duration;
    if (!isAdvancedShaderProp(cfg))
      throw new Error('duration should be advanced');

    it('returns default (0) when undefined', () => {
      expect(cfg.resolve!(undefined as never, {} as never)).toBe(0);
    });

    it('clamps negative values to 0', () => {
      expect(cfg.resolve!(-100 as never, {} as never)).toBe(0);
    });

    it('passes through positive values', () => {
      expect(cfg.resolve!(5000 as never, {} as never)).toBe(5000);
    });
  });

  describe('defaults via resolveShaderProps', () => {
    it('applies all defaults when no props given', () => {
      const r = resolve({});
      expect(r.width).toBe(8);
      expect(r.radius).toBe(0);
      expect(r.progress).toBe(1);
      expect(r.startAngle).toBeCloseTo(-Math.PI / 2);
      expect(r.direction).toBe(1);
      expect(r.colors).toEqual([0xffffffff]);
      expect(r.stops).toEqual([0]);
      expect(r.trackColor).toBe(0x00000000);
      expect(r.cap).toBe(1);
      expect(r.duration).toBe(0);
      expect(r.countdown).toBe(1);
    });

    it('clamps progress through full resolution path', () => {
      const r = resolve({ progress: 1.5 });
      expect(r.progress).toBe(1);
    });

    it('auto-distributes stops through full resolution path', () => {
      const r = resolve({ colors: [0xff0000ff, 0x00ff00ff, 0x0000ffff] });
      expect(r.stops).toEqual([0, 0.5, 1]);
    });

    it('threads duration and countdown through full resolution path', () => {
      const r = resolve({ duration: 3000, countdown: 0 });
      expect(r.duration).toBe(3000);
      expect(r.countdown).toBe(0);
    });
  });
});
