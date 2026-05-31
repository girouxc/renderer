/**
 * Tests for WebGL context-loss handling on the Stage.
 *
 * Covers the pragmatic core support added for low-RAM devices (Chromium 123+
 * drops the GPU context when backgrounded). On loss we stop the render loop
 * and emit a `contextLost` event so consumers can reload; the engine does not
 * rebuild GL resources in place, so there is no restore path.
 */
import { describe, expect, it, vi } from 'vitest';
import { Stage } from './Stage.js';
import { EventEmitter } from '../common/EventEmitter.js';

// Build a minimal Stage-like object that exercises the context-loss methods
// without standing up the full GL-backed constructor.
function makeStage() {
  const eventBus = new EventEmitter();
  const stage = Object.create(Stage.prototype) as Stage;
  (stage as unknown as { eventBus: EventEmitter }).eventBus = eventBus;
  stage.isContextLost = false;
  return { stage, eventBus };
}

describe('Stage.setContextLost', () => {
  it('sets the flag and emits contextLost', () => {
    const { stage, eventBus } = makeStage();
    const onLost = vi.fn();
    eventBus.on('contextLost', onLost);

    stage.setContextLost();

    expect(stage.isContextLost).toBe(true);
    expect(onLost).toHaveBeenCalledTimes(1);
  });

  it('is idempotent — does not re-emit when already lost', () => {
    const { stage, eventBus } = makeStage();
    const onLost = vi.fn();
    eventBus.on('contextLost', onLost);

    stage.setContextLost();
    stage.setContextLost();

    expect(onLost).toHaveBeenCalledTimes(1);
  });
});
