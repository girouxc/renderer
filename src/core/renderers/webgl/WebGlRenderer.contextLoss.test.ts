/**
 * Tests for WebGlRenderer.createShaderProgram's context-loss handling.
 *
 * When the GL context is lost, gl.createShader() returns null and getError()
 * reports CONTEXT_LOST_WEBGL (0x9242 / 37442). That can happen on the app's
 * reactive stack before the async `webglcontextlost` event fires, so the
 * renderer trips `stage.setContextLost()` itself when it detects a lost
 * context — but only then; genuine compile errors are rethrown untouched.
 */
import { describe, expect, it, vi } from 'vitest';
import { WebGlRenderer } from './WebGlRenderer.js';
import type { WebGlShaderType } from './WebGlShaderNode.js';

function makeRenderer(isContextLost: boolean) {
  const setContextLost = vi.fn();
  // Minimal glw that drives the WebGlShaderProgram constructor straight to the
  // "Unable to create the shader" throw (createShader returns null).
  const glw = {
    VERTEX_SHADER: 0x8b31,
    getExtension: () => ({}),
    createShader: () => null,
    getError: () => 37442,
    isContextLost: () => isContextLost,
  };
  const renderer = Object.create(WebGlRenderer.prototype) as WebGlRenderer;
  (renderer as unknown as { glw: unknown }).glw = glw;
  (renderer as unknown as { stage: unknown }).stage = { setContextLost };

  const config = { vertex: 'v', fragment: 'f' } as unknown as WebGlShaderType;
  return { renderer, config, setContextLost };
}

describe('WebGlRenderer.createShaderProgram — context loss', () => {
  it('trips setContextLost and rethrows when the context is lost', () => {
    const { renderer, config, setContextLost } = makeRenderer(true);

    expect(() => renderer.createShaderProgram(config, {})).toThrow(
      /Unable to create the shader/,
    );
    expect(setContextLost).toHaveBeenCalledTimes(1);
  });

  it('rethrows without tripping setContextLost when the context is healthy', () => {
    const { renderer, config, setContextLost } = makeRenderer(false);

    expect(() => renderer.createShaderProgram(config, {})).toThrow();
    expect(setContextLost).not.toHaveBeenCalled();
  });
});
