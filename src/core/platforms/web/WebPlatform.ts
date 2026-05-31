import { Platform } from '../Platform.js';
import type { Stage } from '../../Stage.js';

/**
 * make fontface add not show errors
 */
interface FontFaceSetWithAdd extends FontFaceSet {
  add(font: FontFace): void;
}

export class WebPlatform extends Platform {
  ////////////////////////
  // Platform-specific methods
  ////////////////////////

  override createCanvas(): HTMLCanvasElement {
    const canvas = document.createElement('canvas');
    return canvas;
  }

  override getElementById(id: string): HTMLElement | null {
    return document.getElementById(id);
  }

  ////////////////////////
  // Update loop
  ////////////////////////

  override startLoop(stage: Stage): void {
    let isIdle = false;
    let lastFrameTime = 0;
    const buffer = 4;

    const runLoop = (currentTime: number = 0) => {
      // The GL context is lost and the engine does not rebuild it in place.
      // Stop the loop entirely (no reschedule) so we issue no GL calls against
      // a dead context. Recovery is via app reload (see the `contextLost` event).
      if (stage.isContextLost === true) {
        return;
      }

      const targetFrameTime = stage.targetFrameTime;

      // Frame Limiting logic
      if (targetFrameTime > 0) {
        // Calculate elapsed time since the last frame
        const elapsed = currentTime - lastFrameTime;

        // If not enough time has passed, skip this frame
        if (elapsed < targetFrameTime) {
          const wait = targetFrameTime - elapsed;

          if (wait > buffer) {
            setTimeout(requestLoop, wait - buffer);
          } else {
            requestAnimationFrame(runLoop);
          }
          return;
        }

        // Adjust lastFrameTime to maintain the target FPS
        lastFrameTime = currentTime - (elapsed % targetFrameTime);
      } else {
        lastFrameTime = currentTime;
      }

      stage.updateFrameTime();
      const hasActiveAnimations = stage.updateAnimations();

      if (!stage.hasSceneUpdates()) {
        // We still need to calculate the fps else it looks like the app is frozen
        stage.calculateFps();

        // We use 15ms instead of 16.6ms to provide a safety buffer.
        // This ensures we wake up slightly before the next frame to check for updates,
        // preventing us from missing a frame due to timer variances.
        setTimeout(requestLoop, Math.max(targetFrameTime, 15));

        if (isIdle === false) {
          stage.shManager.cleanup();
          stage.eventBus.emit('idle');
          isIdle = true;
        }

        if (stage.txMemManager.checkCleanup() === true) {
          stage.txMemManager.cleanup();
        }

        stage.flushFrameEvents();
        return;
      }

      isIdle = false;
      stage.drawFrame(hasActiveAnimations);
      stage.flushFrameEvents();

      // Schedule next frame
      requestAnimationFrame(runLoop);
    };

    const requestLoop = () => requestAnimationFrame(runLoop);

    requestAnimationFrame(runLoop);
  }

  ////////////////////////
  // ImageBitmap
  ////////////////////////

  override createImageBitmap(
    blob: ImageBitmapSource,
    sxOrOptions?: number | ImageBitmapOptions,
    sy?: number,
    sw?: number,
    sh?: number,
    options?: ImageBitmapOptions,
  ): Promise<ImageBitmap> {
    if (typeof sxOrOptions === 'number') {
      return createImageBitmap(
        blob,
        sxOrOptions,
        sy ?? 0,
        sw ?? 0,
        sh ?? 0,
        options,
      );
    } else {
      return createImageBitmap(blob, sxOrOptions);
    }
  }

  getTimeStamp(): number {
    return Date.now();
  }

  override addFont(font: FontFace): void {
    (document.fonts as FontFaceSetWithAdd).add(font);
  }
}
