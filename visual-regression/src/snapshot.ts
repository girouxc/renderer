import { type Page } from 'playwright';
import fs from 'fs-extra';
import chalk from 'chalk';
import path from 'path';

import { failedResultsDir } from './index.js';

import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';

/**
 * Keep in sync with `examples/common/ExampleSettings.ts`.
 * `width`/`height` (not `w`/`h`) so the object can be handed directly to
 * Playwright's `page.screenshot({ clip })`, which expects this exact shape.
 */
export interface SnapshotOptions {
  name?: string;
  clip?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
}

interface CompareResult {
  doesMatch: boolean;
  diffImageBuffer?: PNG;
  reason?: string;
}

/**
 * Handles the snapshot capture process.
 *
 * @param page The Playwright page object
 * @param snapshotPath The path to save the snapshot
 * @param options The snapshot options
 * @param subtestName The name of the subtest
 * @param snapshotIndex The index of the snapshot
 * @param overwrite Whether to overwrite the snapshot if it already exists
 * @returns A promise that resolves to a boolean indicating whether the snapshot was saved or skipped
 */
export async function saveSnapshot(
  page: Page,
  snapshotPath: string,
  options: SnapshotOptions,
  subtestName: string,
  snapshotIndex: number,
  overwrite: boolean,
): Promise<boolean> {
  process.stdout.write(
    chalk.gray(
      `Saving snapshot for ${chalk.white(
        `${subtestName}-${snapshotIndex}`,
      )}... `,
    ),
  );

  if (fs.existsSync(snapshotPath) && !overwrite) {
    process.stdout.write(chalk.yellow.bold('SKIPPED! (already exists)\n'));
    return false;
  }

  await page.screenshot({ path: snapshotPath, clip: options.clip });
  process.stdout.write(chalk.green.bold('DONE!\n'));
  return true;
}

/**
 * Handles the snapshot comparison process.
 */
export async function compareSnapshot(
  page: Page,
  snapshotPath: string,
  options: SnapshotOptions,
  subtestName: string,
  snapshotIndex: number,
): Promise<boolean> {
  process.stdout.write(
    chalk.gray(`Running ${chalk.white(`${subtestName}-${snapshotIndex}`)}... `),
  );

  const actualPng = await page.screenshot({ clip: options.clip });

  if (!fs.existsSync(snapshotPath)) {
    console.log(chalk.red.bold('FAILED! (snapshot does not exist!)'));
    await saveFailedSnapshot(
      subtestName,
      snapshotIndex,
      actualPng,
      null,
      undefined,
    );
    return false;
  }

  const expectedPng = await fs.promises.readFile(snapshotPath);
  const result = compareBuffers(actualPng, expectedPng);

  if (result.doesMatch) {
    console.log(chalk.green.bold('PASS!'));
    return true;
  }

  console.log(
    chalk.red.bold(`FAILED!${result.reason ? ` (${result.reason})` : ''}`),
  );

  await saveFailedSnapshot(
    subtestName,
    snapshotIndex,
    actualPng,
    expectedPng,
    result.diffImageBuffer,
  );
  return false;
}

/**
 * Saves failed snapshot results for debugging.
 */
export async function saveFailedSnapshot(
  subtestName: string,
  snapshotIndex: number,
  actualPng: Buffer,
  expectedPng: Buffer | null,
  diffPng: PNG | undefined,
) {
  const writeTasks = [
    fs.promises.writeFile(
      path.join(failedResultsDir, `${subtestName}-${snapshotIndex}-actual.png`),
      actualPng,
    ),
  ];

  if (expectedPng) {
    writeTasks.push(
      fs.promises.writeFile(
        path.join(
          failedResultsDir,
          `${subtestName}-${snapshotIndex}-expected.png`,
        ),
        expectedPng,
      ),
    );
  }

  if (diffPng) {
    writeTasks.push(
      fs.promises.writeFile(
        path.join(failedResultsDir, `${subtestName}-${snapshotIndex}-diff.png`),

        PNG.sync.write(diffPng),
      ),
    );
  }

  await Promise.all(writeTasks);
}

/**
 * Compare two image buffers and return if they match and a diff image buffer
 *
 * @param actualImageBuffer Buffer of the actual image
 * @param expectedImageBuffer Buffer of the expected image
 * @returns CompareResult
 */
export function compareBuffers(
  actualImageBuffer: Buffer,
  expectedImageBuffer: Buffer,
): CompareResult {
  const actualImage = PNG.sync.read(actualImageBuffer);
  const expectedImage = PNG.sync.read(expectedImageBuffer);

  if (
    actualImage.width !== expectedImage.width ||
    actualImage.height !== expectedImage.height
  ) {
    return {
      doesMatch: false,
      diffImageBuffer: undefined,
      reason: `Image dimensions do not match (actual ${actualImage.width}x${actualImage.height}, expected ${expectedImage.width}x${expectedImage.height})`,
    };
  }

  const width = actualImage.width;
  const height = actualImage.height;
  const diff = new PNG({ width, height });

  // pixelmatch threshold is normalized YIQ color distance (0..1). 0.1 is the
  // library default and the recommended value for catching meaningful UI
  // changes while tolerating sub-pixel AA jitter. The previous 0.8 was so
  // permissive that missing text on a solid background still passed.
  const count = pixelmatch(
    actualImage.data,
    expectedImage.data,
    diff.data,
    width,
    height,
    { threshold: 0.1 },
  );

  const doesMatch = count === 0;

  return {
    doesMatch,
    diffImageBuffer: doesMatch ? undefined : diff,
    reason: doesMatch ? undefined : `${count} pixels differ`,
  };
}
