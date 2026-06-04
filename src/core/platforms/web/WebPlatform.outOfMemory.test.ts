/**
 * Tests that the GPU out-of-memory probe runs at the idle transition (end of a
 * render burst), not on every active frame.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WebPlatform } from './WebPlatform.js';
import type { Stage } from '../../Stage.js';

function makeIdleStage(outOfMemory: boolean) {
  const checkForOutOfMemory = vi.fn(() => outOfMemory);
  const handleOutOfMemory = vi.fn();
  const stage = {
    isContextLost: false,
    targetFrameTime: 0,
    updateFrameTime: vi.fn(),
    updateAnimations: vi.fn(() => false),
    hasSceneUpdates: vi.fn(() => false), // idle
    calculateFps: vi.fn(),
    drawFrame: vi.fn(),
    flushFrameEvents: vi.fn(),
    shManager: { cleanup: vi.fn() },
    cleanupTextRenderers: vi.fn(),
    eventBus: { emit: vi.fn() },
    txMemManager: {
      checkCleanup: vi.fn(() => false),
      cleanup: vi.fn(),
      handleOutOfMemory,
    },
    renderer: { checkForOutOfMemory },
  } as unknown as Stage;
  return { stage, checkForOutOfMemory, handleOutOfMemory };
}

describe('WebPlatform render loop — out-of-memory probe at idle', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function runOneIdleFrame(stage: Stage) {
    let capturedLoop: ((t?: number) => void) | null = null;
    const raf = vi.fn((cb: (t?: number) => void) => {
      capturedLoop = cb;
      return 1;
    });
    vi.stubGlobal('requestAnimationFrame', raf);
    vi.stubGlobal(
      'setTimeout',
      vi.fn(() => 1 as unknown as ReturnType<typeof setTimeout>),
    );

    new WebPlatform().startLoop(stage);
    capturedLoop!(0);
  }

  it('probes the renderer once when the scene goes idle', () => {
    const { stage, checkForOutOfMemory } = makeIdleStage(false);
    runOneIdleFrame(stage);
    expect(checkForOutOfMemory).toHaveBeenCalledTimes(1);
  });

  it('handles OOM when the probe reports it at idle', () => {
    const { stage, handleOutOfMemory } = makeIdleStage(true);
    runOneIdleFrame(stage);
    expect(handleOutOfMemory).toHaveBeenCalledTimes(1);
  });

  it('does not handle OOM when the probe reports none', () => {
    const { stage, handleOutOfMemory } = makeIdleStage(false);
    runOneIdleFrame(stage);
    expect(handleOutOfMemory).not.toHaveBeenCalled();
  });

  it('does not probe on an active (non-idle) frame', () => {
    const { stage, checkForOutOfMemory } = makeIdleStage(false);
    (stage.hasSceneUpdates as ReturnType<typeof vi.fn>).mockReturnValue(true);
    runOneIdleFrame(stage);
    expect(checkForOutOfMemory).not.toHaveBeenCalled();
  });
});
