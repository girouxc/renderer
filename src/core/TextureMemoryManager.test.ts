import { describe, expect, it, vi } from 'vitest';
import {
  TextureMemoryManager,
  type TextureMemoryManagerSettings,
} from './TextureMemoryManager.js';
import type { Stage } from './Stage.js';
import { TextureType, type Texture } from './textures/Texture.js';
import { EventEmitter } from '../common/EventEmitter.js';

function makeSettings(
  overrides: Partial<TextureMemoryManagerSettings> = {},
): TextureMemoryManagerSettings {
  return {
    criticalThreshold: 200e6,
    targetThresholdLevel: 0.5,
    cleanupInterval: 5000,
    debugLogging: false,
    baselineMemoryAllocation: 26e6,
    doNotExceedCriticalThreshold: false,
    ...overrides,
  };
}

// The OOM path touches queueFrameEvent; cleanup() additionally sweeps the
// texture manager's keyCache and evicts orphans via removeTextureFromCache.
function makeStage(): {
  stage: Stage;
  queueFrameEvent: ReturnType<typeof vi.fn>;
  keyCache: Map<string, Texture>;
} {
  const queueFrameEvent = vi.fn();
  const keyCache = new Map<string, Texture>();
  const txManager = {
    keyCache,
    removeTextureFromCache: (texture: Texture) => {
      // Mirrors CoreTextureManager.removeTextureFromCache
      const cacheKey = texture.cacheKey;
      if (cacheKey !== null) {
        keyCache.delete(cacheKey);
        texture.cacheKey = null;
      }
    },
  };
  const stage = { queueFrameEvent, txManager } as unknown as Stage;
  return { stage, queueFrameEvent, keyCache };
}

function makeManager(overrides: Partial<TextureMemoryManagerSettings> = {}): {
  mgr: TextureMemoryManager;
  queueFrameEvent: ReturnType<typeof vi.fn>;
  keyCache: Map<string, Texture>;
} {
  const { stage, queueFrameEvent, keyCache } = makeStage();
  const mgr = new TextureMemoryManager(stage, makeSettings(overrides));
  return { mgr, queueFrameEvent, keyCache };
}

// setTextureMemUse expects a Texture with a mutable memUsed field; nothing else
// is read on the OOM path.
function fakeTexture(): Texture {
  return { memUsed: 0 } as unknown as Texture;
}

describe('TextureMemoryManager — out-of-memory event', () => {
  it('queues an outOfMemory frame event with the estimate and threshold', () => {
    const { mgr, queueFrameEvent } = makeManager({ criticalThreshold: 200e6 });
    // memUsed = baseline (26e6) + texture (100e6) = 126e6
    mgr.setTextureMemUse(fakeTexture(), 100e6);

    mgr.handleOutOfMemory();

    expect(queueFrameEvent).toHaveBeenCalledTimes(1);
    expect(queueFrameEvent).toHaveBeenCalledWith('outOfMemory', {
      memUsed: 126e6,
      criticalThreshold: 200e6,
    });
  });

  it('requests an immediate cleanup as a best-effort mitigation', () => {
    const { mgr } = makeManager();
    expect(mgr.criticalCleanupRequested).toBe(false);

    mgr.handleOutOfMemory();

    expect(mgr.criticalCleanupRequested).toBe(true);
  });

  it('does not change the critical threshold itself', () => {
    const { mgr } = makeManager({ criticalThreshold: 200e6 });
    const before = mgr.getMemoryInfo().criticalThreshold;

    mgr.handleOutOfMemory();

    expect(mgr.getMemoryInfo().criticalThreshold).toBe(before);
  });

  it('reports the current estimate each time it fires', () => {
    const { mgr, queueFrameEvent } = makeManager({ criticalThreshold: 200e6 });

    mgr.setTextureMemUse(fakeTexture(), 50e6);
    mgr.handleOutOfMemory();
    mgr.setTextureMemUse(fakeTexture(), 80e6);
    mgr.handleOutOfMemory();

    expect(queueFrameEvent.mock.calls[0]![1]).toEqual({
      memUsed: 76e6, // 26e6 baseline + 50e6
      criticalThreshold: 200e6,
    });
    expect(queueFrameEvent.mock.calls[1]![1]).toEqual({
      memUsed: 156e6, // 26e6 baseline + 50e6 + 80e6
      criticalThreshold: 200e6,
    });
  });
});

// A cleanable image texture: spies on free()/destroy() so we can assert which
// reclamation path cleanup() takes. memUsed starts at 0 — setTextureMemUse is
// what registers its size with the manager.
function cleanableTexture(): Texture & {
  free: ReturnType<typeof vi.fn>;
  destroy: ReturnType<typeof vi.fn>;
} {
  return {
    memUsed: 0,
    state: 'loaded',
    type: TextureType.image,
    free: vi.fn(),
    destroy: vi.fn(),
    canBeCleanedUp: () => true,
  } as unknown as Texture & {
    free: ReturnType<typeof vi.fn>;
    destroy: ReturnType<typeof vi.fn>;
  };
}

describe('TextureMemoryManager — cleanup is reversible', () => {
  it('frees textures rather than destroying them so they can reload', () => {
    const { mgr } = makeManager({ criticalThreshold: 200e6 });
    const texture = cleanableTexture();
    mgr.setTextureMemUse(texture, 100e6);

    mgr.cleanup(true);

    // Reversible free path — keeps listeners + cache so a node still
    // referencing the texture reloads (and is re-notified) on viewport
    // re-entry. The terminal destroy path (removeAllListeners + cache evict)
    // must NOT be taken.
    expect(texture.free).toHaveBeenCalledTimes(1);
    expect(texture.destroy).not.toHaveBeenCalled();
  });

  it('reclaims the freed texture memory', () => {
    const { mgr } = makeManager({ criticalThreshold: 200e6 });
    const texture = cleanableTexture();
    mgr.setTextureMemUse(texture, 100e6);
    expect(mgr.getMemoryInfo().memUsed).toBe(126e6); // 26e6 baseline + 100e6

    mgr.cleanup(true);

    expect(mgr.getMemoryInfo().memUsed).toBe(26e6); // back to baseline
    expect(texture.memUsed).toBe(0);
  });
});

// A cached, already-freed texture as left behind by a prior cleanup(): GPU and
// CPU data released (memUsed 0, not in loadedTextures), but the Texture object
// still sits in the keyCache. Built on a real EventEmitter so hasListeners()
// reflects actual on()/off() subscriptions, exactly like CoreNode's
// loadTextureTask/unloadTexture.
function freedCachedTexture(cacheKey: string): Texture & {
  destroy: ReturnType<typeof vi.fn>;
} {
  const texture = Object.assign(new EventEmitter(), {
    memUsed: 0,
    state: 'freed',
    type: TextureType.image,
    preventCleanup: false,
    renderableOwners: new Set<string | number>(),
    cacheKey,
    free: vi.fn(),
    destroy: vi.fn(),
    canBeCleanedUp: () => true,
    // Fresh texture by default — within the 2s startup grace period.
    isWithinStartupGracePeriod: () => true,
  });
  return texture as unknown as Texture & {
    destroy: ReturnType<typeof vi.fn>;
  };
}

describe('TextureMemoryManager — orphaned freed texture eviction', () => {
  it('keeps a freed texture that a node still references via listeners', () => {
    const { mgr, keyCache } = makeManager();
    const texture = freedCachedTexture('img:poster.png');
    keyCache.set('img:poster.png', texture);
    // CoreNode.loadTextureTask subscribes; the node is alive but offscreen.
    texture.on('freed', () => {});

    mgr.cleanup();

    expect(texture.destroy).not.toHaveBeenCalled();
    expect(keyCache.get('img:poster.png')).toBe(texture);
    expect(texture.cacheKey).toBe('img:poster.png');
  });

  it('keeps a freed texture that still has renderable owners', () => {
    const { mgr, keyCache } = makeManager();
    const texture = freedCachedTexture('img:poster.png');
    texture.renderableOwners.add(1);
    keyCache.set('img:poster.png', texture);

    mgr.cleanup();

    expect(texture.destroy).not.toHaveBeenCalled();
    expect(keyCache.get('img:poster.png')).toBe(texture);
  });

  it('keeps a freed texture marked preventCleanup', () => {
    const { mgr, keyCache } = makeManager();
    const texture = freedCachedTexture('img:poster.png');
    (texture as { preventCleanup: boolean }).preventCleanup = true;
    keyCache.set('img:poster.png', texture);

    mgr.cleanup();

    expect(texture.destroy).not.toHaveBeenCalled();
    expect(keyCache.get('img:poster.png')).toBe(texture);
  });

  it('does not evict loaded or in-flight cached textures, even aged orphans', () => {
    const { mgr, keyCache } = makeManager();
    const states = ['loaded', 'fetching', 'fetched', 'loading'];
    const textures: ReturnType<typeof freedCachedTexture>[] = [];
    for (const state of states) {
      const texture = freedCachedTexture(`img:${state}.png`);
      (texture as { state: string }).state = state;
      // Aged out — eviction must be blocked by state alone.
      (
        texture as { isWithinStartupGracePeriod: () => boolean }
      ).isWithinStartupGracePeriod = () => false;
      keyCache.set(`img:${state}.png`, texture);
      textures.push(texture);
    }

    mgr.cleanup();

    for (const texture of textures) {
      expect(texture.destroy).not.toHaveBeenCalled();
    }
    expect(keyCache.size).toBe(states.length);
  });

  it('keeps a fresh initial texture during the startup grace period', () => {
    // A node created this same frame subscribes in a queued microtask, so a
    // brand-new texture can look orphaned during a same-frame cleanup. The
    // grace period is the race guard.
    const { mgr, keyCache } = makeManager();
    const texture = freedCachedTexture('img:fresh.png');
    (texture as { state: string }).state = 'initial';

    keyCache.set('img:fresh.png', texture);
    mgr.cleanup();

    expect(texture.destroy).not.toHaveBeenCalled();
    expect(keyCache.get('img:fresh.png')).toBe(texture);
  });

  it('evicts an orphaned initial texture once the grace period expires', () => {
    const { mgr, keyCache } = makeManager();
    const texture = freedCachedTexture('img:never-loaded.png');
    (texture as { state: string }).state = 'initial';
    (
      texture as { isWithinStartupGracePeriod: () => boolean }
    ).isWithinStartupGracePeriod = () => false;

    keyCache.set('img:never-loaded.png', texture);
    mgr.cleanup();

    expect(texture.destroy).toHaveBeenCalledTimes(1);
    expect(keyCache.has('img:never-loaded.png')).toBe(false);
    expect(texture.cacheKey).toBe(null);
  });

  it('evicts an orphaned failed texture once the grace period expires', () => {
    // Retry only happens through a node's 'failed' listener — with no
    // listeners nothing will ever retry it.
    const { mgr, keyCache } = makeManager();
    const texture = freedCachedTexture('img:404.png');
    (texture as { state: string }).state = 'failed';
    (
      texture as { isWithinStartupGracePeriod: () => boolean }
    ).isWithinStartupGracePeriod = () => false;

    keyCache.set('img:404.png', texture);
    mgr.cleanup();

    expect(texture.destroy).toHaveBeenCalledTimes(1);
    expect(keyCache.has('img:404.png')).toBe(false);
  });

  it('keeps an aged initial texture that a node references via listeners', () => {
    const { mgr, keyCache } = makeManager();
    const texture = freedCachedTexture('img:queued.png');
    (texture as { state: string }).state = 'initial';
    (
      texture as { isWithinStartupGracePeriod: () => boolean }
    ).isWithinStartupGracePeriod = () => false;
    texture.on('loaded', () => {});

    keyCache.set('img:queued.png', texture);
    mgr.cleanup();

    expect(texture.destroy).not.toHaveBeenCalled();
    expect(keyCache.get('img:queued.png')).toBe(texture);
  });

  it('destroys and evicts an orphaned freed texture', () => {
    const { mgr, keyCache } = makeManager();
    const texture = freedCachedTexture('img:gone.png');
    keyCache.set('img:gone.png', texture);

    mgr.cleanup();

    expect(texture.destroy).toHaveBeenCalledTimes(1);
    expect(keyCache.has('img:gone.png')).toBe(false);
    expect(texture.cacheKey).toBe(null);
  });

  it('evicts only once the last listener is removed (node destroyed)', () => {
    const { mgr, keyCache } = makeManager();
    const texture = freedCachedTexture('img:row-item.png');
    keyCache.set('img:row-item.png', texture);
    const onFreed = () => {};
    texture.on('freed', onFreed);

    mgr.cleanup();
    expect(texture.destroy).not.toHaveBeenCalled();
    expect(keyCache.has('img:row-item.png')).toBe(true);

    // Node destroyed: CoreNode.unloadTexture removes its subscriptions.
    texture.off('freed', onFreed);

    mgr.cleanup();
    expect(texture.destroy).toHaveBeenCalledTimes(1);
    expect(keyCache.has('img:row-item.png')).toBe(false);
  });

  it('evicts orphans freed by the same cleanup pass', () => {
    const { mgr, keyCache } = makeManager({ criticalThreshold: 200e6 });
    // A loaded, cleanable texture whose free() transitions it to 'freed',
    // mirroring ctxTexture.free() -> setState('freed'). No listeners and no
    // owners: its node was already destroyed.
    const texture = freedCachedTexture('img:orphan.png');
    (texture as { state: string }).state = 'loaded';
    (texture as { free: () => void }).free = () => {
      (texture as { state: string }).state = 'freed';
    };
    keyCache.set('img:orphan.png', texture);
    mgr.setTextureMemUse(texture, 100e6);

    mgr.cleanup(true);

    expect(texture.destroy).toHaveBeenCalledTimes(1);
    expect(keyCache.has('img:orphan.png')).toBe(false);
    expect(mgr.getMemoryInfo().memUsed).toBe(26e6); // baseline only
  });
});

describe('EventEmitter — hasListeners', () => {
  it('is false before any listener is registered', () => {
    const emitter = new EventEmitter();
    expect(emitter.hasListeners()).toBe(false);
  });

  it('is true while a listener is registered and false after off()', () => {
    const emitter = new EventEmitter();
    const listener = () => {};
    emitter.on('loaded', listener);
    expect(emitter.hasListeners()).toBe(true);

    emitter.off('loaded', listener);
    expect(emitter.hasListeners()).toBe(false);
  });

  it('is false after off() removes all listeners for an event by name', () => {
    const emitter = new EventEmitter();
    emitter.on('loaded', () => {});
    emitter.off('loaded');
    expect(emitter.hasListeners()).toBe(false);
  });

  it('is true if any one of several events still has a listener', () => {
    const emitter = new EventEmitter();
    const a = () => {};
    emitter.on('loaded', a);
    emitter.on('freed', () => {});
    emitter.off('loaded', a);
    expect(emitter.hasListeners()).toBe(true);
  });

  it('is false after a once() listener has fired', () => {
    const emitter = new EventEmitter();
    emitter.once('loaded', () => {});
    emitter.emit('loaded');
    expect(emitter.hasListeners()).toBe(false);
  });

  it('is false after removeAllListeners()', () => {
    const emitter = new EventEmitter();
    emitter.on('loaded', () => {});
    emitter.removeAllListeners();
    expect(emitter.hasListeners()).toBe(false);
  });
});
