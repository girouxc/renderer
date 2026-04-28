import {
  assertTruthy,
  CALCULATE_FPS,
  isProductionEnvironment,
  setPremultiplyMode,
  USE_RTT,
} from '../utils.js';
import { AnimationManager } from './animations/AnimationManager.js';
import {
  UpdateType,
  CoreNode,
  CoreNodeRenderState,
  type CoreNodeProps,
} from './CoreNode.js';
import { CoreTextureManager } from './CoreTextureManager.js';
import { CoreShaderManager } from './CoreShaderManager.js';
import {
  type FontHandler,
  type FontLoadOptions,
  type TextRenderer,
  type TextRenderers,
  type TrProps,
} from './text-rendering/TextRenderer.js';

import { EventEmitter } from '../common/EventEmitter.js';
import { ContextSpy } from './lib/ContextSpy.js';
import type {
  FpsUpdatePayload,
  FrameTickPayload,
  RenderUpdatePayload,
} from '../common/CommonTypes.js';
import {
  TextureMemoryManager,
  type TextureMemoryManagerSettings,
} from './TextureMemoryManager.js';
import { CoreRenderer } from './renderers/CoreRenderer.js';
import { CoreTextNode, type CoreTextNodeProps } from './CoreTextNode.js';
import { santizeCustomDataMap } from '../main-api/utils.js';
import { pointInBound } from './lib/utils.js';
import type { CoreShaderNode } from './renderers/CoreShaderNode.js';
import { Matrix3d } from './lib/Matrix3d.js';
import { createBound, createPreloadBounds, type Bound } from './lib/utils.js';
import type { Texture } from './textures/Texture.js';
import { ColorTexture } from './textures/ColorTexture.js';
import type { Platform } from './platforms/Platform.js';
import type { WebPlatform } from './platforms/web/WebPlatform.js';
import type { RendererMainSettings } from '../main-api/Renderer.js';

export type StageOptions = Omit<
  RendererMainSettings,
  'inspector' | 'platform' | 'maxRetryCount'
> & {
  textureMemory: TextureMemoryManagerSettings;
  canvas: HTMLCanvasElement | OffscreenCanvas;
  fpsUpdateInterval: number;
  eventBus: EventEmitter;
  platform: Platform | WebPlatform;
  inspector: boolean;
  maxRetryCount: number;
  enableClear: boolean;
};

export type StageFpsUpdateHandler = (
  stage: Stage,
  fpsData: FpsUpdatePayload,
) => void;

export type StageFrameTickHandler = (
  stage: Stage,
  frameTickData: FrameTickPayload,
) => void;

export interface Point {
  x: number;
  y: number;
}

const autoStart = true;

export class Stage {
  /// Module Instances
  public readonly animationManager: AnimationManager;
  public readonly txManager: CoreTextureManager;
  public readonly txMemManager: TextureMemoryManager;
  public readonly textRenderers: Record<string, TextRenderer> = {};
  public readonly fontHandlers: Record<string, FontHandler> = {};
  public readonly shManager: CoreShaderManager;
  public readonly renderer: CoreRenderer;
  public readonly root: CoreNode;
  public readonly interactiveNodes: Set<CoreNode> = new Set();
  public boundsMargin: [number, number, number, number];
  public readonly defShaderNode: CoreShaderNode | null = null;
  public strictBound: Bound;
  public preloadBound: Bound;
  public readonly defaultTexture: Texture | null = null;
  public pixelRatio: number;
  public readonly bufferMemory: number = 2e6;
  public readonly platform: Platform | WebPlatform;
  public readonly calculateTextureCoord: boolean;

  /**
   * Target frame time in milliseconds (calculated from targetFPS)
   *
   * @remarks
   * This is pre-calculated to avoid recalculating on every frame.
   * - 0 means no throttling (use display refresh rate)
   * - >0 means throttle to this frame time (1000 / targetFPS)
   */
  public targetFrameTime: number = 0;

  /**
   * Renderer Event Bus for the Stage to emit events onto
   *
   * @remarks
   * In reality this is just the RendererMain instance, which is an EventEmitter.
   * this allows us to directly emit events from the Stage to RendererMain
   * without having to set up forwarding handlers.
   */
  public readonly eventBus: EventEmitter;

  /// State
  startTime = 0;
  deltaTime = 0;
  lastFrameTime = 0;
  currentFrameTime = 0;
  elapsedTime = 0;
  private timedNodes: CoreNode[] = [];
  private clrColor = 0x00000000;
  private fpsNumFrames = 0;
  private fpsElapsedTime = 0;
  private numQuadsRendered = 0;
  private numRenderOpsRendered = 0;
  private renderRequested = false;
  private reprocessFrame = false;
  private reprocessCallback: (() => void) | null = null;
  private frameEventQueue: [name: string, payload: unknown][] = [];

  // Flattened render list optimization
  public renderList: CoreNode[] = [];
  public renderListDirty: boolean = true;

  // Font resolve optimisation flags
  private hasOnlyOneFontEngine: boolean;
  private hasOnlyCanvasFontEngine: boolean;
  private hasCanvasEngine: boolean;
  private singleFontEngine: TextRenderer | null = null;
  private singleFontHandler: FontHandler | null = null;

  // Debug data
  contextSpy: ContextSpy | null = null;

  /**
   * Stage constructor
   */
  constructor(public options: StageOptions) {
    const {
      canvas,
      clearColor,
      appWidth,
      appHeight,
      boundsMargin,
      enableContextSpy,
      forceWebGL2,
      numImageWorkers,
      textureMemory,
      renderEngine,
      fontEngines,
      createImageBitmapSupport,
      platform,
      maxRetryCount,
    } = options;

    assertTruthy(
      platform !== null,
      'A CorePlatform is not provided in the options',
    );

    this.platform = platform;

    this.startTime = platform.getTimeStamp();

    this.eventBus = options.eventBus;

    // Calculate target frame time from targetFPS option
    this.targetFrameTime = options.targetFPS > 0 ? 1000 / options.targetFPS : 0;

    this.txManager = new CoreTextureManager(this, {
      numImageWorkers,
      createImageBitmapSupport,
      maxRetryCount,
    });

    // Wait for the Texture Manager to initialize
    // once it does, request a render
    this.txManager.on('initialized', () => {
      this.requestRender();
    });

    this.txMemManager = new TextureMemoryManager(this, textureMemory);

    this.animationManager = new AnimationManager();
    this.contextSpy = enableContextSpy ? new ContextSpy() : null;

    let bm = [0, 0, 0, 0] as [number, number, number, number];
    if (boundsMargin) {
      bm = Array.isArray(boundsMargin)
        ? boundsMargin
        : [boundsMargin, boundsMargin, boundsMargin, boundsMargin];
    }
    this.boundsMargin = bm;

    // precalculate our viewport bounds
    this.strictBound = createBound(0, 0, appWidth, appHeight);
    this.preloadBound = createPreloadBounds(this.strictBound, bm);

    this.clrColor = clearColor;

    this.pixelRatio =
      options.devicePhysicalPixelRatio * options.deviceLogicalPixelRatio;

    this.renderer = new renderEngine({
      stage: this,
      canvas,
      contextSpy: this.contextSpy,
      forceWebGL2,
    });

    this.shManager = new CoreShaderManager(this);

    this.defShaderNode = this.renderer.getDefaultShaderNode();
    this.calculateTextureCoord = this.renderer.getTextureCoords !== undefined;

    const renderMode = this.renderer.mode || 'webgl';

    this.createDefaultTexture();
    setPremultiplyMode(renderMode);

    // Must do this after renderer is created
    this.txManager.renderer = this.renderer;

    // Create text renderers
    this.hasOnlyOneFontEngine = fontEngines.length === 1;
    this.hasOnlyCanvasFontEngine =
      fontEngines.length === 1 && fontEngines[0]!.type === 'canvas';
    this.hasCanvasEngine = false;
    this.singleFontEngine = this.hasOnlyOneFontEngine
      ? (fontEngines[0] as TextRenderer)
      : null;
    this.singleFontHandler = this.hasOnlyOneFontEngine
      ? (fontEngines[0]?.font as FontHandler)
      : null;

    if (this.singleFontEngine === null) {
      // Multiple font engines case
      // Filter out incompatible engines first
      const compatibleEngines = fontEngines.filter(
        (fontEngine: TextRenderer) => {
          const type = fontEngine.type;

          if (type === 'sdf' && renderMode === 'canvas') {
            console.warn(
              'MsdfTextRenderer is not compatible with Canvas renderer. Skipping...',
            );
            return false;
          }

          if (type === 'canvas') {
            this.hasCanvasEngine = true;
          }

          return true;
        },
      );

      // Sort engines: SDF first, Canvas last, others in between
      const sortedEngines = compatibleEngines.sort(
        (a: TextRenderer, b: TextRenderer) => {
          if (a.type === 'sdf') return -1;
          if (b.type === 'sdf') return 1;
          if (a.type === 'canvas') return 1;
          if (b.type === 'canvas') return -1;
          return 0;
        },
      );

      // Initialize engines in sorted order
      sortedEngines.forEach((fontEngine: TextRenderer) => {
        const type = fontEngine.type;

        // Add to map for type-based access
        this.textRenderers[type] = fontEngine;
        this.textRenderers[type].init(this);

        this.fontHandlers[type] = fontEngine.font;
      });
    } else {
      // Single font engine case - initialize it directly
      const fontEngine = this.singleFontEngine;
      const type = fontEngine.type;

      // Check compatibility
      if (type === 'sdf' && renderMode === 'canvas') {
        console.warn(
          'MsdfTextRenderer is not compatible with Canvas renderer. Skipping...',
        );
      } else {
        if (type === 'canvas') {
          this.hasCanvasEngine = true;
        }

        // Add to map for type-based access
        this.textRenderers[type] = fontEngine;
        this.fontHandlers[type] = fontEngine.font;
        this.textRenderers[type].init(this);
      }
    }

    if (Object.keys(this.textRenderers).length === 0) {
      console.warn('No text renderers available. Your text will not render.');
    }

    // create root node
    const rootNode = new CoreNode(this, {
      x: 0,
      y: 0,
      w: appWidth,
      h: appHeight,
      alpha: 1,
      autosize: false,
      boundsMargin: null,
      clipping: false,
      color: 0x00000000,
      colorTop: 0x00000000,
      colorBottom: 0x00000000,
      colorLeft: 0x00000000,
      colorRight: 0x00000000,
      colorTl: 0x00000000,
      colorTr: 0x00000000,
      colorBl: 0x00000000,
      colorBr: 0x00000000,
      zIndex: 0,
      scaleX: 1,
      scaleY: 1,
      mountX: 0,
      mountY: 0,
      mount: 0,
      pivot: 0.5,
      pivotX: 0.5,
      pivotY: 0.5,
      rotation: 0,
      parent: null,
      texture: null,
      textureOptions: {},
      shader: this.defShaderNode,
      rtt: false,
      src: null,
      scale: 1,
    });

    this.root = rootNode;

    // Initialize root node properties
    rootNode.updateLocalTransform();
    rootNode.globalTransform = Matrix3d.copy(rootNode.localTransform!);
    rootNode.sceneGlobalTransform = Matrix3d.copy(rootNode.localTransform!);
    rootNode.calculateRenderCoords();
    rootNode.updateBoundingRect();
    rootNode.createRenderBounds();
    rootNode.updateRenderState(CoreNodeRenderState.InViewport);
    rootNode.updateIsRenderable();

    // Initialize premultiplied colors (default is transparent 0x00000000)
    rootNode.premultipliedColorTl =
      rootNode.premultipliedColorTr =
      rootNode.premultipliedColorBl =
      rootNode.premultipliedColorBr =
        0;

    // execute platform start loop
    if (autoStart === true) {
      this.platform.startLoop(this);
    }
  }

  setClearColor(color: number) {
    this.clearColor = color;
    this.renderer.updateClearColor(color);
    this.renderRequested = true;
  }

  /**
   * Update the target frame time based on the current targetFPS setting
   *
   * @remarks
   * This should be called whenever the targetFPS option is changed
   * to ensure targetFrameTime stays in sync.
   * targetFPS of 0 means no throttling (targetFrameTime = 0)
   * targetFPS > 0 means throttle to 1000/targetFPS milliseconds
   */
  updateTargetFrameTime() {
    this.targetFrameTime =
      this.options.targetFPS > 0 ? 1000 / this.options.targetFPS : 0;
  }

  updateFrameTime() {
    const newFrameTime = this.platform.getTimeStamp();
    this.lastFrameTime = this.currentFrameTime;
    this.currentFrameTime = newFrameTime;
    this.elapsedTime = newFrameTime - this.startTime;
    this.deltaTime = !this.lastFrameTime
      ? 100 / 6
      : newFrameTime - this.lastFrameTime;
    this.txManager.frameTime = newFrameTime;
    this.txMemManager.frameTime = newFrameTime;

    // This event is emitted at the beginning of the frame (before any updates
    // or rendering), so no need to to use `stage.queueFrameEvent` here.
    this.eventBus.emit('frameTick', {
      time: this.currentFrameTime,
      delta: this.deltaTime,
    });
  }

  /**
   * Create default PixelTexture
   */
  createDefaultTexture() {
    (this.defaultTexture as ColorTexture) = this.txManager.createTexture(
      'ColorTexture',
      {
        color: 0xffffffff,
      },
    );

    assertTruthy(this.defaultTexture instanceof ColorTexture);
    this.txManager.loadTexture(this.defaultTexture, true);

    // Mark the default texture as ALWAYS renderable
    // This prevents it from ever being cleaned up.
    // Fixes https://github.com/lightning-js/renderer/issues/262
    this.defaultTexture.setRenderableOwner('stage', true);

    // When the default texture is loaded, request a render in case the
    // RAF is paused. Fixes: https://github.com/lightning-js/renderer/issues/123
    this.defaultTexture.once('loaded', () => {
      this.requestRender();
    });
  }

  /**
   * Update animations
   */
  updateAnimations(): boolean {
    const { animationManager } = this;
    if (!this.root) {
      return false;
    }
    // step animation
    animationManager.update(this.deltaTime);
    return animationManager.activeAnimations.length > 0;
  }

  /**
   * Check if the scene has updates
   */
  hasSceneUpdates() {
    return (
      !!this.root.updateType ||
      this.renderRequested ||
      this.txManager.hasUpdates()
    );
  }

  /**
   * Start a new frame draw
   */
  drawFrame(hasActiveAnimations: boolean = false) {
    const { renderer, renderRequested, root } = this;

    // Update tree if needed
    do {
      const forceUpdate = this.reprocessFrame;
      this.reprocessFrame = false;

      if (root.updateType !== 0 || forceUpdate) {
        root.updateType = 0;
        const childUpdateType = root.childUpdateType;
        root.childUpdateType = 0;

        for (let i = 0, length = root.children.length; i < length; i++) {
          const child = root.children[i] as CoreNode;

          if (childUpdateType !== 0) {
            child.updateType |= childUpdateType;
          }

          if (child.updateType === 0) {
            continue;
          }

          child.update(this.deltaTime, root.clippingRect);
        }
      }

      if (this.reprocessCallback !== null) {
        this.reprocessCallback();
        this.reprocessCallback = null;
      }
    } while (this.reprocessFrame);

    // Process some textures asynchronously but don't block the frame
    // Use a background task to prevent frame drops
    if (this.txManager.hasUpdates() === true) {
      const timeLimit = hasActiveAnimations
        ? this.options.textureProcessingTimeLimit / 2
        : this.options.textureProcessingTimeLimit;

      this.txManager.processSome(timeLimit).catch((err) => {
        console.error('Error processing textures:', err);
      });
    }

    // Reset render operations and clear the canvas
    renderer.reset();

    // If we have RTT nodes draw them first
    // So we can use them as textures in the main scene
    if (USE_RTT && renderer.rttNodes.length > 0) {
      renderer.renderRTTNodes();
    }

    // Update render list if dirty
    if (this.renderListDirty === true) {
      this.renderList.length = 0;
      this.buildRenderList(this.root);
      this.renderListDirty = false;
    } else {
      // Fill quads buffer
      const renderList = this.renderList;
      for (let i = 0, len = renderList.length; i < len; i++) {
        renderList[i]!.renderQuads(renderer);
      }
    }

    // Perform render pass
    renderer.render();

    if (CALCULATE_FPS) {
      this.calculateFps();
      this.calculateRenderInfo();
    }

    // Reset renderRequested flag if it was set
    if (renderRequested === true) {
      this.renderRequested = false;
    }

    if (this.timedNodes.length > 0) {
      for (let key in this.timedNodes) {
        if (this.timedNodes[key]!.isRenderable === true) {
          this.requestRender();
          break;
        }
      }
    }
    // Check if we need to cleanup textures
    if (this.txMemManager.criticalCleanupRequested === true) {
      this.txMemManager.cleanup();
    }
  }

  /**
   * Queue an event to be emitted after the current/next frame is rendered
   *
   * @remarks
   * When we are operating in the context of the render loop, we may want to
   * emit events that are related to the current frame. However, we generally do
   * NOT want to emit events directly in the middle of the render loop, since
   * this could enable event handlers to modify the scene graph and cause
   * unexpected behavior. Instead, we queue up events to be emitted and then
   * flush the queue after the frame has been rendered.
   *
   * @param name
   * @param data
   */
  queueFrameEvent(name: string, data: unknown) {
    this.frameEventQueue.push([name, data]);
  }

  /**
   * Emit all queued frame events
   *
   * @remarks
   * This method should be called after the frame has been rendered to emit
   * all events that were queued during the frame.
   *
   * See {@link queueFrameEvent} for more information.
   */
  flushFrameEvents() {
    for (const [name, data] of this.frameEventQueue) {
      this.eventBus.emit(name, data);
    }
    this.frameEventQueue = [];
  }

  calculateFps() {
    // If there's an FPS update interval, emit the FPS update event
    // when the specified interval has elapsed.
    const { fpsUpdateInterval } = this.options;
    if (fpsUpdateInterval) {
      this.fpsNumFrames++;
      this.fpsElapsedTime += this.deltaTime;
      if (this.fpsElapsedTime >= fpsUpdateInterval) {
        const fps = Math.round(
          (this.fpsNumFrames * 1000) / this.fpsElapsedTime,
        );
        this.fpsNumFrames = 0;
        this.fpsElapsedTime = 0;
        this.queueFrameEvent('fpsUpdate', {
          fps,
          contextSpyData: this.contextSpy?.getData() ?? null,
        } satisfies FpsUpdatePayload);
        this.contextSpy?.reset();
      }
    }
  }

  calculateRenderInfo() {
    const quads = this.renderer.getQuadCount();
    const renderOps = this.renderer.getRenderOpCount();
    if (
      (quads && quads !== this.numQuadsRendered) ||
      (renderOps && renderOps !== this.numRenderOpsRendered)
    ) {
      this.numQuadsRendered = quads || 0;
      this.numRenderOpsRendered = renderOps || 0;
      this.queueFrameEvent('renderUpdate', {
        quads: this.numQuadsRendered,
        renderOps: this.numRenderOpsRendered,
      } satisfies RenderUpdatePayload);
    }
  }

  requestRenderListUpdate() {
    // Notify the renderer that the render list is structurally changing.
    // For the WebGL renderer this resets per-node buffer slot assignments
    // and schedules a full GPU buffer re-upload on the next frame.
    if (this.renderer.invalidateQuadBuffer !== undefined) {
      this.renderer.invalidateQuadBuffer();
    }
    this.renderListDirty = true;
    this.requestRender();
  }

  buildRenderList(node: CoreNode) {
    // If the node is renderable and has a loaded texture, add it
    if (node.isRenderable === true) {
      node.renderQuads(this.renderer);
      this.renderList.push(node);
    }

    const children = node.children;
    const len = children.length;
    for (let i = 0; i < len; i++) {
      const child = children[i] as CoreNode;

      // Skip invisible subtrees
      if (
        child.worldAlpha === 0 ||
        child.renderState === CoreNodeRenderState.OutOfBounds
      ) {
        continue;
      }

      this.buildRenderList(child);
    }
  }

  /**
   * Request a render pass without forcing an update
   */
  requestRender() {
    this.renderRequested = true;
  }

  reprocessUpdates(callback?: () => void) {
    this.reprocessFrame = true;
    if (callback) {
      this.reprocessCallback = callback;
    }
  }

  /**
   * Given a font name, and possible renderer override, return the best compatible text renderer.
   *
   * @remarks
   * Will try to return a canvas renderer if no other suitable renderer can be resolved.
   *
   * @param fontFamily
   * @param textRendererOverride
   * @returns
   */
  resolveTextRenderer(
    trProps: TrProps,
    textRendererOverride: keyof TextRenderers | null = null,
  ): TextRenderer | null {
    // If we have an overide, return it
    if (textRendererOverride !== null) {
      const overrideKey = String(textRendererOverride);
      if (this.textRenderers[overrideKey] === undefined) {
        console.warn(`Text renderer override '${overrideKey}' not found.`);
        return null;
      }

      return this.textRenderers[overrideKey];
    }

    // If we have only one font engine early return it
    if (this.singleFontEngine !== null) {
      // If we have only one font engine and its the canvas engine, we can just return it
      if (this.hasOnlyCanvasFontEngine === true) {
        return this.singleFontEngine;
      }

      // If we have only one font engine and it can render the font, return it
      if (this.singleFontHandler?.canRenderFont(trProps) === true) {
        return this.singleFontEngine;
      }

      // If we have only one font engine and it cannot render the font, return null
      console.warn(`Text renderer cannot render font`, trProps);

      return null;
    }

    // Multi font handling  - If we have multiple font engines, we need to resolve the best one

    // First check SDF
    if (this.fontHandlers['sdf']?.canRenderFont(trProps) === true) {
      return this.textRenderers.sdf || null;
    }

    // If we have a canvas engine, we can return it (it can render all fonts)
    if (this.hasCanvasEngine === true) {
      return this.textRenderers.canvas || null;
    }

    // If we have no font engines, return null
    console.warn('No text renderers available. Your text will not render.');
    return null;
  }

  createNode(props: Partial<CoreNodeProps>) {
    const resolvedProps = this.resolveNodeDefaults(props);
    return new CoreNode(this, resolvedProps);
  }

  createTextNode(props: Partial<CoreTextNodeProps>) {
    const fontSize = props.fontSize || 16;
    const resolvedProps = this.resolveNodeDefaults(props) as CoreTextNodeProps;

    resolvedProps.text = props.text ?? '';
    resolvedProps.textRendererOverride = props.textRendererOverride ?? null;
    resolvedProps.fontSize = fontSize;
    resolvedProps.fontFamily = props.fontFamily || 'sans-serif';
    resolvedProps.fontStyle = props.fontStyle || 'normal';
    resolvedProps.textAlign = props.textAlign || 'left';
    resolvedProps.offsetY = props.offsetY || 0;
    resolvedProps.letterSpacing = props.letterSpacing || 0;
    resolvedProps.lineHeight = props.lineHeight || 1.2;
    resolvedProps.maxLines = props.maxLines || 0;
    resolvedProps.verticalAlign = props.verticalAlign || 'top';
    resolvedProps.overflowSuffix = props.overflowSuffix || '...';
    resolvedProps.wordBreak = props.wordBreak || 'break-word';
    resolvedProps.contain = props.contain || 'none';
    resolvedProps.maxWidth = props.maxWidth || 0;
    resolvedProps.maxHeight = props.maxHeight || 0;
    resolvedProps.forceLoad = props.forceLoad || false;

    const resolvedTextRenderer = this.resolveTextRenderer(
      resolvedProps,
      resolvedProps.textRendererOverride as keyof TextRenderers | null,
    );

    if (!resolvedTextRenderer) {
      throw new Error(
        `No compatible text renderer found for ${resolvedProps.fontFamily}`,
      );
    }

    return new CoreTextNode(this, resolvedProps, resolvedTextRenderer);
  }

  setBoundsMargin(value: number | [number, number, number, number]) {
    this.boundsMargin = Array.isArray(value)
      ? value
      : [value, value, value, value];

    this.updateViewportBounds();
  }

  /**
   * Update the viewport bounds
   */
  updateViewportBounds() {
    const { appWidth, appHeight } = this.options;
    this.strictBound = createBound(0, 0, appWidth, appHeight);
    this.preloadBound = createPreloadBounds(
      this.strictBound,
      this.boundsMargin,
    );
    this.root.setUpdateType(UpdateType.RenderBounds | UpdateType.Children);
    this.root.childUpdateType |= UpdateType.RenderBounds;
  }

  /** Find all nodes at a given point
   * @param data
   */
  findNodesAtPoint(data: Point): CoreNode[] {
    const x = data.x / this.options.deviceLogicalPixelRatio;
    const y = data.y / this.options.deviceLogicalPixelRatio;
    const nodes: CoreNode[] = [];
    for (const node of this.interactiveNodes) {
      if (node.isRenderable === false) {
        continue;
      }
      if (pointInBound(x, y, node.renderBound!) === true) {
        nodes.push(node);
      }
    }
    return nodes;
  }

  /**
   * Find the top node at a given point
   * @param data
   * @returns
   */
  getNodeFromPosition(data: Point): CoreNode | null {
    const nodes: CoreNode[] = this.findNodesAtPoint(data);
    if (nodes.length === 0) {
      return null;
    }

    //get last node in array (as top node)
    let topNode = nodes[nodes.length - 1] as CoreNode;
    for (let i = 0; i < nodes.length; i++) {
      if (nodes[i]!.zIndex > topNode.zIndex) {
        topNode = nodes[i]!;
      }
    }
    return topNode || null;
  }

  /**
   * add node to timeNodes arrays
   * @param node
   * @returns
   */
  trackTimedNode(node: CoreNode) {
    if (this.timedNodes[node.id] !== undefined) {
      return;
    }
    this.timedNodes[node.id] = node;
  }

  /**
   * remove node from timeNodes arrays
   * @param node
   * @returns
   */
  untrackTimedNode(node: CoreNode) {
    if (this.timedNodes[node.id] === undefined) {
      return;
    }
    delete this.timedNodes[node.id];
  }

  /**
   * Resolves the default property values for a Node
   *
   * @remarks
   * This method is used internally by the RendererMain to resolve the default
   * property values for a Node. It is exposed publicly so that it can be used
   * by Core Driver implementations.
   *
   * @param props
   * @returns
   */
  protected resolveNodeDefaults(props: Partial<CoreNodeProps>): CoreNodeProps {
    const color = props.color ?? 0xffffffff;
    let colorTop = color;
    let colorBottom = color;
    let colorLeft = color;
    let colorRight = color;
    let colorTl = color;
    let colorTr = color;
    let colorBl = color;
    let colorBr = color;

    // Fast-path: Check if any complex color props are present
    // We check values directly to avoid destructuring
    if (
      props.colorTop !== undefined ||
      props.colorBottom !== undefined ||
      props.colorLeft !== undefined ||
      props.colorRight !== undefined ||
      props.colorTl !== undefined ||
      props.colorTr !== undefined ||
      props.colorBl !== undefined ||
      props.colorBr !== undefined
    ) {
      const {
        colorTop: top,
        colorBottom: bottom,
        colorLeft: left,
        colorRight: right,
      } = props;

      colorTop = top ?? color;
      colorBottom = bottom ?? color;
      colorLeft = left ?? color;
      colorRight = right ?? color;

      colorTl = props.colorTl ?? top ?? left ?? color;
      colorTr = props.colorTr ?? top ?? right ?? color;
      colorBl = props.colorBl ?? bottom ?? left ?? color;
      colorBr = props.colorBr ?? bottom ?? right ?? color;
    }

    const scale = props.scale ?? null;
    const mount = props.mount ?? 0;
    const pivot = props.pivot ?? 0.5;

    const data =
      !isProductionEnvironment && this.options.inspector
        ? santizeCustomDataMap(props.data ?? {})
        : {};

    return {
      x: props.x ?? 0,
      y: props.y ?? 0,
      w: props.w ?? 0,
      h: props.h ?? 0,
      alpha: props.alpha ?? 1,
      autosize: props.autosize ?? false,
      boundsMargin: props.boundsMargin ?? null,
      clipping: props.clipping ?? false,
      color,
      colorTop,
      colorBottom,
      colorLeft,
      colorRight,
      colorTl,
      colorTr,
      colorBl,
      colorBr,
      zIndex: props.zIndex ?? 0,
      parent: props.parent ?? null,
      texture: props.texture ?? null,
      textureOptions: props.textureOptions ?? {},
      shader: props.shader ?? this.defShaderNode,
      src: props.src ?? null,
      srcHeight: props.srcHeight,
      srcWidth: props.srcWidth,
      srcX: props.srcX,
      srcY: props.srcY,
      scale,
      scaleX: props.scaleX ?? scale ?? 1,
      scaleY: props.scaleY ?? scale ?? 1,
      mount,
      mountX: props.mountX ?? mount,
      mountY: props.mountY ?? mount,
      pivot,
      pivotX: props.pivotX ?? pivot,
      pivotY: props.pivotY ?? pivot,
      rotation: props.rotation ?? 0,
      rtt: props.rtt ?? false,
      data,
      imageType: props.imageType,
      interactive: props.interactive ?? false,
      preventDestroy: props.preventDestroy,
      componentName: props.componentName,
      componentLocation: props.componentLocation,
    };
  }

  /**
   * Cleanup Orphaned Textures
   *
   * @remarks
   * This method is used to cleanup orphaned textures that are no longer in use.
   */
  cleanup(full: boolean = false) {
    this.txMemManager.cleanup(full);
  }

  set clearColor(value: number) {
    this.renderer.updateClearColor(value);
    this.renderRequested = true;
    this.clrColor = value;
  }

  get clearColor() {
    return this.clrColor;
  }

  /**
   * Load a font using a specific text renderer type
   *
   * @remarks
   * This method allows consumers to explicitly load fonts for a specific
   * text renderer type (e.g., 'canvas', 'sdf'). Consumers must specify
   * the renderer type to ensure fonts are loaded with the correct pipeline.
   *
   * For Canvas fonts, provide fontUrl (e.g., .ttf, .woff, .woff2)
   * For SDF fonts, provide atlasUrl (image) and atlasDataUrl (JSON glyph data)
   *
   * @param rendererType - The type of text renderer ('canvas', 'sdf', etc.)
   * @param options - Font loading options specific to the renderer type
   * @returns Promise that resolves when the font is loaded
   */
  async loadFont(
    rendererType: TextRenderers,
    options: FontLoadOptions,
  ): Promise<void> {
    const rendererTypeKey = String(rendererType);
    const fontHandler = this.fontHandlers[rendererTypeKey];

    if (!fontHandler) {
      throw new Error(
        `Font handler for renderer type '${rendererTypeKey}' not found. Available types: ${Object.keys(
          this.fontHandlers,
        ).join(', ')}`,
      );
    }

    return fontHandler.loadFont(this, options);
  }
}
