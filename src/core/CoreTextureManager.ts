import { ImageWorkerManager } from './lib/ImageWorker.js';
import type { CoreRenderer } from './renderers/CoreRenderer.js';
import { ColorTexture } from './textures/ColorTexture.js';
import { ImageTexture } from './textures/ImageTexture.js';
import { NoiseTexture } from './textures/NoiseTexture.js';
import { SubTexture } from './textures/SubTexture.js';
import { RenderTexture } from './textures/RenderTexture.js';
import { Texture, TextureType } from './textures/Texture.js';
import { EventEmitter } from '../common/EventEmitter.js';
import type { Stage } from './Stage.js';
import {
  validateCreateImageBitmap,
  type CreateImageBitmapSupport,
} from './lib/validateImageBitmap.js';
import type { Platform } from './platforms/Platform.js';
import { TextureError, TextureErrorCode } from './TextureError.js';

/**
 * Augmentable map of texture class types
 *
 * @remarks
 * This interface can be augmented by other modules/apps to add additional
 * texture types. The ones included directly here are the ones that are
 * included in the core library.
 */
export interface TextureMap {
  ColorTexture: typeof ColorTexture;
  ImageTexture: typeof ImageTexture;
  NoiseTexture: typeof NoiseTexture;
  SubTexture: typeof SubTexture;
  RenderTexture: typeof RenderTexture;
}

export type ExtractProps<Type> = Type extends { z$__type__Props: infer Props }
  ? Props
  : never;

/**
 * Contains information about the texture manager's internal state
 * for debugging purposes.
 */
export interface TextureManagerDebugInfo {
  keyCacheSize: number;
}

export interface TextureManagerSettings {
  numImageWorkers: number;
  createImageBitmapSupport: 'auto' | 'basic' | 'options' | 'full';
  maxRetryCount: number;
}

export type ResizeModeOptions =
  | {
      /**
       * Specifies that the image should be resized to cover the specified dimensions.
       */
      type: 'cover';
      /**
       * The horizontal clipping position
       * To clip the left, set clipX to 0. To clip the right, set clipX to 1.
       * clipX 0.5 will clip a equal amount from left and right
       *
       * @defaultValue 0.5
       */
      clipX?: number;
      /**
       * The vertical clipping position
       * To clip the top, set clipY to 0. To clip the bottom, set clipY to 1.
       * clipY 0.5 will clip a equal amount from top and bottom
       *
       * @defaultValue 0.5
       */
      clipY?: number;
    }
  | {
      /**
       * Specifies that the image should be resized to fit within the specified dimensions.
       */
      type: 'contain';
    };

/**
 * Universal options for all texture types
 *
 * @remarks
 * Texture Options provide a way to specify options that are relevant to the
 * texture loading process (including caching) and specifically for how a
 * texture is rendered within a specific Node (or set of Nodes).
 *
 * They are not used in determining the cache key for a texture (except if
 * the `cacheKey` option is provided explicitly to oveerride the default
 * cache key for the texture instance) nor are they stored/referenced within
 * the texture instance itself. Instead, the options are stored/referenced
 * within individual Nodes. So a single texture instance can be used in
 * multiple Nodes each using a different set of options.
 */
export interface TextureOptions {
  /**
   * Preload the texture immediately even if it's not being rendered to the
   * screen.
   *
   * @remarks
   * This allows the texture to be used immediately without any delay when it
   * is first needed for rendering. Otherwise the loading process will start
   * when the texture is first rendered, which may cause a delay in that texture
   * being shown properly.
   *
   * @defaultValue `false`
   */
  preload?: boolean;

  /**
   * Prevent clean up of the texture when it is no longer being used.
   *
   * @remarks
   * This is useful when you want to keep the texture in memory for later use.
   * Regardless of whether the texture is being used or not, it will not be
   * cleaned up.
   *
   * @defaultValue `false`
   */
  preventCleanup?: boolean;

  /**
   * Number of times to retry loading a failed texture
   *
   * @remarks
   * When a texture fails to load, Lightning will retry up to this many times
   * before permanently giving up. Each retry will clear the texture ownership
   * and then re-establish it to trigger a new load attempt.
   *
   * Set to null to disable retries. Set to 0 to always try once and never retry.
   * This is typically only used on ImageTexture instances.
   *
   */
  maxRetryCount?: number | null;

  /**
   * Flip the texture horizontally when rendering
   *
   * @defaultValue `false`
   */
  flipX?: boolean;

  /**
   * Flip the texture vertically when rendering
   *
   * @defaultValue `false`
   */
  flipY?: boolean;

  /**
   * You can use resizeMode to determine the clipping automatically from the width
   * and height of the source texture. This can be convenient if you are unsure about
   * the exact image sizes but want the image to cover a specific area.
   *
   * The resize modes cover and contain are supported
   */
  resizeMode?: ResizeModeOptions;
}

export class CoreTextureManager extends EventEmitter {
  /**
   * Map of textures by cache key
   */
  keyCache: Map<string, Texture> = new Map();

  /**
   * Map of cache keys by texture
   */
  inverseKeyCache: WeakMap<Texture, string> = new WeakMap();

  /**
   * Map of texture constructors by their type name
   */
  txConstructors: Partial<TextureMap> = {};

  public maxRetryCount: number;
  private uploadTextureQueue: Set<Texture> = new Set();
  private initialized = false;
  private stage: Stage;
  private numImageWorkers: number;

  public platform: Platform;

  imageWorkerManager: ImageWorkerManager | null = null;
  hasCreateImageBitmap = false;
  imageBitmapSupported = {
    basic: false,
    options: false,
    full: false,
  };

  hasWorker = !!self.Worker;
  /**
   * Renderer that this texture manager is associated with
   *
   * @remarks
   * This MUST be set before the texture manager is used. Otherwise errors
   * will occur when using the texture manager.
   */
  renderer!: CoreRenderer;

  /**
   * The current frame time in milliseconds
   *
   * @remarks
   * This is used to populate the `lastRenderableChangeTime` property of
   * {@link Texture} instances when their renderable state changes.
   *
   * Set by stage via `updateFrameTime` method.
   */
  frameTime = 0;

  constructor(stage: Stage, settings: TextureManagerSettings) {
    super();

    const { numImageWorkers, createImageBitmapSupport, maxRetryCount } =
      settings;

    this.stage = stage;
    this.platform = stage.platform;
    this.numImageWorkers = numImageWorkers;
    this.maxRetryCount = maxRetryCount;

    if (createImageBitmapSupport === 'auto') {
      validateCreateImageBitmap(this.platform)
        .then((result) => {
          this.initialize(result);
        })
        .catch(() => {
          console.warn(
            '[Lightning] createImageBitmap is not supported on this browser. ImageTexture will be slower.',
          );

          // initialized without image worker manager and createImageBitmap
          this.initialized = true;
          this.emit('initialized');
        });
    } else {
      this.initialize({
        basic: createImageBitmapSupport === 'basic',
        options: createImageBitmapSupport === 'options',
        full: createImageBitmapSupport === 'full',
      });
    }

    this.registerTextureType('ImageTexture', ImageTexture);
    this.registerTextureType('ColorTexture', ColorTexture);
    this.registerTextureType('NoiseTexture', NoiseTexture);
    this.registerTextureType('SubTexture', SubTexture);
    this.registerTextureType('RenderTexture', RenderTexture);
  }

  registerTextureType<Type extends keyof TextureMap>(
    textureType: Type,
    textureClass: TextureMap[Type],
  ): void {
    this.txConstructors[textureType] = textureClass;
  }

  private initialize(support: CreateImageBitmapSupport) {
    this.hasCreateImageBitmap =
      support.basic || support.options || support.full;
    this.imageBitmapSupported = support;

    if (this.hasCreateImageBitmap === false) {
      console.warn(
        '[Lightning] createImageBitmap is not supported on this browser. ImageTexture will be slower.',
      );
    }

    if (
      this.hasCreateImageBitmap === true &&
      this.hasWorker === true &&
      this.numImageWorkers > 0
    ) {
      this.imageWorkerManager = new ImageWorkerManager(
        this.numImageWorkers,
        support,
      );
    } else {
      console.warn(
        '[Lightning] Image worker count is 0 or workers are not supported on this browser. Image loading will be slower.',
      );
    }

    this.initialized = true;
    this.emit('initialized');

    // Anything that arrived before initialization completed is now safe to
    // process. Without this, queued textures would sit until the next frame
    // tick happens to call processSome().
    if (this.uploadTextureQueue.size > 0) {
      this.processSome(Infinity).catch((err) => {
        console.error('Failed to drain pre-init texture queue:', err);
      });
    }
  }

  /**
   * Enqueue a texture for uploading to the GPU.
   *
   * @param texture - The texture to upload
   */
  enqueueUploadTexture(texture: Texture): void {
    if (texture.state === 'failed' || texture.state === 'freed') {
      return;
    }
    this.uploadTextureQueue.add(texture);
  }

  /**
   * Create a texture
   *
   * @param textureType - The type of texture to create
   * @param props - The properties to use for the texture
   */
  createTexture<Type extends keyof TextureMap>(
    textureType: Type,
    props: ExtractProps<TextureMap[Type]>,
  ): InstanceType<TextureMap[Type]> {
    const TextureClass = this.txConstructors[textureType];
    if (!TextureClass) {
      throw new TextureError(
        TextureErrorCode.TEXTURE_TYPE_NOT_REGISTERED,
        `Texture type "${textureType}" is not registered`,
      );
    }

    // Cache key is computed from raw props (each Texture's makeCacheKey
    // inlines its own defaults) so we can skip the resolveDefaults
    // allocation on a cache hit.
    const cacheKey = TextureClass.makeCacheKey(props as any);
    if (cacheKey) {
      const cached = this.keyCache.get(cacheKey);
      if (cached) {
        return cached as InstanceType<TextureMap[Type]>;
      }
    }

    const resolvedProps = TextureClass.resolveDefaults(props as any);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-explicit-any
    const texture = new TextureClass(this, resolvedProps as any);

    if (cacheKey) {
      this.initTextureToCache(texture, cacheKey);
    }

    return texture as InstanceType<TextureMap[Type]>;
  }

  /**
   * Override loadTexture to use the batched approach.
   *
   * @param texture - The texture to load
   * @param immediate - Whether to prioritize the texture for immediate loading
   */
  async loadTexture(texture: Texture, priority?: boolean): Promise<void> {
    if (texture.type === TextureType.subTexture) {
      // ignore subtextures - they get loaded through their parent
      return;
    }

    if (texture.state === 'loaded') {
      // if the texture is already loaded, just return
      return;
    }

    // if we're not initialized, just queue the texture into the upload queue
    if (this.initialized === false) {
      this.uploadTextureQueue.add(texture);
      return;
    }

    texture.setState('loading');

    // Get texture data - early return on failure
    const textureDataResult = await texture.getTextureData().catch((err) => {
      console.error(err);
      texture.setState(
        'failed',
        new TextureError(TextureErrorCode.TEXTURE_DATA_NULL),
      );
      return null;
    });

    // Early return if texture data fetch failed
    if (textureDataResult === null || texture.state === 'failed') {
      return;
    }

    // Handle non-image textures: upload immediately
    const shouldUploadImmediately =
      texture.type !== TextureType.image || priority === true;
    if (shouldUploadImmediately === true) {
      await this.uploadTexture(texture).catch((err) => {
        console.error(`Failed to upload texture:`, err);
        texture.setState(
          'failed',
          new TextureError(
            TextureErrorCode.TEXTURE_UPLOAD_FAILED,
            err instanceof Error ? err.message : undefined,
          ),
        );
      });
      return;
    }

    // Queue image textures for throttled upload
    this.enqueueUploadTexture(texture);
  }

  /**
   * Upload a texture to the GPU
   *
   * @param texture Texture to upload
   * @returns Promise that resolves when the texture is fully loaded
   */
  async uploadTexture(texture: Texture): Promise<void> {
    if (
      this.stage.txMemManager.doNotExceedCriticalThreshold === true &&
      this.stage.txMemManager.criticalCleanupRequested === true
    ) {
      // we're at a critical memory threshold, don't upload textures
      texture.setState(
        'failed',
        new TextureError(TextureErrorCode.MEMORY_THRESHOLD_EXCEEDED),
      );
      return;
    }

    if (texture.state === 'failed' || texture.state === 'freed') {
      // don't upload failed or freed textures
      return;
    }

    if (texture.state === 'loaded') {
      // already loaded
      return;
    }

    if (texture.textureData === null) {
      texture.setState(
        'failed',
        new TextureError(
          TextureErrorCode.TEXTURE_DATA_NULL,
          'Texture data is null, cannot upload texture',
        ),
      );
      return;
    }

    const coreContext = texture.loadCtxTexture();
    if (coreContext.state === 'loaded') {
      texture.setState('loaded');
      return;
    }

    await coreContext.load();
  }

  /**
   * Check if a texture is being processed
   */
  isProcessingTexture(texture: Texture): boolean {
    return this.uploadTextureQueue.has(texture);
  }

  /**
   * Process a limited number of uploads.
   *
   * @param maxProcessingTime - The maximum processing time in milliseconds
   */
  async processSome(maxProcessingTime: number): Promise<void> {
    if (this.initialized === false) {
      return;
    }

    const platform = this.platform;
    const startTime = platform.getTimeStamp();

    // Decode / fetch ("getTextureData") is IO-bound and parallelisable across
    // image workers, while GPU upload is effectively serial. Keep a small
    // sliding window of in-flight data fetches so the next decode runs while
    // we're uploading the current one.
    const prefetchLimit = Math.max(1, this.numImageWorkers);
    const pending: Array<{ texture: Texture; data: Promise<unknown> }> = [];

    // Helper avoids TS narrowing `texture.state` permanently after the first
    // discriminated check — the property is mutable and can transition across
    // awaits, so we need to re-read it freshly each time.
    const isDead = (texture: Texture): boolean =>
      texture.state === 'failed' || texture.state === 'freed';

    const fillPrefetch = () => {
      while (
        pending.length < prefetchLimit &&
        this.uploadTextureQueue.size > 0
      ) {
        const [texture] = this.uploadTextureQueue;
        if (!texture) break;
        this.uploadTextureQueue.delete(texture);

        if (isDead(texture)) {
          continue;
        }

        // Swallow the rejection here so an early failure doesn't surface as
        // an unhandled promise rejection while it sits in the prefetch
        // window; we re-check state after awaiting.
        const data =
          texture.textureData === null
            ? texture.getTextureData().catch((err) => {
                console.error('Failed to fetch texture data:', err);
                return null;
              })
            : Promise.resolve(texture.textureData);

        pending.push({ texture, data });
      }
    };

    fillPrefetch();

    while (
      pending.length > 0 &&
      platform.getTimeStamp() - startTime < maxProcessingTime
    ) {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      const next = pending.shift()!;
      // Top up the prefetch window before awaiting — the next decode starts
      // now and overlaps with this upload.
      fillPrefetch();

      if (isDead(next.texture)) {
        continue;
      }

      try {
        await next.data;
        if (isDead(next.texture)) {
          continue;
        }
        await this.uploadTexture(next.texture);
      } catch (error) {
        console.error('Failed to upload texture:', error);
        // Continue with next texture instead of stopping entire queue
      }
    }

    // Time ran out before we got to these. Put them back so we don't lose
    // them — their getTextureData() is already in flight and will populate
    // `textureData` for the next tick.
    for (const { texture } of pending) {
      if (!isDead(texture)) {
        this.uploadTextureQueue.add(texture);
      }
    }
  }

  public hasUpdates(): boolean {
    return this.uploadTextureQueue.size > 0;
  }

  /**
   * Initialize a texture to the cache
   *
   * @param texture Texture to cache
   * @param cacheKey Cache key for the texture
   */
  initTextureToCache(texture: Texture, cacheKey: string) {
    const { keyCache, inverseKeyCache } = this;
    keyCache.set(cacheKey, texture);
    inverseKeyCache.set(texture, cacheKey);
  }

  /**
   * Get a texture from the cache
   *
   * @param cacheKey
   */
  getTextureFromCache(cacheKey: string): Texture | undefined {
    return this.keyCache.get(cacheKey);
  }

  /**
   * Remove a texture from the cache
   *
   * @remarks
   * Called by Texture Cleanup when a texture is freed.
   *
   * @param texture
   */
  removeTextureFromCache(texture: Texture) {
    const { inverseKeyCache, keyCache } = this;
    const cacheKey = inverseKeyCache.get(texture);
    if (cacheKey) {
      keyCache.delete(cacheKey);
    }
  }

  /**
   * Remove texture from the upload queue
   *
   * @param texture - The texture to remove
   */
  removeTextureFromQueue(texture: Texture): void {
    this.uploadTextureQueue.delete(texture);
  }

  /**
   * Resolve a parent texture from the cache or fallback to the provided texture.
   *
   * @param texture - The provided texture to resolve.
   * @returns The cached or provided texture.
   */
  resolveParentTexture(texture: ImageTexture): Texture {
    if (!texture?.props) {
      return texture;
    }

    const cacheKey = ImageTexture.makeCacheKey(texture.props);
    const cachedTexture = cacheKey
      ? this.getTextureFromCache(cacheKey)
      : undefined;
    return cachedTexture ?? texture;
  }
}
