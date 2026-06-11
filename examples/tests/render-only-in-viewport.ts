import type { RendererMainSettings } from '@lightningjs/renderer';
import type { ExampleSettings } from '../common/ExampleSettings.js';

/**
 * Manual A/B page for the `renderOnlyInViewport` renderer setting.
 *
 * The scene puts a row of color quads across all three bounds zones of a
 * 400px bounds margin: some in the viewport, some in the margin ring, some
 * beyond it. Open with `?test=render-only-in-viewport&debug=true` and
 * compare the overlay's `draws`/`quads` counters:
 *
 * - `&strictrender=false` (gate off, legacy behavior): margin-ring quads are
 *   submitted and GPU-clipped — they count.
 * - default (gate on, the renderer default): margin-ring quads stay out of
 *   the render list — `quads` drops by the ring count, pixels identical.
 *
 * No `automation` export on purpose: the feature changes no pixels, so there
 * is nothing for the snapshot suite to capture — behavior is asserted by the
 * CoreNode/CoreTextNode unit tests.
 */

export function customSettings(
  urlParams: URLSearchParams,
): Partial<RendererMainSettings> {
  return {
    boundsMargin: 400,
    renderOnlyInViewport: urlParams.get('strictrender') !== 'false',
  };
}

export default async function test({ renderer, testRoot }: ExampleSettings) {
  renderer.createTextNode({
    fontFamily: 'Ubuntu',
    text: 'renderOnlyInViewport — compare quads with ?debug=true and ?strictrender=false',
    fontSize: 28,
    color: 0xffffffff,
    x: 20,
    y: 980,
    parent: testRoot,
  });

  // 6 quads in the viewport (appWidth 1920), 2 in the margin ring
  // (1920..2320), 5 beyond it (> 2320, never processed either way).
  const colors = [0x336699ff, 0x993311ff, 0x339933ff];
  for (let i = 0; i < 13; i++) {
    renderer.createNode({
      x: 40 + i * 320,
      y: 300,
      w: 280,
      h: 400,
      color: colors[i % 3],
      parent: testRoot,
    });
  }

  return true;
}
