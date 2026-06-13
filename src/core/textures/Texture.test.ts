import { describe, it, expect, vi } from 'vitest';
import { Texture, type TextureData } from './Texture.js';
import type { CoreTextureManager } from '../CoreTextureManager.js';

class TestTexture extends Texture {
  override async getTextureSource(): Promise<TextureData> {
    return { data: null };
  }
}

function makeTexture(): {
  texture: TestTexture;
  loadTexture: ReturnType<typeof vi.fn>;
  onChangeIsRenderable: ReturnType<typeof vi.fn>;
} {
  const loadTexture = vi.fn();
  const txManager = {
    maxRetryCount: 3,
    loadTexture,
  } as unknown as CoreTextureManager;
  const texture = new TestTexture(txManager);
  const onChangeIsRenderable = vi.fn();
  texture.onChangeIsRenderable = onChangeIsRenderable;
  return { texture, loadTexture, onChangeIsRenderable };
}

describe('Texture.setRenderableOwner', () => {
  it('adding an owner fires the 0→1 transition exactly once and loads', () => {
    const { texture, loadTexture, onChangeIsRenderable } = makeTexture();

    texture.setRenderableOwner(1, true);

    expect(texture.renderableOwners.size).toBe(1);
    expect(texture.renderable).toBe(true);
    expect(onChangeIsRenderable).toHaveBeenCalledTimes(1);
    expect(onChangeIsRenderable).toHaveBeenCalledWith(true);
    expect(loadTexture).toHaveBeenCalledTimes(1);
  });

  it('double-add of the same owner is a no-op (size stays 1, one event)', () => {
    const { texture, loadTexture, onChangeIsRenderable } = makeTexture();

    texture.setRenderableOwner(1, true);
    texture.setRenderableOwner(1, true);

    expect(texture.renderableOwners.size).toBe(1);
    expect(onChangeIsRenderable).toHaveBeenCalledTimes(1);
    expect(loadTexture).toHaveBeenCalledTimes(1);
  });

  it('a second distinct owner does not re-fire the transition', () => {
    const { texture, loadTexture, onChangeIsRenderable } = makeTexture();

    texture.setRenderableOwner(1, true);
    texture.setRenderableOwner(2, true);

    expect(texture.renderableOwners.size).toBe(2);
    expect(onChangeIsRenderable).toHaveBeenCalledTimes(1);
    expect(loadTexture).toHaveBeenCalledTimes(1);
  });

  it('removing a non-member owner does not fire a transition', () => {
    const { texture, onChangeIsRenderable } = makeTexture();

    texture.setRenderableOwner(1, false);

    expect(texture.renderableOwners.size).toBe(0);
    expect(texture.renderable).toBe(false);
    expect(onChangeIsRenderable).not.toHaveBeenCalled();
  });

  it('1→0 fires onChangeIsRenderable(false) exactly once', () => {
    const { texture, onChangeIsRenderable } = makeTexture();

    texture.setRenderableOwner(1, true);
    texture.setRenderableOwner(1, false);
    texture.setRenderableOwner(1, false);

    expect(texture.renderableOwners.size).toBe(0);
    expect(texture.renderable).toBe(false);
    expect(onChangeIsRenderable).toHaveBeenCalledTimes(2);
    expect(onChangeIsRenderable).toHaveBeenLastCalledWith(false);
  });

  it('re-adding an owner after 1→0 triggers load again (freed→reload cycle)', () => {
    const { texture, loadTexture } = makeTexture();

    texture.setRenderableOwner(1, true);
    texture.setRenderableOwner(1, false);
    texture.setRenderableOwner(1, true);

    expect(texture.renderable).toBe(true);
    expect(loadTexture).toHaveBeenCalledTimes(2);
  });

  it('string and number owners coexist (node ids vs subtexture/font keys)', () => {
    const { texture } = makeTexture();

    texture.setRenderableOwner(7, true);
    texture.setRenderableOwner('subtexture-7', true);

    expect(texture.renderableOwners.size).toBe(2);

    texture.setRenderableOwner(7, false);
    expect(texture.renderableOwners.size).toBe(1);
    expect(texture.renderable).toBe(true);

    texture.setRenderableOwner('subtexture-7', false);
    expect(texture.renderableOwners.size).toBe(0);
    expect(texture.renderable).toBe(false);
  });

  it('canBeCleanedUp respects remaining owners', () => {
    const { texture } = makeTexture();
    // Skip the startup grace period so owners are the deciding factor.
    texture.isWithinStartupGracePeriod = () => false;

    texture.setRenderableOwner(1, true);
    expect(texture.canBeCleanedUp()).toBe(false);

    texture.setRenderableOwner(1, false);
    expect(texture.canBeCleanedUp()).toBe(true);
  });
});
