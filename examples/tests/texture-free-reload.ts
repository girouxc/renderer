import type { INode } from '@lightningjs/renderer';
import type { ExampleSettings } from '../common/ExampleSettings.js';
import { waitUntilIdle } from '../common/utils.js';

import rockoPng from '../assets/rocko.png';

/**
 * Regression test: a texture that is freed by the memory manager while its node
 * is out of the viewport must reload — and re-display — when the node scrolls
 * back in.
 *
 * The bug this guards against: LRU cleanup used to *destroy* textures
 * (`removeAllListeners` + cache evict) rather than reversibly *free* them. A
 * node that kept its reference would then reload the texture to `loaded` but
 * never be re-notified, so it stayed blank. The fix frees reversibly, keeping
 * the node's subscription intact. See TextureMemoryManager.freeTexture.
 *
 * If the bug regresses, step 6 below never completes and the rocko image is
 * missing from the snapshot.
 */

const NODE = { x: 100, y: 100, w: 181, h: 218 };

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Poll `predicate` until it is true or the timeout elapses. `tick` runs each
 * iteration to drive frames / re-request cleanup.
 */
async function waitFor(
  predicate: () => boolean,
  timeoutMs: number,
  tick?: () => void,
): Promise<boolean> {
  const start = Date.now();
  while (predicate() === false) {
    if (Date.now() - start > timeoutMs) {
      return false;
    }
    if (tick !== undefined) {
      tick();
    }
    await delay(50);
  }
  return true;
}

export async function automation(settings: ExampleSettings) {
  await test(settings);
  await waitUntilIdle(settings.renderer);
  await settings.snapshot();
}

export default async function test({ renderer, testRoot }: ExampleSettings) {
  renderer.createTextNode({
    fontFamily: 'Ubuntu',
    text: 'Texture free + reload',
    fontSize: 30,
    color: 0xffffffff,
    x: 20,
    y: 20,
    parent: testRoot,
  });

  const node: INode = renderer.createNode({
    ...NODE,
    src: rockoPng,
    parent: testRoot,
  });

  let loaded = false;
  let freed = false;
  node.on('loaded', () => {
    loaded = true;
    freed = false;
  });
  node.on('freed', () => {
    freed = true;
    loaded = false;
  });

  // 1. Wait for the initial load.
  if ((await waitFor(() => loaded, 10000)) === false) {
    console.error('[texture-free-reload] texture never loaded');
    return false;
  }

  // 2. Wait out the cleanup startup grace period (2s) so the memory manager is
  //    allowed to free the texture.
  await delay(2200);

  // 3. Move the node far out of bounds and let a frame release its texture
  //    ownership (renderable -> false), which makes it eligible for cleanup.
  node.x = -5000;
  node.y = -5000;
  renderer.rerender();
  await delay(100);

  // 4. Force an aggressive (full) cleanup until the texture is actually freed.
  freed = false;
  const wasFreed = await waitFor(
    () => freed,
    5000,
    () => {
      renderer.stage.cleanup(true);
      renderer.rerender();
    },
  );
  if (wasFreed === false) {
    console.error('[texture-free-reload] texture never freed');
    return false;
  }

  // 5. Scroll the node back into view. The still-subscribed node must be
  //    re-notified when the freed texture reloads.
  loaded = false;
  node.x = NODE.x;
  node.y = NODE.y;
  renderer.rerender();

  // 6. Wait for the reload to complete. Before the fix this never fired.
  const reloaded = await waitFor(
    () => loaded,
    10000,
    () => renderer.rerender(),
  );
  if (reloaded === false) {
    console.error('[texture-free-reload] freed texture failed to reload');
    return false;
  }

  console.log('[texture-free-reload] freed texture reloaded and re-displayed');
  return true;
}
