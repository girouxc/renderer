import type { INode, RendererMain } from '@lightningjs/renderer';
import type { MemMonitor } from './MemMonitor.js';

/**
 * Keep in sync with `visual-regression/src/index.ts`
 */
export interface SnapshotOptions {
  /**
   * Snapshot name
   *
   * @remarks
   * This name, if provided, is appended to the end of the test name and used in
   * the snapshot file name.
   */
  name?: string;
  /**
   * Clip the snapshot to a specific area of the canvas.
   */
  clip?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
}

export interface ExampleSettings {
  /**
   * Name of the test being run.
   */
  testName: string;
  /**
   * Renderer instance
   */
  renderer: RendererMain;
  /**
   * The HTML Element that the Renderer's canvas is a child of
   */
  appElement: HTMLDivElement;
  /**
   * Renderer Node that all tests should use as their root node.
   *
   * @remarks
   * Tests should NEVER use the `renderer.root` node as this will prevent the
   * automation mode from being able to clean up after each test.
   */
  testRoot: INode;
  /**
   * Whether the test is being run in automation mode.
   */
  automation: boolean;
  /**
   * For performance tests that want to support it, use this number as a multiplier
   * for the number of objects created by a test.
   *
   * @remarks
   * This value is `1` by default.
   */
  perfMultiplier: number;
  /**
   * If the test is run in automation mode, this method will take a visual
   * snapshot of the current state of the renderer's canvas for the Visual
   * Regression Test Runner.
   *
   * This method will be a no-op if the test is not run in automation mode.
   */
  snapshot(options?: SnapshotOptions): Promise<void>;
  /**
   * The MemMonitor instance for the test (if enabled)
   */
  memMonitor: MemMonitor | null;
}
