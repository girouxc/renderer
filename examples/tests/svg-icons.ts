import type { ExampleSettings } from '../common/ExampleSettings.js';

import playArrow from '../assets/svg-icons/play_arrow.svg';
import pause from '../assets/svg-icons/pause.svg';
import skipNext from '../assets/svg-icons/skip_next.svg';
import skipPrevious from '../assets/svg-icons/skip_previous.svg';
import replay10 from '../assets/svg-icons/replay_10.svg';
import forward10 from '../assets/svg-icons/forward_10.svg';
import volumeUp from '../assets/svg-icons/volume_up.svg';
import fullscreen from '../assets/svg-icons/fullscreen.svg';
import subtitles from '../assets/svg-icons/subtitles.svg';
import settings from '../assets/svg-icons/settings.svg';
import cast from '../assets/svg-icons/cast.svg';
import info from '../assets/svg-icons/info.svg';
import liveTv from '../assets/svg-icons/live_tv.svg';
import movie from '../assets/svg-icons/movie.svg';
import home from '../assets/svg-icons/home.svg';
import search from '../assets/svg-icons/search.svg';

import rocko2 from '../assets/rocko2.svg';

/**
 * Visual regression test for SVG loading.
 *
 * Exercises:
 *   - SVGs rasterized at their natural intrinsic size (24x24 MDI icons)
 *   - SVGs upscaled 4x and 16x to test DPR-aware rasterization — without
 *     DPR scaling these are visibly soft/blurry on HiDPI displays
 *   - Source-region crop via srcX/srcY/srcWidth/srcHeight
 *   - Cross-origin SVG load from jsdelivr (verifies img.crossOrigin path)
 */

const ICONS: Array<{ src: string; name: string }> = [
  { src: playArrow, name: 'play_arrow' },
  { src: pause, name: 'pause' },
  { src: skipPrevious, name: 'skip_prev' },
  { src: skipNext, name: 'skip_next' },
  { src: replay10, name: 'replay_10' },
  { src: forward10, name: 'forward_10' },
  { src: volumeUp, name: 'volume_up' },
  { src: fullscreen, name: 'fullscreen' },
  { src: subtitles, name: 'subtitles' },
  { src: settings, name: 'settings' },
  { src: cast, name: 'cast' },
  { src: info, name: 'info' },
  { src: liveTv, name: 'live_tv' },
  { src: movie, name: 'movie' },
  { src: home, name: 'home' },
  { src: search, name: 'search' },
];

const CROSS_ORIGIN_SVG =
  'https://cdn.jsdelivr.net/npm/@material-design-icons/svg@latest/filled/favorite.svg';

function waitForLoaded(
  node: { once: (event: string, cb: () => void) => void },
  timeoutMs = 3000,
): Promise<boolean> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), timeoutMs);
    node.once('loaded', () => {
      clearTimeout(timer);
      resolve(true);
    });
    node.once('failed', () => {
      clearTimeout(timer);
      resolve(false);
    });
  });
}

export async function automation(settings: ExampleSettings) {
  await test(settings);
  await settings.snapshot();
}

export default async function test({ renderer, testRoot }: ExampleSettings) {
  // Light background panel so the black MDI icons are visible
  renderer.createNode({
    x: 0,
    y: 0,
    w: 1920,
    h: 1080,
    color: 0xf5f5f5ff,
    parent: testRoot,
  });

  renderer.createTextNode({
    x: 30,
    y: 20,
    text: 'SVG Icons — DPR sharpness, crop, cross-origin',
    fontFamily: 'Ubuntu',
    fontSize: 36,
    color: 0x202020ff,
    parent: testRoot,
  });

  // Row 1: natural size (24x24)
  renderer.createTextNode({
    x: 30,
    y: 80,
    text: '1. Natural size (24×24)',
    fontFamily: 'Ubuntu',
    fontSize: 22,
    color: 0x404040ff,
    parent: testRoot,
  });

  const ICON_NATURAL = 24;
  const ICON_NATURAL_GAP = 80;
  let i = 0;
  for (const icon of ICONS) {
    renderer.createNode({
      x: 30 + i * ICON_NATURAL_GAP,
      y: 120,
      w: ICON_NATURAL,
      h: ICON_NATURAL,
      src: icon.src,
      parent: testRoot,
    });
    i++;
  }

  // Row 2: 4x upscale (96x96) — DPR sharpness test
  renderer.createTextNode({
    x: 30,
    y: 170,
    text: '2. Upscaled 4× (96×96) — should be crisp with DPR-aware raster',
    fontFamily: 'Ubuntu',
    fontSize: 22,
    color: 0x404040ff,
    parent: testRoot,
  });

  const ICON_LARGE = 96;
  const ICON_LARGE_GAP = 110;
  i = 0;
  for (const icon of ICONS) {
    renderer.createNode({
      x: 30 + i * ICON_LARGE_GAP,
      y: 210,
      w: ICON_LARGE,
      h: ICON_LARGE,
      src: icon.src,
      parent: testRoot,
    });
    i++;
  }

  // Row 3: extreme upscale (400x400) — most visible DPR test
  renderer.createTextNode({
    x: 30,
    y: 330,
    text: '3. Extreme upscale (400×400) — sharpness at high zoom',
    fontFamily: 'Ubuntu',
    fontSize: 22,
    color: 0x404040ff,
    parent: testRoot,
  });

  renderer.createNode({
    x: 30,
    y: 370,
    w: 400,
    h: 400,
    src: playArrow,
    parent: testRoot,
  });

  renderer.createNode({
    x: 460,
    y: 370,
    w: 400,
    h: 400,
    src: liveTv,
    parent: testRoot,
  });

  renderer.createNode({
    x: 890,
    y: 370,
    w: 400,
    h: 400,
    src: search,
    parent: testRoot,
  });

  // Row 4: source-region crop (sx/sy/sw/sh)
  renderer.createTextNode({
    x: 30,
    y: 790,
    text: '4. Source-region crop (srcX/srcY/srcWidth/srcHeight on a larger SVG)',
    fontFamily: 'Ubuntu',
    fontSize: 22,
    color: 0x404040ff,
    parent: testRoot,
  });

  // Full rocko2 for reference (181x218)
  renderer.createNode({
    x: 30,
    y: 830,
    w: 181,
    h: 218,
    src: rocko2,
    parent: testRoot,
  });

  // Left half crop
  renderer.createNode({
    x: 240,
    y: 830,
    w: 90,
    h: 218,
    src: rocko2,
    srcX: 0,
    srcY: 0,
    srcWidth: 90,
    srcHeight: 218,
    parent: testRoot,
  });

  // Right half crop
  renderer.createNode({
    x: 360,
    y: 830,
    w: 91,
    h: 218,
    src: rocko2,
    srcX: 90,
    srcY: 0,
    srcWidth: 91,
    srcHeight: 218,
    parent: testRoot,
  });

  // Centered crop stretched to 2x
  renderer.createNode({
    x: 480,
    y: 830,
    w: 200,
    h: 218,
    src: rocko2,
    srcX: 40,
    srcY: 0,
    srcWidth: 100,
    srcHeight: 218,
    parent: testRoot,
  });

  // Row 5: cross-origin SVG load (jsdelivr CDN)
  renderer.createTextNode({
    x: 720,
    y: 790,
    text: '5. Cross-origin SVG (jsdelivr CDN)',
    fontFamily: 'Ubuntu',
    fontSize: 22,
    color: 0x404040ff,
    parent: testRoot,
  });

  const crossOrigin = renderer.createNode({
    x: 720,
    y: 830,
    w: 200,
    h: 200,
    src: CROSS_ORIGIN_SVG,
    parent: testRoot,
  });

  const crossOriginStatus = renderer.createTextNode({
    x: 940,
    y: 870,
    text: 'loading…',
    fontFamily: 'Ubuntu',
    fontSize: 22,
    color: 0x404040ff,
    parent: testRoot,
  });

  const ok = await waitForLoaded(crossOrigin);
  crossOriginStatus.text = ok ? 'cross-origin: OK' : 'cross-origin: FAILED';
  crossOriginStatus.color = ok ? 0x008800ff : 0xcc0000ff;
}
