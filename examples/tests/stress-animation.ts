import { type CoreShaderNode, type INode } from '@lightningjs/renderer';
import type { ExampleSettings } from '../common/ExampleSettings.js';
import { waitUntilIdle } from '../common/utils.js';
import lightning from '../assets/lightning.png';
import rocko from '../assets/rocko.png';
import testscreen from '../assets/testscreen.png';
import robot from '../assets/robot/robot.png';
import environment from '../assets/robot/environment.png';
import elevator from '../assets/robot/elevator-background.png';

/**
 * TV animation stress test (FPS + VAO focus).
 *
 * Sibling of `stress-tv`, but **dynamic**. `stress-tv` builds a static grid: once
 * built nothing changes per frame, so render is cheap, FPS pins at the panel's
 * vsync (~60), and VAO makes no visible difference. This test continuously
 * animates x/y, so every frame has changing transforms -> nodes go dirty -> they
 * are re-uploaded and re-drawn -> the per-draw attribute-binding cost is paid
 * every frame. That is exactly where VAO matters (one `bindVertexArray` per draw
 * vs N x `vertexAttribPointer` + `enableVertexAttribArray`), so here FPS is a
 * meaningful metric and the VAO delta is measurable at high node counts.
 *
 * Scene: a real TV home screen — a vertical stack of rows (rails), each row a
 * parent node holding a horizontal strip of cards (rounded-rect bg + image
 * thumbnail, optionally an SDF label). Nesting lets us test two distinct costs:
 *   - Row animation:  slide each row container's x. Moving a parent updates the
 *     world transform of all its children (transform-propagation cost) with few
 *     animation drivers.
 *   - Card animation: move each card's x/y individually (more dirty nodes, more
 *     drivers).
 *
 * Run with the live overlay for FPS / draw-call / quad / VAO read-out:
 *   ?test=stress-animation&debug=true
 *
 * A/B the VAO optimization by reloading with and without (it is fixed at
 * renderer construction — you cannot flip it at runtime):
 *   ?test=stress-animation&debug=true&novao=true
 * At a high animated node count, `novao=true` should show LOWER FPS and HIGHER
 * `vertexAttribPointer` / `enableVertexAttribArray` counts than the default,
 * while VAO-on keeps those near zero and `bindVAO` tracks the draw count.
 *
 * Remote controls (arrows + OK only):
 *   Up / Down    : step node count up / down through the ladder (rebuilds scene)
 *   Left / Right : cycle scene tier (rect -> +image -> +image+title)
 *   Enter (OK)   : toggle animation on/off AND switch row-anim vs card-anim
 *                  (off -> row -> card -> off ...)
 *
 * Automatic sweep — find the highest animated node count that still holds the
 * target FPS, for every tier, no remote needed:
 *   ?test=stress-animation&autosweep=true               (default 60 fps target)
 *   ?test=stress-animation&autosweep=true&targetfps=50
 * Sustained animated FPS is the metric (not load time — that is stress-tv's job).
 * Results print to the console (console.table) and to an on-screen panel. A/B the
 * VAO by running once with and once without `&novao=true`.
 */

// Distinct image sources cycled per card so the batcher has to switch textures —
// that is what makes attribute re-binding (and thus the VAO win) actually show
// up in the numbers.
const IMAGES = [lightning, rocko, testscreen, robot, environment, elevator];

// Node-count ladder (total cards). Up/Down move one rung so the whole range is
// reachable in a handful of remote presses from the couch.
const COUNT_LADDER = [50, 100, 200, 400, 800, 1200, 1600, 2000];

const TIER_NAMES = ['1: rounded rect only', '2: + image', '3: + image + title'];

// Animation drivers: which transform we churn every frame.
const ANIM_OFF = 0;
const ANIM_ROW = 1; // slide each row container's x (few drivers, deep propagation)
const ANIM_CARD = 2; // move each card's x/y (many drivers, many dirty nodes)
const ANIM_NAMES = ['off', 'row', 'card'];

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

// Main quads per card: rounded-rect background (+ image thumbnail from tier 1).
const quadsPerCard = (t: number): number => (t >= 1 ? 2 : 1);
// SDF glyphs per card: ~8 for the title (tier 2+).
const glyphsPerCard = (t: number): number => (t >= 2 ? 8 : 0);

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
  // A moving scene is non-deterministic, so we snapshot the INITIAL static
  // layout (animation is left off; `test` builds tier-2, 200 cards) before any
  // motion starts. Math.random is seeded in automation mode, so the layout is
  // reproducible.
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

  // Measure raw capability, not a throttle — otherwise FPS pins at the panel
  // refresh and the VAO delta is invisible. This is the whole point of the test.
  renderer.targetFPS = 0;

  renderer.createNode({
    x: 0,
    y: 0,
    w: APP_W,
    h: APP_H,
    color: 0x0f172aff, // dark slate background (0xRRGGBBAA)
    parent: testRoot,
  });

  // Container the whole scene hangs off so a rebuild is one destroy + refill.
  let sceneRoot = renderer.createNode({
    x: 0,
    y: 0,
    w: APP_W,
    h: APP_H,
    parent: testRoot,
  });

  // Row containers (animation drivers in row mode) and the flat card list
  // (drivers in card mode). Kept as references so destroy()/rebuild is cheap and
  // the per-frame loop can index them without allocating.
  let rows: INode[] = [];
  let cards: INode[] = [];
  // Pre-allocated base positions, reused every frame to avoid per-frame GC.
  let rowBaseX = new Float32Array(0);
  let cardBaseX = new Float32Array(0);
  let cardBaseY = new Float32Array(0);
  // Per-build animation amplitudes (px), scaled to the current cell size.
  let rowAmp = 0;
  let cardAmpX = 0;
  let cardAmpY = 0;

  // Hoisted shared shader: radius is recomputed per build, so we hold one
  // instance and only recreate it when the radius actually changes — never per
  // card.
  let roundedRadius = -1;
  let roundedShader = renderer.createShader('Rounded', {
    radius: 0,
  }) as CoreShaderNode;

  let ladderIndex = 2; // 200
  let tier = 1; // +image by default — texture switches are where VAO matters most
  let animMode = ANIM_OFF; // automation/initial frame is static; toggled with OK

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
      `cards ${currentCount()}   tier ${TIER_NAMES[tier]}   anim ${
        ANIM_NAMES[animMode]
      }\n` +
      'Up/Down count   Left/Right tier   OK anim(off/row/card)   (add ?debug=true for FPS/VAO)';
  };

  // Speeds (rad/s). Distinct per mode so the motion reads as continuous churn
  // rather than a synchronized march.
  const ROW_SPEED = 1.6;
  const CARD_SPEED = 2.6;

  // The per-frame animation loop. Zero-allocation: number locals only, indexed
  // for-loops, every array pre-allocated and reused (CLAUDE.md hot-path rules).
  // Runs continuously; `animMode === ANIM_OFF` just skips the mutation so the
  // loop stays alive for toggling.
  const tick = (now: number): void => {
    if (animMode === ANIM_OFF) {
      requestAnimationFrame(tick);
      return;
    }
    const t = now * 0.001; // ms -> s
    if (animMode === ANIM_ROW) {
      // Slide each row horizontally. One driver per row; the child cards move
      // for free via world-transform propagation.
      for (let i = 0; i < rows.length; i++) {
        rows[i]!.x = rowBaseX[i]! + rowAmp * Math.sin(t * ROW_SPEED + i * 0.3);
      }
    } else {
      // Move each card on its own x/y. One driver per card -> maximum dirty
      // nodes and per-draw rebinds.
      for (let i = 0; i < cards.length; i++) {
        const phase = i * 0.15;
        const card = cards[i]!;
        card.x = cardBaseX[i]! + cardAmpX * Math.sin(t * CARD_SPEED + phase);
        card.y = cardBaseY[i]! + cardAmpY * Math.cos(t * CARD_SPEED + phase);
      }
    }
    requestAnimationFrame(tick);
  };

  const buildScene = (count: number): void => {
    // Tear down the previous scene in one shot — destroy() recurses to children.
    sceneRoot.destroy();
    rows = [];
    cards = [];

    sceneRoot = renderer.createNode({
      x: 0,
      y: 0,
      w: APP_W,
      h: APP_H,
      parent: testRoot,
    });

    // Auto-fit a near-square cell grid across the screen so on-screen fill stays
    // ~constant regardless of count, and cards stay on-screen under animation
    // (overscan is small relative to boundsMargin). `cols` is cards-per-row,
    // `rowCount` is the number of rails.
    const cols = Math.max(1, Math.ceil(Math.sqrt(count * (APP_W / APP_H))));
    const rowCount = Math.max(1, Math.ceil(count / cols));
    const cellW = APP_W / cols;
    const cellH = APP_H / rowCount;
    const gap = Math.min(cellW, cellH) * 0.08;
    const cardW = cellW - gap;
    const cardH = cellH - gap;
    const radius = Math.min(24, Math.min(cardW, cardH) * 0.12);
    const fontSize = Math.max(8, Math.min(28, cardH * 0.16));

    // Recreate the shared rounded shader only when the radius changes.
    if (radius !== roundedRadius) {
      roundedRadius = radius;
      roundedShader = renderer.createShader('Rounded', {
        radius,
      }) as CoreShaderNode;
    }

    // Animation amplitudes scaled to the cell so motion is visible but cards
    // stay mostly on-screen.
    rowAmp = Math.min(150, cellW * 0.6);
    cardAmpX = cellW * 0.15;
    cardAmpY = cellH * 0.15;

    rowBaseX = new Float32Array(rowCount);
    cardBaseX = new Float32Array(count);
    cardBaseY = new Float32Array(count);

    for (let r = 0; r < rowCount; r++) {
      // Row container: a full-width rail at this vertical slot. Animating its x
      // slides every card it owns.
      const rowNode = renderer.createNode<CoreShaderNode>({
        x: 0,
        y: r * cellH,
        w: APP_W,
        h: cellH,
        parent: sceneRoot,
      });
      rows.push(rowNode);
      rowBaseX[r] = 0;

      for (let c = 0; c < cols; c++) {
        const i = r * cols + c;
        if (i >= count) {
          break;
        }
        // Card positions are relative to the row container.
        const cx = c * cellW + gap * 0.5;
        const cy = gap * 0.5;
        cardBaseX[i] = cx;
        cardBaseY[i] = cy;

        // Tier 0+: rounded-rectangle card background (shared shader instance).
        const card = renderer.createNode({
          x: cx,
          y: cy,
          w: cardW,
          h: cardH,
          color: 0x1e293bff, // slate-800 (0xRRGGBBAA)
          shader: roundedShader,
          parent: rowNode,
        });
        cards.push(card);

        // Tier 1+: image thumbnail filling most of the card. Cycled sources
        // force texture switches -> attribute rebinds -> VAO-relevant work.
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

        // Tier 2+: SDF title. SDF moves via transform only (no per-frame
        // re-raster), so it is safe to animate; Canvas text would OOM.
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
      }
    }

    updateHud();
    console.log(
      `stress-animation: ${count} cards, tier ${
        tier + 1
      }, ${cols}x${rowCount} grid, anim ${ANIM_NAMES[animMode]}`,
    );
  };

  // Drive every tier from low to high and find the highest animated node count
  // that still holds the target FPS, then bisect for a sharper number.
  //
  // Unlike stress-tv (static -> FPS pins at vsync -> load time is the only
  // signal), this scene is animated, so sustained FPS DOES reveal the limit:
  // every frame re-uploads the moving transforms and pays the per-draw rebind
  // cost. That is the cost VAO removes, so the sweep is run twice (with/without
  // &novao=true) to read the delta.
  const runAutoSweep = async (target: number): Promise<void> => {
    interface SweepResult {
      tier: string;
      sweetSpot: number;
      fps: number;
      limiter: string;
    }
    const results: SweepResult[] = [];
    const ladderMax = COUNT_LADDER[COUNT_LADDER.length - 1]!;

    // Build at `count`, let it settle, then measure sustained animated FPS.
    const measureAt = async (count: number): Promise<number> => {
      buildScene(count);
      await waitUntilIdle(renderer);
      return await measureFps(40);
    };

    animMode = ANIM_CARD; // worst case: most drivers, most dirty nodes

    for (let t = 0; t < TIER_NAMES.length; t++) {
      tier = t;
      // Never test past the index cap (geometry would drop) OR the ladder max.
      const cap = correctnessCap(t);
      const rungs = COUNT_LADDER.filter((c) => c <= cap);

      let lastGood = 0;
      let lastGoodFps = 0;
      let firstBad = 0;
      for (let r = 0; r < rungs.length; r++) {
        const count = rungs[r]!;
        hud.text = `auto-sweep - tier ${t + 1}/${
          TIER_NAMES.length
        }, measuring ${count} cards...`;
        const fps = await measureAt(count);
        console.log(`  tier ${t + 1}  ${count} cards  ${Math.round(fps)} fps`);
        if (fps >= target) {
          lastGood = count;
          lastGoodFps = fps;
        } else {
          firstBad = count;
          break;
        }
      }

      // Bisect the gap between the last in-target rung and the first below it.
      let sweet = lastGood;
      let sweetFps = lastGoodFps;
      if (firstBad > 0 && firstBad - lastGood > 25) {
        let lo = lastGood;
        let hi = firstBad;
        while (hi - lo > 25) {
          const mid = (lo + hi) >> 1;
          const fps = await measureAt(mid);
          if (fps >= target) {
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
          ? `<${target}fps`
          : cap < ladderMax
          ? 'index cap'
          : 'ladder max';
      results.push({
        tier: TIER_NAMES[t]!,
        sweetSpot: sweet,
        fps: Math.round(sweetFps),
        limiter,
      });
    }

    console.log(
      `\n=== stress-animation sweet spots (target ${target} fps, anim card, VAO ${
        vaoOff === true ? 'OFF' : 'ON'
      }) ===`,
    );
    console.table(results);

    // Render the verdict on screen (small static scene — well under the cap).
    animMode = ANIM_OFF;
    sceneRoot.destroy();
    rows = [];
    cards = [];
    hud.text = '';
    let panel = `SWEET SPOT - holds >=${target}fps (anim card)   VAO ${
      vaoOff === true ? 'OFF' : 'ON'
    }\n`;
    for (let i = 0; i < results.length; i++) {
      const r = results[i]!;
      panel += `tier ${i + 1}: ${r.sweetSpot} cards  (${r.fps} fps, ${
        r.limiter
      })\n`;
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

  // Kick the animation loop once; it self-reschedules and reads the live arrays
  // so a rebuild needs no restart.
  requestAnimationFrame(tick);

  window.addEventListener('keydown', (event) => {
    const key = event.key;

    if (key === 'ArrowUp') {
      if (ladderIndex < COUNT_LADDER.length - 1) {
        ladderIndex++;
        buildScene(currentCount());
      }
      return;
    }
    if (key === 'ArrowDown') {
      if (ladderIndex > 0) {
        ladderIndex--;
        buildScene(currentCount());
      }
      return;
    }
    if (key === 'ArrowRight') {
      tier = (tier + 1) % TIER_NAMES.length;
      buildScene(currentCount());
      return;
    }
    if (key === 'ArrowLeft') {
      tier = (tier + TIER_NAMES.length - 1) % TIER_NAMES.length;
      buildScene(currentCount());
      return;
    }
    if (key === 'Enter') {
      // Cycle off -> row -> card -> off. No rebuild needed; the tick reads
      // animMode and the base positions are already stored.
      animMode = (animMode + 1) % 3;
      updateHud();
      return;
    }
  });

  buildScene(currentCount());
}
