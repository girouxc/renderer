/**
 * Visual Regression Test Runner
 *
 * @remarks
 * This script is used to run visual regression tests on the specific examples
 * in `examples/tests` that export an `automation()` function.
 *
 * See `README.md` and `pnpm start --help` (from this directory) for more info.
 *
 * @module
 */
import { chromium } from 'playwright';
import path from 'path';
import fs from 'fs-extra';
import chalk from 'chalk';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { execa, $ } from 'execa';
import { fileURLToPath } from 'url';
import {
  compareSnapshot,
  saveSnapshot,
  type SnapshotOptions,
} from './snapshot.js';

export const certifiedSnapshotDir = 'certified-snapshots';
export const failedResultsDir = 'failed-results';

import { detectContainerRuntime } from './detectDockerRuntime.js';

const browsers = { chromium };
let snapshotsTested = 0;
let snapshotsPassed = 0;
let snapshotsFailed = 0;
let snapshotsSkipped = 0;
const pageErrors: string[] = [];

/**
 * The runtime environment (local, ci, etc.)
 */
const runtimeEnv = (process.env.RUNTIME_ENV || 'local') as 'ci' | 'local';

// Guard against invalid runtime environment
if (!['ci', 'local'].includes(runtimeEnv)) {
  console.error(
    chalk.red.bold(
      `Invalid RUNTIME_ENV '${runtimeEnv}'. Must be 'ci' or 'local'`,
    ),
  );
  process.exit(1);
}

const argv = yargs(hideBin(process.argv))
  .options({
    capture: {
      type: 'boolean',
      alias: 'c',
      default: false,
      description: 'Capture new snapshots',
    },
    overwrite: {
      type: 'boolean',
      alias: 'o',
      default: false,
      description: 'Overwrite existing snapshots (--capture must also be set)',
    },
    verbose: {
      type: 'boolean',
      alias: 'v',
      default: false,
      description: 'Verbose output',
    },
    skipBuild: {
      type: 'boolean',
      alias: 's',
      default: false,
      description: 'Skip building renderer and examples',
    },
    port: {
      type: 'number',
      alias: 'p',
      default: 50535,
      description: 'Port to serve examples on',
    },
    ci: {
      type: 'boolean',
      alias: 'i',
      default: false,
      description: 'Run in docker container with `ci` runtime environment',
    },
    filter: {
      type: 'string',
      alias: 'f',
      default: '*',
      description: 'Tests to run ("*" wildcard pattern)',
    },
    workers: {
      type: 'number',
      alias: 'w',
      default: 1,
      description:
        'Number of parallel browser pages used to run tests (sharded round-robin)',
    },
    renderMode: {
      type: 'string',
      alias: 'r',
      // Defaults to webgl-only. Switch to 'all' (here or via --renderMode)
      // once canvas baselines have been captured and committed, otherwise
      // canvas compare runs fail for lack of reference snapshots.
      default: 'webgl',
      choices: ['webgl', 'canvas', 'all'],
      description:
        'Renderer mode to test ("webgl", "canvas", or "all" for both)',
    },
  })
  .parseSync();

/**
 * Main function that runs the tests in either docker ci mode or compare/capture mode
 */
(async () => {
  let exitCode = 1;
  try {
    if (argv.ci) {
      exitCode = await dockerCiMode();
    } else {
      exitCode = await compareCaptureMode();
    }
  } finally {
    process.exitCode = exitCode;
  }
})().catch((err) => console.error(err));

/**
 * Re-launches this script in a docker container with the `ci` runtime environment
 *
 * @returns Exit code
 */
async function dockerCiMode(): Promise<number> {
  // Detect container runtime
  const runtime = await detectContainerRuntime();

  // Relay the command line arguments to the docker container
  const commandLineStr = [
    argv.capture ? '--capture' : '',
    argv.overwrite ? '--overwrite' : '',
    argv.verbose ? '--verbose' : '',
    argv.skipBuild ? '--skipBuild' : '',
    argv.port ? `--port ${argv.port}` : '',
    argv.filter ? `--filter "${argv.filter}"` : '',
    argv.workers > 1 ? `--workers ${argv.workers}` : '',
    argv.renderMode ? `--renderMode ${argv.renderMode}` : '',
  ].join(' ');

  // Get the directory of the current file
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const rootDir = path.resolve(__dirname, '..', '..', '..');

  const childProc = $({ stdio: 'inherit' })`${runtime} run --network host \
    -v ${rootDir}:/work/ \
    -v /work/node_modules \
    -v /work/.pnpm-store \
    -v /work/examples/node_modules \
    -v /work/visual-regression/node_modules \
    -w /work/ -it visual-regression:latest \
    /bin/bash -c ${`pnpm install && RUNTIME_ENV=ci pnpm test:visual ${commandLineStr}`}
  `;
  await childProc;
  return childProc.exitCode ?? 1;
}

/**
 * The main function that builds the renderer and examples, serves the examples,
 * and runs the tests in capture or compare mode.
 *
 * @returns Exit code
 */
async function compareCaptureMode(): Promise<number> {
  const stdioOption = argv.verbose ? 'inherit' : 'ignore';

  if (!argv.skipBuild) {
    // 1. Build Renderer
    console.log(chalk.magentaBright.bold(`Building Renderer...`));
    const rendererBuildRes = await execa('pnpm', ['build:renderer'], {
      stdio: stdioOption,
    });
    if (rendererBuildRes.exitCode !== 0) {
      console.error(chalk.red.bold('Build failed!'));
      return 1;
    }
    console.log(chalk.magentaBright.bold(`Building Examples...`));
    const exampleBuildRes = await execa('pnpm', ['build:examples'], {
      stdio: stdioOption,
    });
    if (exampleBuildRes.exitCode !== 0) {
      console.error(chalk.red.bold('Build failed!'));
      return 1;
    }
  }
  console.log(
    chalk.magentaBright.bold(`Serving Examples (port: ${argv.port})...`),
  );

  // Serve the examples
  const serveExamplesChildProc = $({
    stdio: 'ignore',
    // Must run detached and kill after tests complete otherwise ghost process tree will hang
    detached: true,
    cleanup: false,
  })`pnpm serve-examples --port ${argv.port}`;

  let exitCode = 1;
  try {
    const waitPortRes = await $({
      stdio: stdioOption,
      timeout: 10000,
    })`wait-port ${argv.port}`;

    if (waitPortRes.exitCode !== 0) {
      console.error(chalk.red.bold('Failed to start server!'));
      return 1;
    }

    // Run the tests
    const renderModes: ('webgl' | 'canvas')[] =
      argv.renderMode === 'all'
        ? ['webgl', 'canvas']
        : [argv.renderMode as 'webgl' | 'canvas'];
    exitCode = 0;
    for (const mode of renderModes) {
      const result = await runTest('chromium', mode);
      if (result !== 0) {
        exitCode = result;
      }
    }
  } finally {
    // Kill the serve-examples process
    serveExamplesChildProc.kill();
  }
  return exitCode;
}

/**
 * Run the tests in capture or compare mode depending on the `argv.capture` flag
 * for a specific browser type.
 */
async function runTest(
  browserType: 'chromium',
  renderMode: 'webgl' | 'canvas',
) {
  const paramString = Object.entries({
    browser: browserType,
    renderMode,
    overwrite: argv.overwrite,
    filter: argv.filter,
    RUNTIME_ENV: runtimeEnv,
  }).reduce((acc, [key, value]) => {
    return `${acc ? `${acc}, ` : ''}${`${key}: ${chalk.white(value)}`}`;
  }, '');
  console.log(
    chalk.magentaBright.bold(
      `${
        argv.capture ? 'Capturing' : 'Running'
      } Visual Regression Tests (${paramString})...`,
    ),
  );

  const snapshotSubDirName = `${browserType}-${runtimeEnv}${
    renderMode === 'canvas' ? '-canvas' : ''
  }`;

  const snapshotSubDir = path.join(certifiedSnapshotDir, snapshotSubDirName);

  if (!argv.capture) {
    // If compare/run mode...
    // Make sure the snapshot directory exists. If not, error out.
    if (!fs.existsSync(snapshotSubDir)) {
      console.error(
        chalk.red.bold(
          `Snapshot directory '${snapshotSubDir}' does not exist! Did you forget to run in --capture mode first?`,
        ),
      );
      return 1;
    }

    // Ensure the failedResult directory exists
    await fs.ensureDir(failedResultsDir);
    // Remove all files in the failedResultPath directory
    await fs.emptyDir(failedResultsDir);
  }

  // Launch the browser once; each worker runs in its own Page sharing the
  // same browser process. Pages run in parallel, each handling a round-robin
  // shard of the test list (see runAutomation in examples/index.ts).
  const browser = await browsers[browserType].launch({
    args: [
      '--disable-font-subpixel-positioning',
      '--disable-lcd-text',
      '--font-render-hinting=none',
      '--force-device-scale-factor=1',
    ],
  });

  const workerCount = Math.max(1, argv.workers);

  // Each test's first snapshot is index 1, second is index 2, etc. With
  // sharding, a given test only runs in one worker, so per-worker counters
  // are sufficient. Snapshot filenames are still globally unique.
  const makeSnapshotHandler = (page: import('playwright').Page) => {
    const testCounters: Record<string, number> = {};
    return async (test: string, options: SnapshotOptions) => {
      snapshotsTested++;

      // Ensure clip dimensions are integers (matches Playwright's clip shape
      // exactly — caller is expected to send {x, y, width, height}).
      if (options.clip) {
        options.clip.x = Math.round(options.clip.x);
        options.clip.y = Math.round(options.clip.y);
        options.clip.width = Math.round(options.clip.width);
        options.clip.height = Math.round(options.clip.height);
      }

      const subtestName = options.name ? `${test}_${options.name}` : test;
      const snapshotIndex = (testCounters[subtestName] =
        (testCounters[subtestName] || 0) + 1);
      const makeFilename = (postfix?: string) =>
        `${subtestName}-${snapshotIndex}${postfix ? `-${postfix}` : ''}.png`;
      const snapshotPath = path.join(snapshotSubDir, makeFilename());

      // Wrap the capture/compare so an unexpected throw (e.g. Playwright
      // rejecting a malformed clip) is counted as a failure instead of
      // silently leaving the counters at zero. Pre-fix, exceptions here
      // bypassed both snapshotsPassed and snapshotsFailed, so a runner full
      // of thrown comparisons exited with `snapshotsFailed === 0` and CI
      // reported success even though nothing actually ran.
      try {
        if (argv.capture) {
          const captureResponse = await saveSnapshot(
            page,
            snapshotPath,
            options,
            subtestName,
            snapshotIndex,
            argv.overwrite,
          );
          if (captureResponse === false) {
            snapshotsSkipped++;
            return;
          }

          if (argv.overwrite) {
            snapshotsPassed++;
            return;
          }
        }

        const resp = await compareSnapshot(
          page,
          snapshotPath,
          options,
          subtestName,
          snapshotIndex,
        );
        if (resp) {
          snapshotsPassed++;
        } else {
          snapshotsFailed++;
        }
      } catch (err) {
        snapshotsFailed++;
        console.log(
          chalk.red.bold(
            `FAILED! (${subtestName}-${snapshotIndex} threw: ${
              err instanceof Error ? err.message : String(err)
            })`,
          ),
        );
      }
    };
  };

  const runWorker = async (shardIndex: number) => {
    const page = await browser.newPage();

    if (argv.verbose) {
      page.on('console', (msg) =>
        console.log(`console[${shardIndex}]: ${msg.text()}`),
      );
    }

    // Fail the run on uncaught page errors. Pixels can still match while an
    // example throws every frame (e.g. a frozen textureOptions mutation), so
    // a green snapshot alone is not enough. Dedupe because rAF-driven errors
    // repeat identically each frame.
    page.on('pageerror', (err) => {
      const message = `worker[${shardIndex}] (${renderMode}): ${err.message}`;
      if (pageErrors.indexOf(message) === -1) {
        pageErrors.push(message);
        console.log(chalk.red.bold(`PAGE ERROR! ${message}`));
      }
    });

    await page.exposeFunction('snapshot', makeSnapshotHandler(page));

    const donePromise = new Promise<void>((resolve) => {
      void page.exposeFunction('doneTests', () => {
        resolve();
      });
    });

    const shardParam =
      workerCount > 1 ? `&shard=${shardIndex}/${workerCount}` : '';
    await page.goto(
      `http://localhost:${argv.port}/?automation=true&test=${argv.filter}&renderMode=${renderMode}${shardParam}`,
    );

    await donePromise;
    await page.close();
  };

  await Promise.all(
    Array.from({ length: workerCount }, (_, i) => runWorker(i)),
  );
  await browser.close();

  // Summarize results
  const passPerc: string = ((snapshotsPassed / snapshotsTested) * 100).toFixed(
    1,
  );
  const failPerc: string = ((snapshotsFailed / snapshotsTested) * 100).toFixed(
    1,
  );
  const skipPerc: string = ((snapshotsSkipped / snapshotsTested) * 100).toFixed(
    1,
  );

  if (argv.capture) {
    console.log(
      chalk.white.underline(`\nVisual Regression Test Capture Completed:`),
    );

    if (snapshotsPassed > 0) {
      console.log(
        chalk.green(`   ${snapshotsPassed} snapshots captured (${passPerc}%)`),
      );
    }

    if (snapshotsSkipped > 0) {
      console.log(
        chalk.yellow(`   ${snapshotsSkipped} snapshots skipped (${skipPerc}%)`),
      );
    }

    console.log(chalk.gray(`   ${snapshotsTested} snapshots detected`));
  } else {
    console.log(chalk.white.underline(`\nVisual Regression Tests Completed:`));

    if (snapshotsFailed > 0) {
      console.log(
        chalk.red(`   ${snapshotsFailed} snapshots failed (${failPerc}%)`),
      );
      console.log(
        chalk.gray(
          `      (See \`${failedResultsDir}\` directory for failed results)`,
        ),
      );
    }

    if (snapshotsPassed > 0) {
      console.log(
        chalk.green(`   ${snapshotsPassed} snapshots passed (${passPerc}%)`),
      );
    }

    console.log(chalk.gray(`   ${snapshotsTested} snapshots tested`));
  }

  if (pageErrors.length > 0) {
    console.log(
      chalk.red(`   ${pageErrors.length} uncaught page error(s) detected:`),
    );
    for (let i = 0; i < pageErrors.length; i++) {
      console.log(chalk.red(`      ${pageErrors[i]}`));
    }
  }

  console.log(chalk.reset(''));

  return snapshotsFailed > 0 || pageErrors.length > 0 ? 1 : 0;
}
