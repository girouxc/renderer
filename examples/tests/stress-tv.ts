import { type INode } from '@lightningjs/renderer';
import type { ExampleSettings } from '../common/ExampleSettings.js';
import { waitUntilIdle } from '../common/utils.js';
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
 *
 * Automatic sweep — find the "sweet spot" (highest card count that still holds
 * the target frame rate) for every tier, no remote needed:
 *   ?test=stress-tv&autosweep=true            (target 60 fps)
 *   ?test=stress-tv&autosweep=true&targetfps=30
 * Results print to the console (console.table) and to an on-screen panel.
 * VAO is fixed at renderer construction, so A/B it with two runs and compare:
 *   ?test=stress-tv&autosweep=true   vs   ?test=stress-tv&autosweep=true&novao=true
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

// Hard per-frame ceiling of the Uint16 index buffer: 16384 quads, and
// independently 16384 glyphs. Past it, geometry drops out regardless of FPS —
// a correctness wall distinct from the performance wall. The auto-sweep clamps
// to it so it never reports a count whose own text would have vanished.
const QUAD_CAP = 16384;
// Glyphs spent on the HUD + debug overlay + results panel — reserved so the
// sweep's own UI stays inside the cap.
const RESERVED_GLYPHS = 300;

// Main quads per card: rounded-rect background (+ image thumbnail from tier 2).
const quadsPerCard = (t: number): number => (t >= 1 ? 2 : 1);
// SDF glyphs per card: ~8 for the title (tier 3+), +12 for the subtitle (tier 4).
const glyphsPerCard = (t: number): number => (t >= 3 ? 20 : t >= 2 ? 8 : 0);

// Highest card count for tier `t` that stays under the index-buffer ceiling.
const correctnessCap = (t: number): number => {
  const byQuads = Math.floor(QUAD_CAP / quadsPerCard(t));
  const g = glyphsPerCard(t);
  const byGlyphs =
    g > 0 ? Math.floor((QUAD_CAP - RESERVED_GLYPHS) / g) : Infinity;
  return Math.min(byQuads, byGlyphs);
};

// Median FPS over `frames` animation frames, discarding a short warm-up so the
// rebuild spike and first-frame text/texture upload don't skew the result.
const measureFps = (frames: number): Promise<number> =>
  new Promise((resolve) => {
    const deltas: number[] = [];
    const warmup = 15;
    let seen = 0;
    let last = performance.now();
    const tick = (now: number): void => {
      const d = now - last;
      last = now;
      seen++;
      if (seen > warmup) {
        deltas.push(d);
      }
      if (deltas.length < frames) {
        requestAnimationFrame(tick);
        return;
      }
      deltas.sort((a, b) => a - b);
      const median = deltas[deltas.length >> 1]!;
      resolve(1000 / median);
    };
    requestAnimationFrame(tick);
  });

export async function automation(settings: ExampleSettings) {
  // No autosweep/key driving in automation — `test` builds the default scene
  // (tier 4, 200 cards: rounded cards + images + SDF text). Wait for textures
  // and text layout to settle so the snapshot is the stable final frame.
  await test(settings);
  await waitUntilIdle(settings.renderer);
  await settings.snapshot();
}

export default async function test({
  renderer,
  testRoot,
  perfMultiplier,
}: ExampleSettings) {
  const params = new URLSearchParams(window.location.search);
  const autosweep = params.get('autosweep') === 'true';
  const targetFps = Number(params.get('targetfps') ?? 60);
  const vaoOff = params.get('novao') === 'true';

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

  const buildGrid = (count: number): void => {
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

  // Drive every tier from low to high, find the highest count that holds the
  // target frame rate, then bisect between the last good rung and the first bad
  // one for a sharper number. Counts are clamped to the index-buffer cap so the
  // sweep never builds a scene whose own text would drop out.
  const runAutoSweep = async (targetFps: number): Promise<void> => {
    // Measure raw capability, not a throttle.
    renderer.targetFPS = 0;
    const meets = (fps: number): boolean => fps >= targetFps - 2;

    interface SweepResult {
      tier: string;
      sweetSpot: number;
      fps: number;
      limiter: string;
      indexCap: number;
    }
    const results: SweepResult[] = [];

    for (let t = 0; t < TIER_NAMES.length; t++) {
      tier = t;
      const cap = correctnessCap(t);
      const rungs = COUNT_LADDER.filter((c) => c <= cap);
      if (cap !== Infinity && rungs[rungs.length - 1] !== cap) {
        rungs.push(cap);
      }

      let lastGood = 0;
      let lastGoodFps = 0;
      let firstBad = 0;
      for (let r = 0; r < rungs.length; r++) {
        const count = rungs[r]!;
        buildGrid(count);
        hud.text = `auto-sweep — tier ${t + 1}/${
          TIER_NAMES.length
        }, testing ${count} cards…`;
        const fps = await measureFps(35);
        console.log(`  tier ${t + 1}  ${count} cards  ${fps.toFixed(1)} fps`);
        if (meets(fps) === true) {
          lastGood = count;
          lastGoodFps = fps;
        } else {
          firstBad = count;
          break;
        }
      }

      // Bisect the gap between the last good and first bad rung.
      let sweet = lastGood;
      let sweetFps = lastGoodFps;
      if (firstBad > 0 && firstBad - lastGood > 25) {
        let lo = lastGood;
        let hi = firstBad;
        while (hi - lo > 25) {
          const mid = (lo + hi) >> 1;
          buildGrid(mid);
          const fps = await measureFps(30);
          if (meets(fps) === true) {
            lo = mid;
            sweetFps = fps;
          } else {
            hi = mid;
          }
        }
        sweet = lo;
      }

      const limiter =
        firstBad > 0
          ? `${targetFps}fps`
          : cap !== Infinity && sweet >= cap
          ? 'index cap'
          : 'ladder max';
      results.push({
        tier: TIER_NAMES[t]!,
        sweetSpot: sweet,
        fps: Math.round(sweetFps),
        limiter,
        indexCap: cap === Infinity ? 0 : cap,
      });
    }

    console.log(`\n=== stress-tv sweet spots (target ${targetFps} fps) ===`);
    console.table(results);

    // Render the verdict on screen (small scene — well under the cap).
    gridRoot.destroy();
    cards = [];
    hud.text = '';
    let panel = `SWEET SPOT @ ${targetFps} fps   (VAO ${
      vaoOff === true ? 'OFF' : 'ON'
    })\n`;
    for (let i = 0; i < results.length; i++) {
      const r = results[i]!;
      panel += `tier ${i + 1}: ${r.sweetSpot} cards  (${
        r.fps
      } fps, limited by ${r.limiter})\n`;
    }
    panel += 'Re-run with &novao=true to compare VAO off.';
    renderer.createTextNode({
      x: 40,
      y: 60,
      fontFamily: 'Ubuntu',
      textRendererOverride: 'sdf',
      fontSize: 30,
      lineHeight: 42,
      color: 0xffffffff,
      text: panel,
      parent: testRoot,
    });
  };

  if (autosweep === true) {
    void runAutoSweep(targetFps);
    return;
  }

  window.addEventListener('keydown', (event) => {
    const key = event.key;

    if (key === 'ArrowUp') {
      if (ladderIndex < COUNT_LADDER.length - 1) {
        ladderIndex++;
        buildGrid(currentCount());
      }
      return;
    }
    if (key === 'ArrowDown') {
      if (ladderIndex > 0) {
        ladderIndex--;
        buildGrid(currentCount());
      }
      return;
    }
    if (key === 'ArrowRight') {
      tier = (tier + 1) % TIER_NAMES.length;
      buildGrid(currentCount());
      return;
    }
    if (key === 'ArrowLeft') {
      tier = (tier + TIER_NAMES.length - 1) % TIER_NAMES.length;
      buildGrid(currentCount());
      return;
    }
    if (key === 'Enter') {
      pulsing = pulsing !== true;
      buildGrid(currentCount());
      return;
    }
  });

  buildGrid(currentCount());
}
