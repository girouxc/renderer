import type { INode } from '@lightningjs/renderer';
import type { ExampleSettings } from '../common/ExampleSettings.js';

import rockoPng from '../assets/rocko.png';

/**
 * Visual test for `placeholderColor`: a node with a texture renders a solid
 * color rect (through its shader, so rounded corners apply) until the texture
 * loads, instead of rendering nothing.
 *
 * Deterministic states captured in the snapshot:
 * 1. Rounded placeholder for a permanently failed src (placeholder remains).
 * 2. RoundedWithBorder placeholder for a permanently failed src.
 * 3. A loaded image with placeholderColor set — the image shows untinted,
 *    proving the placeholder does not leak into the loaded state.
 * 4. Control: failed src without placeholderColor renders nothing.
 */

const MISSING_SRC = '/does-not-exist-placeholder-test.png';

function waitForEvent(
  node: INode,
  event: 'loaded' | 'failed',
  timeoutMs: number,
): Promise<boolean> {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => resolve(false), timeoutMs);
    node.once(event, () => {
      clearTimeout(timeout);
      resolve(true);
    });
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function automation(settings: ExampleSettings) {
  await test(settings);
  // The scene settled inside test() (loaded/failed events already awaited),
  // so the 'idle' transition may have already fired — don't wait for it.
  // Force a final frame and let it draw instead.
  settings.renderer.rerender();
  await delay(100);
  await settings.snapshot();
}

export default async function test({ renderer, testRoot }: ExampleSettings) {
  renderer.createTextNode({
    fontFamily: 'Ubuntu',
    text: 'placeholderColor',
    fontSize: 30,
    color: 0xffffffff,
    x: 20,
    y: 20,
    parent: testRoot,
  });

  // Fail fast and permanently: maxRetryCount 0 = one attempt, no retries.
  const missingTexture = renderer.createTexture('ImageTexture', {
    src: MISSING_SRC,
    maxRetryCount: 0,
  });

  // 1. Placeholder stays visible for a permanently failed texture (rounded).
  const failedRounded = renderer.createNode({
    x: 20,
    y: 80,
    w: 200,
    h: 280,
    texture: missingTexture,
    placeholderColor: 0x336699ff,
    shader: renderer.createShader('Rounded', { radius: [20] }),
    parent: testRoot,
  });

  // 2. Same with a border shader.
  const failedBordered = renderer.createNode({
    x: 250,
    y: 80,
    w: 200,
    h: 280,
    texture: missingTexture,
    placeholderColor: 0x993311ff,
    shader: renderer.createShader('RoundedWithBorder', {
      radius: [20],
      'border-w': 8,
    }),
    parent: testRoot,
  });

  // 3. A successfully loaded image with a placeholder configured must show
  //    the image, untinted.
  const loadedImage = renderer.createNode({
    x: 480,
    y: 80,
    w: 181,
    h: 218,
    src: rockoPng,
    placeholderColor: 0x336699ff,
    shader: renderer.createShader('Rounded', { radius: [20] }),
    parent: testRoot,
  });

  // 4. Control: a failed texture without a placeholder renders nothing.
  renderer.createNode({
    x: 710,
    y: 80,
    w: 200,
    h: 280,
    texture: missingTexture,
    parent: testRoot,
  });

  const settled = await Promise.all([
    waitForEvent(failedRounded, 'failed', 10000),
    waitForEvent(failedBordered, 'failed', 10000),
    waitForEvent(loadedImage, 'loaded', 10000),
  ]);

  if (settled[0] === false || settled[1] === false || settled[2] === false) {
    console.error('[texture-placeholder-color] scene did not settle', settled);
    return false;
  }

  console.log('[texture-placeholder-color] scene settled');
  return true;
}
