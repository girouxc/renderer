import {
  RendererMain,
  type NodeLoadedPayload,
  type RendererMainSettings,
  type FpsUpdatePayload,
} from '@lightningjs/renderer';
import { WebGlRenderer, SdfTextRenderer } from '@lightningjs/renderer/webgl';
import {
  CanvasRenderer,
  CanvasTextRenderer,
} from '@lightningjs/renderer/canvas';

import { Inspector } from '@lightningjs/renderer/inspector';
import { assertTruthy } from '@lightningjs/renderer/utils';

import type {
  ExampleSettings,
  SnapshotOptions,
} from './common/ExampleSettings.js';
import { StatTracker } from './common/StatTracker.js';
import { installFonts } from './common/installFonts.js';
import { MemMonitor } from './common/MemMonitor.js';
import { setupMathRandom } from './common/setupMathRandom.js';
import { installShaders } from './common/installShaders.js';

interface TestModule {
  default: (settings: ExampleSettings) => Promise<void>;
  customSettings?: (
    urlParams: URLSearchParams,
  ) => Partial<RendererMainSettings>;
  automation?: (settings: ExampleSettings) => Promise<void>;
}

const getTestPath = (testName: string) => `./tests/${testName}.ts`;
const testRegex = /\/tests\/(.*)\.ts$/;
const getTestName = (path: string) => {
  const match = path.match(testRegex);
  if (!match) {
    throw new Error(`Invalid test path: ${path}`);
  }
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  return match[1]!;
};

const testModules = import.meta.glob('./tests/*.ts') as Record<
  string,
  () => Promise<TestModule>
>;

const appWidth = 1920;
const appHeight = 1080;
const defaultResolution = 720;
const defaultPhysicalPixelRatio = 1;

(async () => {
  // See README.md for details on the supported URL params
  const urlParams = new URLSearchParams(window.location.search);
  const automation = urlParams.get('automation') === 'true';
  /**
   * In automation mode this is a wildcard string of tests to run.
   * In manual mode this is the name of the test to run.
   */
  const test = urlParams.get('test') || (automation ? '*' : 'test');
  const showOverlay = urlParams.get('overlay') !== 'false';
  const showMemMonitor = urlParams.get('monitor') === 'true';
  const logFps = urlParams.get('fps') === 'true';
  const enableContextSpy = urlParams.get('contextSpy') === 'true';
  const perfMultiplier = Number(urlParams.get('multiplier')) || 1;
  const resolution = Number(urlParams.get('resolution')) || 720;
  const enableInspector = urlParams.get('inspector') === 'true';
  const forceWebGL2 = urlParams.get('webgl2') === 'true';
  const textureProcessingLimit =
    Number(urlParams.get('textureProcessingLimit')) || 0;
  const globalTargetFPS = Number(urlParams.get('targetFPS')) || undefined;

  const physicalPixelRatio =
    Number(urlParams.get('ppr')) || defaultPhysicalPixelRatio;
  const logicalPixelRatio = resolution / appHeight;

  let renderMode = urlParams.get('renderMode');
  if (renderMode !== 'webgl' && renderMode !== 'canvas') {
    renderMode = 'webgl';
  }

  if (!automation) {
    await runTest(
      test,
      renderMode,
      urlParams,
      showOverlay,
      showMemMonitor,
      logicalPixelRatio,
      physicalPixelRatio,
      logFps,
      enableContextSpy,
      perfMultiplier,
      enableInspector,
      forceWebGL2,
      textureProcessingLimit,
      globalTargetFPS,
    );
    return;
  }
  assertTruthy(automation);
  // Optional shard string in the form "i/N" — when present, this page only
  // runs the subset of tests where `index % N === i`. Used by the VRT runner
  // to parallelize across multiple browser pages.
  const shardParam = urlParams.get('shard');
  await runAutomation(renderMode, test, logFps, shardParam);
})().catch((err) => {
  console.error(err);
});

/**
 * Live on-screen stats overlay for device debugging (`?debug=true`).
 *
 * @remarks
 * Driven entirely by the `fpsUpdate` event so it works without DevTools — handy
 * on TVs. Surfaces fps + draw calls + quads, the backend/VAO status from
 * `capabilities`, and the per-interval GL call counts. The VAO signal lives in
 * the GL counts: with VAOs engaged, `vertexAttribPointer` / `enableVertexAttribArray`
 * stay ~0 (only spent building a VAO) while `bindVertexArray` tracks the draw count.
 */
function createDebugOverlay(renderer: RendererMain): void {
  renderer.createNode({
    x: 0,
    y: 0,
    w: 600,
    h: 168,
    color: 0x000000cc,
    zIndex: 100000,
    parent: renderer.root,
  });

  const text = renderer.createTextNode({
    x: 14,
    y: 10,
    w: 580,
    contain: 'width',
    color: 0x33ff88ff,
    // Use SDF (shared atlas) rather than the Canvas text renderer. This overlay
    // rewrites its text every interval; the Canvas renderer rasterizes a fresh
    // ImageTexture (a full bitmap) on every text change, which on a long-running
    // session leaks memory and can OOM low-RAM devices (black screen). SDF draws
    // changing text from the atlas with no per-update texture allocation.
    fontFamily: 'Ubuntu',
    textRendererOverride: 'sdf',
    fontSize: 26,
    lineHeight: 30,
    zIndex: 100001,
    text: 'debug: waiting for fpsUpdate…',
    parent: renderer.root,
  });

  renderer.on('fpsUpdate', (_target: RendererMain, d: FpsUpdatePayload) => {
    const c = d.capabilities;
    const spy = d.contextSpyData;
    const backend =
      c.renderMode === 'webgl' ? `webgl${c.webGlVersion ?? ''}` : c.renderMode;

    const lines = [
      `FPS ${d.fps}   draws ${d.renderOps}   quads ${d.quads}`,
      `${backend}  VAO:${c.vertexArrayObject === true ? 'on' : 'off'}  tex ${
        c.maxTextureSize
      }/${c.maxTextureUnits}`,
    ];

    if (spy !== null) {
      let total = 0;
      for (const key in spy) {
        total += spy[key]!;
      }
      const at = (k: string): number => spy[k] ?? 0;
      // VAO calls land under different names by backend: native WebGL2 uses
      // `bindVertexArray`, WebGL1 uses the extension's `bindVertexArrayOES`.
      const bindVao = at('bindVertexArray') + at('bindVertexArrayOES');
      lines.push(`GL calls/interval: ${total}`);
      lines.push(
        `vAttribPtr ${at('vertexAttribPointer')}  enaVAA ${at(
          'enableVertexAttribArray',
        )}`,
      );
      lines.push(
        `bindVAO ${bindVao}  drawElem ${at('drawElements')}  prog ${at(
          'useProgram',
        )}`,
      );
    }

    text.text = lines.join('\n');
  });
}

async function runTest(
  test: string,
  renderMode: string,
  urlParams: URLSearchParams,
  showOverlay: boolean,
  showMemMonitor: boolean,
  logicalPixelRatio: number,
  physicalPixelRatio: number,
  logFps: boolean,
  enableContextSpy: boolean,
  perfMultiplier: number,
  enableInspector: boolean,
  forceWebGL2: boolean,
  textureProcessingLimit: number,
  globalTargetFPS?: number,
) {
  const testModule = testModules[getTestPath(test)];
  if (!testModule) {
    throw new Error(`Test "${test}" not found`);
  }

  const module = await testModule();

  // `?debug=true` shows a live on-screen stats overlay. It needs periodic
  // fpsUpdate events and the context spy (for GL call counts), so force them on.
  const debug = urlParams.get('debug') === 'true';
  // `?novao=true` forces the per-draw attribute-binding path (VAOs off) so the
  // VAO optimization can be A/B'd on a target device.
  const disableVertexArrayObject = urlParams.get('novao') === 'true';

  const customSettings: Partial<RendererMainSettings> = {
    ...(typeof module.customSettings === 'function'
      ? module.customSettings(urlParams)
      : {}),
    ...(globalTargetFPS !== undefined && { targetFPS: globalTargetFPS }),
    ...(debug && { enableContextSpy: true, fpsUpdateInterval: 500 }),
    ...(disableVertexArrayObject && { disableVertexArrayObject: true }),
  };

  const { renderer, appElement } = await initRenderer(
    renderMode,
    logFps,
    enableContextSpy,
    logicalPixelRatio,
    physicalPixelRatio,
    enableInspector,
    forceWebGL2,
    textureProcessingLimit,
    customSettings,
  );

  let testRoot = renderer.root;

  if (showOverlay) {
    const overlayText = renderer.createTextNode({
      color: 0xff0000ff,
      text: `Test: ${test}`,
      zIndex: 99999,
      parent: renderer.root,
      fontSize: 50,
    });
    overlayText.on(
      'loaded',
      (target: any, { type, dimensions }: NodeLoadedPayload) => {
        if (type !== 'text') {
          return;
        }

        overlayText.x = renderer.settings.appWidth - dimensions.w - 20;
        overlayText.y = renderer.settings.appHeight - dimensions.h - 20;
      },
    );
  }

  let memMonitor: MemMonitor | null = null;
  if (showMemMonitor) {
    memMonitor = new MemMonitor(renderer, {
      mount: 1,
      x: renderer.settings.appWidth - 20,
      y: renderer.settings.appHeight - 100,
      parent: renderer.root,
      zIndex: 99999,
    });
  }

  if (showOverlay || showMemMonitor) {
    // If we're showing the overlay text or mem monitor, create a new root node
    // for the test content so it doesn't interfere with the overlay.
    testRoot = renderer.createNode({
      parent: renderer.root,
      x: renderer.root.x,
      y: renderer.root.y,
      w: renderer.settings.appWidth,
      h: renderer.settings.appHeight - 100,
      color: 0x00000000,
    });
  }

  const exampleSettings: ExampleSettings = {
    testName: test,
    renderer,
    appElement,
    testRoot,
    automation: false,
    perfMultiplier: perfMultiplier,
    snapshot: async () => {
      // No-op
    },
    memMonitor,
  };

  await module.default(exampleSettings);

  // Created last so the overlay's nodes are appended after the test content and
  // stay on top (a high zIndex alone isn't enough — appending zIndex-0 content
  // after the overlay does not always re-sort the root's children).
  if (debug) {
    createDebugOverlay(renderer);
  }
}

async function initRenderer(
  renderMode: string,
  logFps: boolean,
  enableContextSpy: boolean,
  logicalPixelRatio: number,
  physicalPixelRatio: number,
  enableInspector: boolean,
  forceWebGL2?: boolean,
  textureProcessingTimeLimit?: number,
  customSettings?: Partial<RendererMainSettings>,
) {
  let inspector: typeof Inspector | undefined;
  if (enableInspector) inspector = Inspector;
  const renderer = new RendererMain(
    {
      appWidth,
      appHeight,
      boundsMargin: [100, 100, 100, 100],
      deviceLogicalPixelRatio: logicalPixelRatio,
      devicePhysicalPixelRatio: physicalPixelRatio,
      clearColor: 0x00000000,
      fpsUpdateInterval: logFps ? 1000 : 0,
      enableContextSpy,
      forceWebGL2,
      inspector,
      renderEngine: renderMode === 'webgl' ? WebGlRenderer : CanvasRenderer,
      fontEngines: [SdfTextRenderer, CanvasTextRenderer],
      textureProcessingTimeLimit: textureProcessingTimeLimit,
      ...customSettings,
    },
    'app',
  );
  await installShaders(renderer.stage, renderMode);
  await installFonts(renderer.stage);

  /**
   * Sample data captured
   */
  const samples: StatTracker = new StatTracker();
  /**
   * Number of samples to capture before calculating FPS stats
   */
  const fpsSampleCount = 100;
  /**
   * Number of samples to skip before starting to capture FPS samples.
   */
  const fpsSampleSkipCount = 10;
  /**
   * FPS sample index
   */
  let fpsSampleIndex = 0;
  let fpsSamplesLeft = fpsSampleCount;
  renderer.on(
    'fpsUpdate',
    (target: RendererMain, fpsData: FpsUpdatePayload) => {
      const captureSample = fpsSampleIndex >= fpsSampleSkipCount;
      if (captureSample) {
        samples.add('fps', fpsData.fps);

        if (fpsData.contextSpyData) {
          let totalCalls = 0;
          for (const key in fpsData.contextSpyData) {
            const numCalls = fpsData.contextSpyData[key]!;
            totalCalls += numCalls;
            samples.add(key, numCalls);
          }
          samples.add('totalCalls', totalCalls);
        }

        fpsSamplesLeft--;
        if (fpsSamplesLeft === 0) {
          const averageFps = samples.getAverage('fps');
          const p01Fps = samples.getPercentile('fps', 1);
          const p05Fps = samples.getPercentile('fps', 5);
          const p25Fps = samples.getPercentile('fps', 25);
          const medianFps = samples.getPercentile('fps', 50);
          const stdDevFps = samples.getStdDev('fps');
          console.log(`---------------------------------`);
          console.log(`Average FPS: ${averageFps}`);
          console.log(`Median FPS: ${medianFps}`);
          console.log(`P01 FPS: ${p01Fps}`);
          console.log(`P05 FPS: ${p05Fps}`);
          console.log(`P25 FPS: ${p25Fps}`);
          console.log(`Std Dev FPS: ${stdDevFps}`);
          console.log(`Num samples: ${samples.getCount('fps')}`);
          console.log(`---------------------------------`);

          // Print out median data for all context spy data
          if (fpsData.contextSpyData) {
            const contextKeys = samples
              .getSampleGroups()
              .filter((key) => key !== 'fps' && key !== 'totalCalls');
            // Print out median data for all context spy data
            for (const key of contextKeys) {
              const median = samples.getPercentile(key, 50);
              console.log(
                `median(${key}) / median(fps): ${Math.round(
                  median / medianFps,
                )}`,
              );
            }
            const medianTotalCalls = samples.getPercentile('totalCalls', 50);
            console.log(
              `median(totalCalls) / median(fps): ${Math.round(
                medianTotalCalls / medianFps,
              )}`,
            );
            console.log(`---------------------------------`);
          }
          samples.reset();
          fpsSamplesLeft = fpsSampleCount;
        }
      }
      console.log(`FPS: ${fpsData.fps} (samples left: ${fpsSamplesLeft})`);
      fpsSampleIndex++;
    },
  );

  const appElement = document.querySelector('#app');

  assertTruthy(appElement instanceof HTMLDivElement);

  return { renderer, appElement };
}

function wildcardMatch(string: string, wildcardString: string) {
  const escapeRegex = (s: string) => s.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
  return new RegExp(
    `^${wildcardString.split('*').map(escapeRegex).join('.*')}$`,
  ).test(string);
}

async function runAutomation(
  renderMode: string,
  filter: string | null,
  logFps: boolean,
  shard: string | null,
) {
  let shardIndex = 0;
  let shardTotal = 1;
  if (shard) {
    const match = /^(\d+)\/(\d+)$/.exec(shard);
    if (match) {
      shardIndex = Number(match[1]);
      shardTotal = Number(match[2]);
    }
  }
  const logicalPixelRatio = defaultResolution / appHeight;
  const { renderer, appElement } = await initRenderer(
    renderMode,
    logFps,
    false,
    logicalPixelRatio,
    defaultPhysicalPixelRatio,
    false, // enableInspector
  );

  // Iterate through all test modules. Sort so sharding is deterministic
  // across pages, and apply the filter up front so the shard step indexes
  // only the tests that will actually run.
  const orderedPaths = Object.keys(testModules)
    .sort()
    .filter((p) => !filter || wildcardMatch(getTestName(p), filter));
  for (let i = 0; i < orderedPaths.length; i++) {
    if (i % shardTotal !== shardIndex) continue;
    const testPath = orderedPaths[i]!;
    const testModule = testModules[testPath];
    const testName = getTestName(testPath);
    assertTruthy(testModule);

    // Setup Math.random to use a seeded random number generator for consistent
    // results in automation mode.
    await setupMathRandom();

    const { automation, customSettings } = await testModule();
    console.log(`Attempting to run automation for ${testName}...`);
    if (automation) {
      console.log(`Running automation for ${testName}...`);
      if (customSettings) {
        console.error('customSettings not supported for automation');
      } else {
        assertTruthy(renderer.root);
        const testRoot = renderer.createNode({
          parent: renderer.root,
          x: renderer.root.x,
          y: renderer.root.y,
          w: renderer.root.w,
          h: renderer.root.h,
          color: 0x00000000,
        });
        const exampleSettings: ExampleSettings = {
          testName,
          renderer,
          testRoot,
          appElement,
          automation: true,
          perfMultiplier: 1,
          snapshot: async (options) => {
            const snapshot = (window as any).snapshot as
              | ((testName: string, options?: SnapshotOptions) => Promise<void>)
              | undefined;

            const clipRect = options?.clip || {
              x: testRoot.x,
              y: testRoot.y,
              width: testRoot.w,
              height: testRoot.h,
            };

            const adjustedOptions = {
              ...options,
              clip: {
                x: Math.round(clipRect.x * logicalPixelRatio),
                y: Math.round(clipRect.y * logicalPixelRatio),
                width: Math.round(clipRect.width * logicalPixelRatio),
                height: Math.round(clipRect.height * logicalPixelRatio),
              },
            };

            // Allow some time for all images to load and the RaF to unpause
            // and render if needed.
            await new Promise((resolve) => setTimeout(resolve, 200));
            if (snapshot) {
              console.log(`Calling snapshot(${testName})`);
              await snapshot(testName, adjustedOptions);
            } else {
              console.error(
                'snapshot() not defined (not running in playwright?)',
              );
            }
          },
          memMonitor: null,
        };
        try {
          await automation(exampleSettings);
        } catch (err) {
          console.error(`Automation for ${testName} threw:`, err);
        }
        testRoot.parent = null;
        testRoot.destroy();
      }
    }
  }
  const doneTests = (window as any).doneTests as
    | (() => Promise<void>)
    | undefined;
  if (doneTests) {
    console.error('Calling doneTests()');
    await doneTests();
  } else {
    console.error('doneTests() not defined (not running in playwright?)');
  }
}

function waitForRendererIdle(renderer: RendererMain) {
  return new Promise<void>((resolve) => {
    let timeout: NodeJS.Timeout | undefined;
    const startTimeout = () => {
      timeout = setTimeout(() => {
        resolve();
      }, 200);
    };

    renderer.once('idle', () => {
      if (timeout) {
        clearTimeout(timeout);
      }
      startTimeout();
    });
  });
}
