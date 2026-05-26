import { describe, it, expect } from 'vitest';
import { BlurTemplate, type BlurProps } from './BlurTemplate.js';
import { resolveShaderProps } from '../../renderers/CoreShaderNode.js';

function resolve(input: Partial<BlurProps>): BlurProps {
  const props = { ...input } as Record<string, unknown>;
  resolveShaderProps(props, BlurTemplate.props as never);
  return props as unknown as BlurProps;
}

describe('BlurTemplate', () => {
  it('applies default amount when omitted', () => {
    expect(resolve({}).amount).toBe(4);
  });

  it('passes through user-provided amount', () => {
    expect(resolve({ amount: 10 }).amount).toBe(10);
  });

  it('passes through zero (no blur)', () => {
    expect(resolve({ amount: 0 }).amount).toBe(0);
  });
});
