import { type INode } from '@lightningjs/renderer';
import type { ExampleSettings } from '../common/ExampleSettings.js';
import lightning from '../assets/lightning.png';
import rocko from '../assets/rocko.png';
import testscreen from '../assets/testscreen.png';
import robot from '../assets/robot/robot.png';
import environment from '../assets/robot/environment.png';
import elevator from '../assets/robot/elevator-background.png';

/**
 * TV CPU/GPU bound stress test.
 *
 * Renders a "real" TV home-screen grid: rounded-rectangle cards with image
 * thumbnails and SDF text. The grid auto-fits the screen so total fill stays
 * roughly constant as the card count changes — that keeps the GPU fill load
 * fixed while the CPU per-node cost scales with count, which is what lets you
 * separate the two bottlenecks.
 *
 * Run with the live overlay for FPS / draw-call / quad / VAO read-out:
 *   ?test=stress-tv&debug=true
 *
 * A/B the VAO optimization by reloading with and without:
 *   ?test=stress-tv&debug=true&novao=true
 *
 * Diagnose CPU vs GPU at a given count:
 *   - lower ?resolution=540 (or ?ppr) recovers FPS  -> GPU / fill bound
 *   - ?novao=true drops FPS, vAttribPtr/enaVAA climb -> CPU / driver bound
 *   - more cards at the same fill drops FPS          -> CPU / scene-graph bound
 *
 * Remote controls (arrows + OK only):
 *   Up / Down    : step card count up / down through the ladder (rebuilds grid)
 *   Left / Right : cycle scene tier (rect -> +image -> +text -> full card)
 *   Enter (OK)   : toggle an alpha pulse on every card (adds per-frame churn)
 */

// Distinct image sources cycled per card so the batcher has to switch
// textures — that is what makes attribute re-binding (and thus the VAO win)
// actually show up in the numbers.
const IMAGES = [lightning, rocko, testscreen, robot, environment, elevator];

// Card-count ladder. Up/Down move one rung so the whole range is reachable in
// a handful of remote presses from the couch.
const COUNT_LADDER = [50, 100, 200, 400, 800, 1200, 1600, 2000, 3000, 4000];

const TIER_NAMES = [
  '1: rounded rect only',
  '2: + image',
  '3: + image + title',
  '4: full card (img + title + subtitle)',
];

const APP_W = 1920;
const APP_H = 1080;

const randomTitle = (length: number): string => {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ abcdefghijklmnopqrstuvwxyz';
  let out = '';
  for (let i = 0; i < length; i++) {
    out += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return out;
};

export default async function ({
  renderer,
  testRoot,
  perfMultiplier,
}: ExampleSettings) {
  renderer.createNode({
    x: 0,
    y: 0,
    w: APP_W,
    h: APP_H,
    color: 0x0f172aff, // dark slate background (0xRRGGBBAA)
    parent: testRoot,
  });

  // Container the whole grid hangs off so a rebuild is one destroy + refill.
  let gridRoot = renderer.createNode({
    x: 0,
    y: 0,
    w: APP_W,
    h: APP_H,
    parent: testRoot,
  });

  let cards: INode[] = [];
  let pulsing = false;

  // Start near a rung scaled by ?multiplier so automation/large runs can bias up.
  let ladderIndex = 2; // 200
  let tier = 3; // full card by default — the realistic TV workload

  // Bottom-left so it never collides with the top-left ?debug=true overlay.
  const hud = renderer.createTextNode({
    x: 20,
    y: APP_H - 150,
    fontFamily: 'Ubuntu',
    textRendererOverride: 'sdf', // never Canvas here — it re-rasterizes per edit and OOMs TVs
    fontSize: 22,
    color: 0xffffffff,
    text: '',
    zIndex: 1000,
    parent: testRoot,
  });

  const currentCount = (): number => {
    const base = COUNT_LADDER[ladderIndex]!;
    return Math.max(1, Math.round(base * perfMultiplier));
  };

  const updateHud = (): void => {
    hud.text =
      `cards ${currentCount()}   tier ${TIER_NAMES[tier]}   pulse ${
        pulsing === true ? 'on' : 'off'
      }\n` +
      'Up/Down count   Left/Right tier   OK pulse   (add ?debug=true for FPS/draws/quads/VAO)';
  };

  const buildGrid = (): void => {
    // Tear down the previous grid in one shot — destroy() recurses to children.
    gridRoot.destroy();
    cards = [];

    gridRoot = renderer.createNode({
      x: 0,
      y: 0,
      w: APP_W,
      h: APP_H,
      parent: testRoot,
    });

    const count = currentCount();

    // Auto-fit a near-square cell grid across the screen so on-screen fill
    // stays ~constant regardless of count.
    const cols = Math.max(1, Math.ceil(Math.sqrt(count * (APP_W / APP_H))));
    const rows = Math.max(1, Math.ceil(count / cols));
    const cellW = APP_W / cols;
    const cellH = APP_H / rows;
    const gap = Math.min(cellW, cellH) * 0.08;
    const cardW = cellW - gap;
    const cardH = cellH - gap;
    const radius = Math.min(24, Math.min(cardW, cardH) * 0.12);
    const fontSize = Math.max(8, Math.min(28, cardH * 0.16));

    for (let i = 0; i < count; i++) {
      const col = i % cols;
      const row = (i / cols) | 0;
      const x = col * cellW + gap * 0.5;
      const y = row * cellH + gap * 0.5;

      // Tier 1+: rounded-rectangle card background (the borderRadius cost).
      const card = renderer.createNode({
        x,
        y,
        w: cardW,
        h: cardH,
        color: 0x1e293bff, // slate-800 (0xRRGGBBAA)
        shader: renderer.createShader('Rounded', { radius }),
        parent: gridRoot,
      });
      cards.push(card);

      // Tier 2+: image thumbnail filling most of the card.
      if (tier >= 1) {
        renderer.createNode({
          x: gap * 0.5,
          y: gap * 0.5,
          w: cardW - gap,
          h: cardH * 0.6,
          src: IMAGES[i % IMAGES.length]!,
          parent: card,
        });
      }

      // Tier 3+: SDF title.
      if (tier >= 2) {
        renderer.createTextNode({
          x: gap,
          y: cardH * 0.62,
          fontFamily: 'Ubuntu',
          textRendererOverride: 'sdf',
          fontSize,
          color: 0xffffffff,
          text: randomTitle(8),
          parent: card,
        });
      }

      // Tier 4: SDF subtitle.
      if (tier >= 3) {
        renderer.createTextNode({
          x: gap,
          y: cardH * 0.62 + fontSize * 1.3,
          fontFamily: 'Ubuntu',
          textRendererOverride: 'sdf',
          fontSize: fontSize * 0.8,
          color: 0x94a3b8ff, // slate-400 (0xRRGGBBAA)
          text: randomTitle(12),
          parent: card,
        });
      }
    }

    if (pulsing === true) {
      startPulse();
    }

    updateHud();
    console.log(
      `stress-tv: ${count} cards, tier ${tier + 1}, ${cols}x${rows} grid`,
    );
  };

  const startPulse = (): void => {
    for (let i = 0; i < cards.length; i++) {
      cards[i]!.animate(
        { alpha: 0.4 },
        { duration: 1000, loop: true, easing: 'ease-in-out' },
      ).start();
    }
  };

  window.addEventListener('keydown', (event) => {
    const key = event.key;

    if (key === 'ArrowUp') {
      if (ladderIndex < COUNT_LADDER.length - 1) {
        ladderIndex++;
        buildGrid();
      }
      return;
    }
    if (key === 'ArrowDown') {
      if (ladderIndex > 0) {
        ladderIndex--;
        buildGrid();
      }
      return;
    }
    if (key === 'ArrowRight') {
      tier = (tier + 1) % TIER_NAMES.length;
      buildGrid();
      return;
    }
    if (key === 'ArrowLeft') {
      tier = (tier + TIER_NAMES.length - 1) % TIER_NAMES.length;
      buildGrid();
      return;
    }
    if (key === 'Enter') {
      pulsing = pulsing !== true;
      buildGrid();
      return;
    }
  });

  buildGrid();
}
