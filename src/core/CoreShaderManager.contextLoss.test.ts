/**
 * Tests for CoreShaderManager's behavior when shader creation fails.
 *
 * A lost GL context makes shader creation throw synchronously (see
 * WebGlRenderer.createShaderProgram, which trips `stage.isContextLost`). On a
 * lost context we must fail soft — returning the default shader node so the
 * throw does not propagate through the consumer's reactive layer (recovery is
 * an app reload via the `contextLost` event). A genuine compile error (context
 * not lost) must still surface loudly.
 */
import { describe, expect, it, vi } from 'vitest';
import { CoreShaderManager } from './CoreShaderManager.js';
import type { Stage } from './Stage.js';

function makeManager(opts: { isContextLost: boolean; throwOnCreate: Error }) {
  const defShaderNode = { __default: true };
  const createShaderProgram = vi.fn(() => {
    throw opts.throwOnCreate;
  });
  const stage = {
    isContextLost: opts.isContextLost,
    defShaderNode,
    renderer: {
      mode: 'webgl',
      createShaderProgram,
    },
  } as unknown as Stage;

  const mgr = Object.create(CoreShaderManager.prototype) as CoreShaderManager;
  (mgr as unknown as { stage: Stage }).stage = stage;
  (mgr as unknown as { shTypes: Record<string, unknown> }).shTypes = {
    TestShader: { props: undefined },
  };
  (mgr as unknown as { shCache: Map<string, unknown> }).shCache = new Map();

  return { mgr, defShaderNode, createShaderProgram };
}

describe('CoreShaderManager.createShader — context loss', () => {
  it('returns the default shader node when the context is lost', () => {
    const { mgr, defShaderNode } = makeManager({
      isContextLost: true,
      throwOnCreate: new Error(
        'Unable to create the shader: VERTEX_SHADER. WebGlContext Error: 37442',
      ),
    });

    const result = mgr.createShader('TestShader' as never);

    expect(result).toBe(defShaderNode);
  });

  it('rethrows when the failure is not a lost context (genuine compile error)', () => {
    const err = new Error('Vertex shader creation failed');
    const { mgr } = makeManager({ isContextLost: false, throwOnCreate: err });

    expect(() => mgr.createShader('TestShader' as never)).toThrow(err);
  });

  it('does not cache a failed program', () => {
    const { mgr, createShaderProgram } = makeManager({
      isContextLost: true,
      throwOnCreate: new Error('boom'),
    });

    mgr.createShader('TestShader' as never);
    mgr.createShader('TestShader' as never);

    // Cache miss both times — the failure was never stored.
    expect(createShaderProgram).toHaveBeenCalledTimes(2);
  });
});
