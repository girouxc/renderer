import {
  assertTruthy,
  getNewId,
  premultiplyColorABGR,
  USE_RTT,
  ENABLE_AUTOSIZE,
  EMIT_BOUNDS_EVENTS,
} from '../utils.js';
import type { TextureOptions } from './CoreTextureManager.js';
import type { WebGlRenderer } from './renderers/webgl/WebGlRenderer.js';
import type { WebGlCtxTexture } from './renderers/webgl/WebGlCtxTexture.js';
import type { BufferCollection } from './renderers/webgl/internal/BufferCollection.js';
import type { CoreRenderer } from './renderers/CoreRenderer.js';
import type { Stage } from './Stage.js';
import {
  Texture,
  TextureType,
  type TextureCoords,
  type TextureFailedEventHandler,
  type TextureFreedEventHandler,
  type TextureLoadedEventHandler,
} from './textures/Texture.js';
import type {
  Dimensions,
  NodeTextureFailedPayload,
  NodeTextureFreedPayload,
  NodeTextureLoadedPayload,
  NodeRenderablePayload,
} from '../common/CommonTypes.js';
import { EventEmitter } from '../common/EventEmitter.js';
import {
  copyRect,
  intersectRect,
  type Bound,
  type RectWithValid,
  createBound,
  boundInsideBound,
  boundLargeThanBound,
  createPreloadBounds,
} from './lib/utils.js';
import { Matrix3d } from './lib/Matrix3d.js';
import { RenderCoords } from './lib/RenderCoords.js';
import type { AnimationSettings } from './animations/CoreAnimation.js';
import type { AnimationConfig } from './animations/AnimationManager.js';
import type { IAnimationController } from '../common/IAnimationController.js';
import { createAnimation } from './animations/CoreAnimation.js';
import type { CoreShaderNode } from './renderers/CoreShaderNode.js';
import { AutosizeMode, Autosizer } from './Autosizer.js';
import { removeChild } from './lib/collectionUtils.js';

export enum CoreNodeRenderState {
  Init = 0,
  OutOfBounds = 2,
  InBounds = 4,
  InViewport = 8,
}

const NO_CLIPPING_RECT: RectWithValid = {
  x: 0,
  y: 0,
  w: 0,
  h: 0,
  valid: false,
};

const CoreNodeRenderStateMap: Map<CoreNodeRenderState, string> = new Map();
CoreNodeRenderStateMap.set(CoreNodeRenderState.Init, 'init');
CoreNodeRenderStateMap.set(CoreNodeRenderState.OutOfBounds, 'outOfBounds');
CoreNodeRenderStateMap.set(CoreNodeRenderState.InBounds, 'inBounds');
CoreNodeRenderStateMap.set(CoreNodeRenderState.InViewport, 'inViewport');

export enum UpdateType {
  /**
   * Child updates
   */
  Children = 1,

  /**
   * localTransform
   *
   * @remarks
   * CoreNode Properties Updated:
   * - `localTransform`
   */
  Local = 2,

  /**
   * globalTransform
   *
   * * @remarks
   * CoreNode Properties Updated:
   * - `globalTransform`
   * - `renderBounds`
   * - `renderCoords`
   */
  Global = 4,

  /**
   * Clipping rect update
   *
   * @remarks
   * CoreNode Properties Updated:
   * - `clippingRect`
   */
  Clipping = 8,

  /**
   * Sort Z-Index Children update
   *
   * @remarks
   * CoreNode Properties Updated:
   * - `children` (sorts children by their `calcZIndex`)
   */
  SortZIndexChildren = 16,

  /**
   * Premultiplied Colors update
   *
   * @remarks
   * CoreNode Properties Updated:
   * - `premultipliedColorTl`
   * - `premultipliedColorTr`
   * - `premultipliedColorBl`
   * - `premultipliedColorBr`
   */
  PremultipliedColors = 32,

  /**
   * World Alpha update
   *
   * @remarks
   * CoreNode Properties Updated:
   * - `worldAlpha` = `parent.worldAlpha` * `alpha`
   */
  WorldAlpha = 64,

  /**
   * Render State update
   *
   * @remarks
   * CoreNode Properties Updated:
   * - `renderState`
   */
  RenderState = 128,

  /**
   * Is Renderable update
   *
   * @remarks
   * CoreNode Properties Updated:
   * - `isRenderable`
   */
  IsRenderable = 256,

  /**
   * Render Texture update
   */
  RenderTexture = 512,

  /**
   * Track if parent has render texture
   */
  ParentRenderTexture = 1024,

  /**
   * Render Bounds update
   */
  RenderBounds = 2048,

  /**
   * RecalcUniforms
   */
  RecalcUniforms = 4096,

  /**
   * Autosize update
   */
  Autosize = 8192,
  /**
   * None
   */
  None = 0,

  /**
   * All
   */
  All = 16383,
}

/**
 * A custom data map which can be stored on an CoreNode
 *
 * @remarks
 * This is a map of key-value pairs that can be stored on an INode. It is used
 * to store custom data that can be used by the application.
 * The data stored can only be of type string, number or boolean.
 */
export type CustomDataMap = {
  [key: string]: string | number | boolean | undefined;
};

/**
 * Writable properties of a Node.
 */
export interface CoreNodeProps {
  /**
   * The x coordinate of the Node's Mount Point.
   *
   * @remarks
   * See {@link mountX} and {@link mountY} for more information about setting
   * the Mount Point.
   *
   * @default `0`
   */
  x: number;
  /**
   * The y coordinate of the Node's Mount Point.
   *
   * @remarks
   * See {@link mountX} and {@link mountY} for more information about setting
   * the Mount Point.
   *
   * @default `0`
   */
  y: number;
  /**
   * The width of the Node.
   * @warning This will be deprecated in favor of `w` and `h` properties in the future.
   *
   * @default `0`
   */
  w: number;
  /**
   * The height of the Node.
   * @warning This will be deprecated in favor of `w` and `h` properties in the future.
   *
   * @default `0`
   */
  h: number;
  /**
   * The alpha opacity of the Node.
   *
   * @remarks
   * The alpha value is a number between 0 and 1, where 0 is fully transparent
   * and 1 is fully opaque.
   *
   * @default `1`
   */
  alpha: number;
  /**
   * Autosize
   *
   * @remarks
   * When enabled, the Node automatically resizes based on its content
   *
   * **Texture Autosize Mode:**
   * - When the Node has a texture, it automatically resizes to match the
   *   texture's dimensions when the texture loads
   * - This ensures images display at their natural size without manual sizing
   * - Text Nodes always use this mode regardless of this setting
   *
   * **Children Autosize Mode:**
   * - When the Node has no texture but contains children, it automatically
   *   resizes to encompass all children's bounds
   * - Calculates the bounding box that contains all child positions, dimensions,
   *   and transforms (scale, rotation, mount/pivot points)
   * - Creates container behavior where the parent grows to fit its content
   * - Updates dynamically as children are added, removed, or transformed
   *
   * **Mode Selection Logic:**
   * - Texture mode takes precedence over children mode
   * - Mode switches automatically when texture is added/removed
   * - If no texture and no children, autosize has no effect
   *
   * **Performance:**
   * - Children mode uses efficient transform caching and differential updates
   * - Only recalculates when child transforms actually change
   * - Minimal memory allocation with factory function patterns
   *
   *
   * @default `false`
   */
  autosize: boolean;
  /**
   * Margin around the Node's bounds for preloading
   *
   * @default `null`
   */
  boundsMargin: number | [number, number, number, number] | null;
  /**
   * Clipping Mode
   *
   * @remarks
   * Enable Clipping Mode when you want to prevent the drawing of a Node and
   * its descendants from overflowing outside of the Node's x/y/width/height
   * bounds.
   *
   * For WebGL, clipping is implemented using the high-performance WebGL
   * operation scissor. As a consequence, clipping does not work for
   * non-rectangular areas. So, if the element is rotated
   * (by itself or by any of its ancestors), clipping will not work as intended.
   *
   * TODO: Add support for non-rectangular clipping either automatically or
   * via Render-To-Texture.
   *
   * @default `false`
   */
  clipping: boolean;
  /**
   * The color of the Node.
   *
   * @remarks
   * The color value is a number in the format 0xRRGGBBAA, where RR is the red
   * component, GG is the green component, BB is the blue component, and AA is
   * the alpha component.
   *
   * Gradient colors may be set by setting the different color sub-properties:
   * {@link colorTop}, {@link colorBottom}, {@link colorLeft}, {@link colorRight},
   * {@link colorTl}, {@link colorTr}, {@link colorBr}, {@link colorBl} accordingly.
   *
   * @default `0xffffffff` (opaque white)
   */
  color: number;
  /**
   * The color of the top edge of the Node for gradient rendering.
   *
   * @remarks
   * See {@link color} for more information about color values and gradient
   * rendering.
   */
  colorTop: number;
  /**
   * The color of the bottom edge of the Node for gradient rendering.
   *
   * @remarks
   * See {@link color} for more information about color values and gradient
   * rendering.
   */
  colorBottom: number;
  /**
   * The color of the left edge of the Node for gradient rendering.
   *
   * @remarks
   * See {@link color} for more information about color values and gradient
   * rendering.
   */
  colorLeft: number;
  /**
   * The color of the right edge of the Node for gradient rendering.
   *
   * @remarks
   * See {@link color} for more information about color values and gradient
   * rendering.
   */
  colorRight: number;
  /**
   * The color of the top-left corner of the Node for gradient rendering.
   *
   * @remarks
   * See {@link color} for more information about color values and gradient
   * rendering.
   */
  colorTl: number;
  /**
   * The color of the top-right corner of the Node for gradient rendering.
   *
   * @remarks
   * See {@link color} for more information about color values and gradient
   * rendering.
   */
  colorTr: number;
  /**
   * The color of the bottom-right corner of the Node for gradient rendering.
   *
   * @remarks
   * See {@link color} for more information about color values and gradient
   * rendering.
   */
  colorBr: number;
  /**
   * The color of the bottom-left corner of the Node for gradient rendering.
   *
   * @remarks
   * See {@link color} for more information about color values and gradient
   * rendering.
   */
  colorBl: number;
  /**
   * The Node's parent Node.
   *
   * @remarks
   * The value `null` indicates that the Node has no parent. This may either be
   * because the Node is the root Node of the scene graph, or because the Node
   * has been removed from the scene graph.
   *
   * In order to make sure that a Node can be rendered on the screen, it must
   * be added to the scene graph by setting it's parent property to a Node that
   * is already in the scene graph such as the root Node.
   *
   * @default `null`
   */
  parent: CoreNode | null;
  /**
   * The Node's z-index.
   *
   * @remarks
   * Max z-index of children under the same parent determines which child
   * is rendered on top. Higher z-index means the Node is rendered on top of
   * children with lower z-index.
   *
   * Max value is 1000 and min value is -1000. Values outside of this range will be clamped.
   */
  zIndex: number;
  /**
   * The Node's Texture.
   *
   * @remarks
   * The `texture` defines a rasterized image that is contained within the
   * {@link width} and {@link height} dimensions of the Node. If null, the
   * Node will use an opaque white {@link ColorTexture} when being drawn, which
   * essentially enables colors (including gradients) to be drawn.
   *
   * If set, by default, the texture will be drawn, as is, stretched to the
   * dimensions of the Node. This behavior can be modified by setting the TBD
   * and TBD properties.
   *
   * To create a Texture in order to set it on this property, call
   * {@link RendererMain.createTexture}.
   *
   * If the {@link src} is set on a Node, the Node will use the
   * {@link ImageTexture} by default and the Node will simply load the image at
   * the specified URL.
   *
   * Note: If this is a Text Node, the Texture will be managed by the Node's
   * {@link TextRenderer} and should not be set explicitly.
   */
  texture: Texture | null;

  /**
   * Options to associate with the Node's Texture
   */
  textureOptions: TextureOptions;

  /**
   * The Node's shader
   *
   * @remarks
   * The `shader` defines a {@link Shader} used to draw the Node. By default,
   * the Default Shader is used which simply draws the defined {@link texture}
   * or {@link color}(s) within the Node without any special effects.
   *
   * To create a Shader in order to set it on this property, call
   * {@link RendererMain.createShader}.
   *
   * Note: If this is a Text Node, the Shader will be managed by the Node's
   * {@link TextRenderer} and should not be set explicitly.
   */
  shader: CoreShaderNode<any> | null;
  /**
   * Image URL
   *
   * @remarks
   * When set, the Node's {@link texture} is automatically set to an
   * {@link ImageTexture} using the source image URL provided (with all other
   * settings being defaults)
   */
  src: string | null;
  /**
   * Scale to render the Node at
   *
   * @remarks
   * The scale value multiplies the provided {@link width} and {@link height}
   * of the Node around the Node's Pivot Point (defined by the {@link pivot}
   * props).
   *
   * Behind the scenes, setting this property sets both the {@link scaleX} and
   * {@link scaleY} props to the same value.
   *
   * NOTE: When the scaleX and scaleY props are explicitly set to different values,
   * this property returns `null`. Setting `null` on this property will have no
   * effect.
   *
   * @default 1.0
   */
  scale: number | null;
  /**
   * Scale to render the Node at (X-Axis)
   *
   * @remarks
   * The scaleX value multiplies the provided {@link width} of the Node around
   * the Node's Pivot Point (defined by the {@link pivot} props).
   *
   * @default 1.0
   */
  scaleX: number;
  /**
   * Scale to render the Node at (Y-Axis)
   *
   * @remarks
   * The scaleY value multiplies the provided {@link height} of the Node around
   * the Node's Pivot Point (defined by the {@link pivot} props).
   *
   * @default 1.0
   */
  scaleY: number;
  /**
   * Combined position of the Node's Mount Point
   *
   * @remarks
   * The value can be any number between `0.0` and `1.0`:
   * - `0.0` defines the Mount Point at the top-left corner of the Node.
   * - `0.5` defines it at the center of the Node.
   * - `1.0` defines it at the bottom-right corner of the node.
   *
   * Use the {@link mountX} and {@link mountY} props seperately for more control
   * of the Mount Point.
   *
   * When assigned, the same value is also passed to both the {@link mountX} and
   * {@link mountY} props.
   *
   * @default 0 (top-left)
   */
  mount: number;
  /**
   * X position of the Node's Mount Point
   *
   * @remarks
   * The value can be any number between `0.0` and `1.0`:
   * - `0.0` defines the Mount Point's X position as the left-most edge of the
   *   Node
   * - `0.5` defines it as the horizontal center of the Node
   * - `1.0` defines it as the right-most edge of the Node.
   *
   * The combination of {@link mountX} and {@link mountY} define the Mount Point
   *
   * @default 0 (left-most edge)
   */
  mountX: number;
  /**
   * Y position of the Node's Mount Point
   *
   * @remarks
   * The value can be any number between `0.0` and `1.0`:
   * - `0.0` defines the Mount Point's Y position as the top-most edge of the
   *   Node
   * - `0.5` defines it as the vertical center of the Node
   * - `1.0` defines it as the bottom-most edge of the Node.
   *
   * The combination of {@link mountX} and {@link mountY} define the Mount Point
   *
   * @default 0 (top-most edge)
   */
  mountY: number;
  /**
   * Combined position of the Node's Pivot Point
   *
   * @remarks
   * The value can be any number between `0.0` and `1.0`:
   * - `0.0` defines the Pivot Point at the top-left corner of the Node.
   * - `0.5` defines it at the center of the Node.
   * - `1.0` defines it at the bottom-right corner of the node.
   *
   * Use the {@link pivotX} and {@link pivotY} props seperately for more control
   * of the Pivot Point.
   *
   * When assigned, the same value is also passed to both the {@link pivotX} and
   * {@link pivotY} props.
   *
   * @default 0.5 (center)
   */
  pivot: number;
  /**
   * X position of the Node's Pivot Point
   *
   * @remarks
   * The value can be any number between `0.0` and `1.0`:
   * - `0.0` defines the Pivot Point's X position as the left-most edge of the
   *   Node
   * - `0.5` defines it as the horizontal center of the Node
   * - `1.0` defines it as the right-most edge of the Node.
   *
   * The combination of {@link pivotX} and {@link pivotY} define the Pivot Point
   *
   * @default 0.5 (centered on x-axis)
   */
  pivotX: number;
  /**
   * Y position of the Node's Pivot Point
   *
   * @remarks
   * The value can be any number between `0.0` and `1.0`:
   * - `0.0` defines the Pivot Point's Y position as the top-most edge of the
   *   Node
   * - `0.5` defines it as the vertical center of the Node
   * - `1.0` defines it as the bottom-most edge of the Node.
   *
   * The combination of {@link pivotX} and {@link pivotY} define the Pivot Point
   *
   * @default 0.5 (centered on y-axis)
   */
  pivotY: number;
  /**
   * Rotation of the Node (in Radians)
   *
   * @remarks
   * Sets the amount to rotate the Node by around it's Pivot Point (defined by
   * the {@link pivot} props). Positive values rotate the Node clockwise, while
   * negative values rotate it counter-clockwise.
   *
   * Example values:
   * - `-Math.PI / 2`: 90 degree rotation counter-clockwise
   * - `0`: No rotation
   * - `Math.PI / 2`: 90 degree rotation clockwise
   * - `Math.PI`: 180 degree rotation clockwise
   * - `3 * Math.PI / 2`: 270 degree rotation clockwise
   * - `2 * Math.PI`: 360 rotation clockwise
   */
  rotation: number;

  /**
   * Whether the Node is rendered to a texture
   *
   * @remarks
   * TBD
   *
   * @default false
   */
  rtt: boolean;

  /**
   * Node data element for custom data storage (optional)
   *
   * @remarks
   * This property is used to store custom data on the Node as a key/value data store.
   * Data values are limited to string, numbers, booleans. Strings will be truncated
   * to a 2048 character limit for performance reasons.
   *
   * This is not a data storage mechanism for large amounts of data please use a
   * dedicated data storage mechanism for that.
   *
   * The custom data will be reflected in the inspector as part of `data-*` attributes
   *
   * @default `undefined`
   */
  data?: CustomDataMap;

  /**
   * Image Type to explicitly set the image type that is being loaded
   *
   * @remarks
   * This property must be used with a `src` that points at an image. In some cases
   * the extension doesn't provide a reliable representation of the image type. In such
   * cases set the ImageType explicitly.
   *
   * `regular` is used for normal images such as png, jpg, etc
   * `compressed` is used for ETC1/ETC2 compressed images with a PVR or KTX container
   * `svg` is used for scalable vector graphics
   *
   * @default `undefined`
   */
  imageType?: 'regular' | 'compressed' | 'svg' | null;

  /**
   * She width of the rectangle from which the Image Texture will be extracted.
   * This value can be negative. If not provided, the image's source natural
   * width will be used.
   */
  srcWidth?: number;
  /**
   * The height of the rectangle from which the Image Texture will be extracted.
   * This value can be negative. If not provided, the image's source natural
   * height will be used.
   */
  srcHeight?: number;
  /**
   * The x coordinate of the reference point of the rectangle from which the Texture
   * will be extracted.  `width` and `height` are provided. And only works when
   * createImageBitmap is available. Only works when createImageBitmap is supported on the browser.
   */
  srcX?: number;
  /**
   * The y coordinate of the reference point of the rectangle from which the Texture
   * will be extracted. Only used when source `srcWidth` width and `srcHeight` height
   * are provided. Only works when createImageBitmap is supported on the browser.
   */
  srcY?: number;
  /**
   * Mark the node as interactive so we can perform hit tests on it
   * when pointer events are registered.
   * @default false
   */
  interactive?: boolean;
  /**
   * preventDestroy flag prevents the node and its children from being destroyed
   * when the parent is destroyed.
   * @default false
   */
  preventDestroy?: boolean;

  /**
   * The name of the framework component that created this node.
   *
   * @remarks
   * When set, the Inspector will create a custom HTML element with this name
   * so that the Chrome DevTools Elements panel displays the component name
   * instead of a generic `<div>`. The value should match the JSX component
   * name as written in source (e.g. `"MyButton"`).
   *
   * This is typically injected by a Babel plugin (e.g. `jsx-locator`) and is
   * only meaningful when the Inspector is enabled.
   *
   * @default `undefined`
   */
  componentName?: string;

  /**
   * The source file path of the framework component that created this node.
   *
   * @remarks
   * When set alongside {@link componentName}, the Inspector will attach a
   * `data-location` attribute to the DOM element, enabling click-to-source
   * navigation from Chrome DevTools.
   *
   * The value should be an absolute or project-relative path to the component
   * source file, optionally followed by `:line:column`
   * (e.g. `"/src/components/MyButton.tsx:12:3"`).
   *
   * @default `undefined`
   */
  componentLocation?: string;
}

/**
 * Grab all the number properties of type T
 */
type NumberProps<T> = {
  [Key in keyof T as NonNullable<T[Key]> extends number ? Key : never]: number;
};

/**
 * Properties of a Node used by the animate() function
 */
export interface CoreNodeAnimateProps extends NumberProps<CoreNodeProps> {
  /**
   * Shader properties to animate
   */
  shaderProps: Record<string, number>;
  // TODO: textureProps: Record<string, number>;
}

/**
 * A visual Node in the Renderer scene graph.
 *
 * @remarks
 * CoreNode is an internally used class that represents a Renderer Node in the
 * scene graph. See INode.ts for the public APIs exposed to Renderer users
 * that include generic types for Shaders.
 */
export class CoreNode extends EventEmitter {
  readonly children: CoreNode[] = [];
  protected _id: number = getNewId();
  readonly props: CoreNodeProps;
  public readonly isCoreNode = true as const;
  private _animations: Record<
    string,
    { controller: AnimationConfig; settings: Partial<AnimationSettings> }
  > = {};

  // WebGL Render Op State
  public renderOpBufferIdx: number = 0;
  public numQuads: number = 0;
  public renderOpTextures: WebGlCtxTexture[] = [];

  /**
   * Permanent index (in float32 units) into the renderer's quad buffer.
   * -1 means this node has not yet been assigned a slot.
   */
  public quadBufferIndex: number = -1;

  /**
   * True when renderCoords, premultiplied colors, or textureCoords changed
   * since the node's quad was last written to the GPU.
   */
  public isQuadDirty: boolean = true;

  private hasShaderUpdater = false;
  public hasShaderTimeFn = false;
  private hasColorProps = false;
  public textureLoaded = false;

  public updateType = UpdateType.All;
  public childUpdateType = UpdateType.None;

  public globalTransform?: Matrix3d;
  public localTransform?: Matrix3d;
  public sceneGlobalTransform?: Matrix3d;
  public renderCoords?: RenderCoords;
  public sceneRenderCoords?: RenderCoords;
  public renderBound?: Bound;
  public strictBound?: Bound;
  public preloadBound?: Bound;
  public clippingRect: RectWithValid = {
    x: 0,
    y: 0,
    w: 0,
    h: 0,
    valid: false,
  };
  public textureCoords?: TextureCoords;
  public updateShaderUniforms: boolean = false;
  public isRenderable = false;
  public renderState: CoreNodeRenderState = CoreNodeRenderState.Init;
  public isSimple = true;

  public worldAlpha = 1;
  public premultipliedColorTl = 0;
  public premultipliedColorTr = 0;
  public premultipliedColorBl = 0;
  public premultipliedColorBr = 0;
  public calcZIndex = 0;
  public hasRTTupdates = false;
  public parentHasRenderTexture = false;
  public rttParent: CoreNode | null = null;
  /**
   * only used when rtt = true
   */
  public framebufferDimensions: Dimensions | null = null;

  /**Autosize properties */
  autosizer: Autosizer | null = null;
  parentAutosizer: Autosizer | null = null;

  public destroyed = false;

  constructor(readonly stage: Stage, props: CoreNodeProps) {
    super();

    //inital update type
    let initialUpdateType =
      UpdateType.Local | UpdateType.RenderBounds | UpdateType.RenderState;

    // Use the incoming props object directly — resolveNodeDefaults already
    // creates a fresh object with a consistent shape.  Save fields that are
    // re-applied through setters, then null them on props so the setters
    // detect the change.
    const { texture, shader, src, rtt, boundsMargin, interactive, parent } =
      props;
    const p = (this.props = props);
    p.texture = null;
    p.shader = null;
    p.src = null;
    p.rtt = false;
    p.boundsMargin = null;
    p.scale = null;

    //check if any color props are set for premultiplied color updates
    if (
      p.color > 0 ||
      p.colorTop > 0 ||
      p.colorBottom > 0 ||
      p.colorLeft > 0 ||
      p.colorRight > 0 ||
      p.colorTl > 0 ||
      p.colorTr > 0 ||
      p.colorBl > 0 ||
      p.colorBr > 0
    ) {
      this.hasColorProps = true;
      initialUpdateType |= UpdateType.PremultipliedColors;
    }

    // Only set non-default values
    if (p.zIndex !== 0) {
      this.zIndex = p.zIndex;
    }

    if (parent !== null) {
      parent.addChild(this);
    }

    // Assign saved values through setters only when they differ from defaults.
    // In the common JSX path these are all unset, so each unconditional setter
    // call would either short-circuit on equality or — for shader — fire a
    // redundant setUpdateType traversal up the parent chain.
    if (texture !== null) {
      this.texture = texture;
    }
    if (shader === null || shader === this.stage.defShaderNode) {
      // Default shader — bypass the setter; props.shader was reset to null
      // above and just needs to point at the default.
      p.shader = this.stage.defShaderNode;
    } else {
      this.shader = shader;
    }
    if (src !== null) {
      this.src = src;
    }
    if (rtt !== false) {
      this.rtt = rtt;
    }
    if (boundsMargin !== null) {
      this.boundsMargin = boundsMargin;
    }
    if (interactive !== undefined) {
      this.interactive = interactive;
    }

    // Initialize autosize if enabled
    if (p.autosize === true) {
      this.autosizer = new Autosizer(this);
    }

    this.setUpdateType(initialUpdateType);

    // if the default texture isn't loaded yet, wait for it to load
    // this only happens when the node is created before the stage is ready
    const dt = this.stage.defaultTexture;
    if (dt !== null && dt.state !== 'loaded') {
      dt.once('loaded', () => this.setUpdateType(UpdateType.IsRenderable));
    }
    this.updateIsSimple();
  }

  //#region Textures
  loadTexture(): void {
    if (this.props.texture === null) {
      return;
    }

    // If texture is already loaded / failed, trigger loaded event manually
    // so that users get a consistent event experience.
    // We do this in a microtask to allow listeners to be attached in the same
    // synchronous task after calling loadTexture()
    queueMicrotask(this.loadTextureTask);
  }

  /**
   * Task for queueMicrotask to loadTexture
   *
   * @remarks
   * This method is called in a microtask to release the texture.
   */
  private loadTextureTask = (): void => {
    const texture = this.props.texture as Texture;
    //it is possible that texture is null here if user sets the texture to null right after loadTexture call
    if (texture === null) {
      return;
    }
    if (this.textureOptions.preload === true) {
      this.stage.txManager.loadTexture(texture);
    }

    texture.preventCleanup = this.props.textureOptions?.preventCleanup ?? false;
    texture.on('loaded', this.onTextureLoaded);
    texture.on('failed', this.onTextureFailed);
    texture.on('freed', this.onTextureFreed);

    // If the parent is a render texture, the initial texture status
    // will be set to freed until the texture is processed by the
    // Render RTT nodes. So we only need to listen fo changes and
    // no need to check the texture.state until we restructure how
    // textures are being processed.
    if (this.parentHasRenderTexture) {
      this.notifyParentRTTOfUpdate();
      return;
    }

    if (texture.state === 'loaded') {
      this.onTextureLoaded(texture, texture.dimensions!);
    } else if (texture.state === 'failed') {
      this.onTextureFailed(texture, texture.error!);
    } else if (texture.state === 'freed') {
      this.onTextureFreed(texture);
    }
  };

  unloadTexture(): void {
    if (this.texture === null) {
      return;
    }

    const texture = this.texture;
    texture.off('loaded', this.onTextureLoaded);
    texture.off('failed', this.onTextureFailed);
    texture.off('freed', this.onTextureFreed);
    texture.setRenderableOwner(this._id, false);
  }

  protected onTextureLoaded: TextureLoadedEventHandler = (_, dimensions) => {
    if (this.autosizer !== null) {
      this.autosizer.update();
    }

    this.textureLoaded = true;
    this.setUpdateType(UpdateType.IsRenderable);

    // Texture was loaded. In case the RAF loop has already stopped, we request
    // a render to ensure the texture is rendered.
    this.stage.requestRender();

    // If parent has a render texture, flag that we need to update
    if (this.parentHasRenderTexture) {
      this.notifyParentRTTOfUpdate();
    }

    // ignore 1x1 pixel textures
    if (dimensions.w > 1 && dimensions.h > 1) {
      this.emit('loaded', {
        type: 'texture',
        dimensions,
      } satisfies NodeTextureLoadedPayload);
    }

    if (
      this.stage.calculateTextureCoord === true &&
      this.props.textureOptions !== null
    ) {
      this.textureCoords = this.stage.renderer.getTextureCoords!(this);
    }

    // Trigger a local update if the texture is loaded and the resizeMode is 'contain'
    if (this.props.textureOptions?.resizeMode?.type === 'contain') {
      this.setUpdateType(UpdateType.Local);
    }
  };

  private onTextureFailed: TextureFailedEventHandler = (_, error) => {
    // immediately set isRenderable to false, so that we handle the error
    // without waiting for the next frame loop
    this.textureLoaded = false;
    this.isRenderable = false;
    this.updateTextureOwnership(false);
    this.setUpdateType(UpdateType.IsRenderable);

    // If parent has a render texture, flag that we need to update
    if (this.parentHasRenderTexture) {
      this.notifyParentRTTOfUpdate();
    }

    if (
      this.texture !== null &&
      this.texture.retryCount > this.texture.maxRetryCount
    ) {
      this.emit('failed', {
        type: 'texture',
        error,
      } satisfies NodeTextureFailedPayload);
    }
  };

  private onTextureFreed: TextureFreedEventHandler = () => {
    // immediately set isRenderable to false, so that we handle the error
    // without waiting for the next frame loop
    this.textureLoaded = false;
    this.isRenderable = false;
    this.updateTextureOwnership(false);
    this.setUpdateType(UpdateType.IsRenderable);

    // If parent has a render texture, flag that we need to update
    if (this.parentHasRenderTexture) {
      this.notifyParentRTTOfUpdate();
    }

    this.emit('freed', {
      type: 'texture',
    } satisfies NodeTextureFreedPayload);
  };
  //#endregion Textures

  /**
   * Change types types is used to determine the scope of the changes being applied
   *
   * @remarks
   * See {@link UpdateType} for more information on each type
   *
   * @param type
   */
  setUpdateType(type: UpdateType): void {
    this.updateType |= type;

    const parent = this.props.parent;
    if (!parent || parent.updateType & UpdateType.Children) return;

    parent.setUpdateType(UpdateType.Children);
  }

  updateLocalTransform() {
    const p = this.props;
    const { x, y } = p;

    if (this.isSimple) {
      this.localTransform = Matrix3d.translate(x, y, this.localTransform);
      return;
    }

    const { w, h } = p;
    const mountTranslateX = p.mountX * w;
    const mountTranslateY = p.mountY * h;

    if (p.rotation !== 0 || p.scaleX !== 1 || p.scaleY !== 1) {
      const scaleRotate = Matrix3d.rotate(p.rotation, Matrix3d.temp).scale(
        p.scaleX,
        p.scaleY,
      );
      const pivotTranslateX = p.pivotX * w;
      const pivotTranslateY = p.pivotY * h;

      this.localTransform = Matrix3d.translate(
        x - mountTranslateX + pivotTranslateX,
        y - mountTranslateY + pivotTranslateY,
        this.localTransform,
      )
        .multiply(scaleRotate)
        .translate(-pivotTranslateX, -pivotTranslateY);
    } else {
      this.localTransform = Matrix3d.translate(
        x - mountTranslateX,
        y - mountTranslateY,
        this.localTransform,
      );
    }

    // Handle 'contain' resize mode
    const texture = p.texture;
    if (
      texture &&
      texture.dimensions &&
      p.textureOptions.resizeMode?.type === 'contain'
    ) {
      let resizeModeScaleX = 1;
      let resizeModeScaleY = 1;
      let extraX = 0;
      let extraY = 0;
      const { w: tw, h: th } = texture.dimensions;
      const txAspectRatio = tw / th;
      const nodeAspectRatio = w / h;
      if (txAspectRatio > nodeAspectRatio) {
        // Texture is wider than node
        // Center the node vertically (shift down by extraY)
        // Scale the node vertically to maintain original aspect ratio
        const scaleX = w / tw;
        const scaledTxHeight = th * scaleX;
        extraY = (h - scaledTxHeight) / 2;
        resizeModeScaleY = scaledTxHeight / h;
      } else {
        // Texture is taller than node (or equal)
        // Center the node horizontally (shift right by extraX)
        // Scale the node horizontally to maintain original aspect ratio
        const scaleY = h / th;
        const scaledTxWidth = tw * scaleY;
        extraX = (w - scaledTxWidth) / 2;
        resizeModeScaleX = scaledTxWidth / w;
      }

      // Apply the extra translation and scale to the local transform
      this.localTransform
        .translate(extraX, extraY)
        .scale(resizeModeScaleX, resizeModeScaleY);
    }
  }

  updateIsSimple() {
    const p = this.props;
    this.isSimple =
      p.rotation === 0 &&
      p.scaleX === 1 &&
      p.scaleY === 1 &&
      p.mountX === 0 &&
      p.mountY === 0 &&
      !(p.texture && p.textureOptions.resizeMode?.type === 'contain');
  }

  /**
   * @todo: test for correct calculation flag
   * @param delta
   */
  update(delta: number, parentClippingRect: RectWithValid): void {
    const props = this.props;
    //parent can be forced to ! because the root node update loop uses updateRoot which implies that
    //all other loops using this update method have a parent
    const parent = props.parent!;
    const parentHasRenderTexture = this.parentHasRenderTexture;
    let newRenderState: CoreNodeRenderState | null = null;
    let updateType = this.updateType;
    let childUpdateType = this.childUpdateType;

    //this needs to be handled before setting updateTypes are reset
    if (
      ENABLE_AUTOSIZE &&
      updateType & UpdateType.Autosize &&
      this.autosizer !== null
    ) {
      this.autosizer.update();
    }

    // reset update type
    this.updateType = 0;
    this.childUpdateType = 0;

    if (updateType & UpdateType.Local) {
      this.updateLocalTransform();

      updateType |= UpdateType.Global;
    }

    // Handle specific RTT updates at this node level
    if (USE_RTT && updateType & UpdateType.RenderTexture && this.rtt === true) {
      this.hasRTTupdates = true;
    }

    if (updateType & UpdateType.Global) {
      if (
        USE_RTT &&
        this.parentHasRenderTexture === true &&
        parent.rtt === true
      ) {
        // we are at the start of the RTT chain, so we need to reset the globalTransform
        // for correct RTT rendering
        this.globalTransform = Matrix3d.identity(this.globalTransform);

        // Maintain a full scene global transform for bounds detection
        const parentTransform =
          parent.globalTransform || Matrix3d.identity(Matrix3d.temp);

        this.sceneGlobalTransform = Matrix3d.copy(
          parentTransform,
          this.sceneGlobalTransform,
        ).translateOrMultiply(this.localTransform!);
      } else if (
        USE_RTT &&
        this.parentHasRenderTexture === true &&
        parent.rtt === false
      ) {
        // we're part of an RTT chain but our parent is not the main RTT node
        // so we need to propogate the sceneGlobalTransform of the parent
        // to maintain a full scene global transform for bounds detection
        const parentSceneTransform =
          parent.sceneGlobalTransform || this.localTransform!;

        this.sceneGlobalTransform = Matrix3d.copy(
          parentSceneTransform,
          this.sceneGlobalTransform,
        ).translateOrMultiply(this.localTransform!);

        this.globalTransform = Matrix3d.copy(
          parent.globalTransform || this.localTransform!,
          this.globalTransform,
        );
      } else {
        this.globalTransform = Matrix3d.copy(
          parent.globalTransform || this.localTransform!,
          this.globalTransform,
        );
      }

      if (this.isSimple) {
        this.globalTransform.translate(
          this.localTransform!.tx,
          this.localTransform!.ty,
        );
      } else {
        this.globalTransform.translateOrMultiply(this.localTransform!);
      }
      this.calculateRenderCoords();
      this.updateBoundingRect();

      updateType |= UpdateType.RenderState | UpdateType.RecalcUniforms;

      //only propagate children updates if not autosizing
      if ((updateType & UpdateType.Autosize) === 0) {
        updateType |= UpdateType.Children;
        childUpdateType |= UpdateType.Global;
      }

      if (this.clipping === true) {
        updateType |= UpdateType.Clipping | UpdateType.RenderBounds;
        childUpdateType |= UpdateType.RenderBounds;
      }
    }

    if (updateType & UpdateType.RenderBounds) {
      this.createRenderBounds();

      updateType |= UpdateType.RenderState | UpdateType.Children;
      childUpdateType |= UpdateType.RenderBounds;
    }

    if (updateType & UpdateType.RenderState) {
      newRenderState = this.checkRenderBounds();
      updateType |= UpdateType.IsRenderable;

      // if we're not going out of bounds, update the render state
      // this is done so the update loop can finish before we mark a node
      // as out of bounds
      if (newRenderState !== CoreNodeRenderState.OutOfBounds) {
        this.updateRenderState(newRenderState);
      }
    }

    if (updateType & UpdateType.WorldAlpha) {
      this.worldAlpha = parent.worldAlpha * this.props.alpha;
      updateType |=
        UpdateType.PremultipliedColors |
        UpdateType.Children |
        UpdateType.IsRenderable;
      childUpdateType |= UpdateType.WorldAlpha;
    }

    if (updateType & UpdateType.IsRenderable) {
      this.updateIsRenderable();
    }

    // Handle autosize updates when children transforms change
    if (
      ENABLE_AUTOSIZE &&
      updateType & UpdateType.Global &&
      this.isRenderable === true &&
      this.parentAutosizer !== null
    ) {
      this.parentAutosizer.patch(this.id);
    }

    if (updateType & UpdateType.Clipping) {
      this.calculateClippingRect(parentClippingRect);
      updateType |= UpdateType.Children;
      childUpdateType |= UpdateType.Clipping | UpdateType.RenderBounds;
    }

    if (updateType & UpdateType.PremultipliedColors) {
      const alpha = this.worldAlpha;

      const tl = props.colorTl;
      const tr = props.colorTr;
      const bl = props.colorBl;
      const br = props.colorBr;

      // Fast equality check (covers all 4 corners)
      const same = tl === tr && tl === bl && tl === br;

      const merged = premultiplyColorABGR(tl, alpha);

      this.premultipliedColorTl = merged;

      if (same === true) {
        this.premultipliedColorTr =
          this.premultipliedColorBl =
          this.premultipliedColorBr =
            merged;
      } else {
        this.premultipliedColorTr = premultiplyColorABGR(tr, alpha);
        this.premultipliedColorBl = premultiplyColorABGR(bl, alpha);
        this.premultipliedColorBr = premultiplyColorABGR(br, alpha);
      }
    }

    if (this.renderState === CoreNodeRenderState.OutOfBounds) {
      // Delay updating children until the node is in bounds
      this.updateType = updateType;
      this.childUpdateType = childUpdateType;
      return;
    }

    if (
      updateType & UpdateType.RecalcUniforms &&
      this.hasShaderUpdater === true
    ) {
      this.updateShaderUniforms = true;
    }

    if (this.isRenderable === true && this.updateShaderUniforms === true) {
      this.updateShaderUniforms = false;
      //this exists because the boolean hasShaderUpdater === true
      this.shader!.update!();
    }

    if (updateType & UpdateType.Children && this.children.length > 0) {
      let childClippingRect = this.clippingRect;

      if (USE_RTT && this.rtt === true) {
        childClippingRect = NO_CLIPPING_RECT;
      }

      for (let i = 0, length = this.children.length; i < length; i++) {
        const child = this.children[i] as CoreNode;

        if (childUpdateType !== 0) {
          child.updateType |= childUpdateType;
        }

        if (child.updateType === 0) {
          continue;
        }

        child.update(delta, childClippingRect);
      }
    }

    // If the node has an RTT parent and requires a texture re-render, inform the RTT parent
    // if (this.parentHasRenderTexture && updateType & UpdateType.RenderTexture) {
    // @TODO have a more scoped down updateType for RTT updates
    if (USE_RTT === true && parentHasRenderTexture === true) {
      this.notifyParentRTTOfUpdate();
    }

    //Resort children if needed
    if (updateType & UpdateType.SortZIndexChildren) {
      // reorder z-index
      this.sortChildren();
    }

    // If we're out of bounds, apply the render state now
    // this is done so nodes can finish their entire update loop before
    // being marked as out of bounds
    if (newRenderState === CoreNodeRenderState.OutOfBounds) {
      this.updateRenderState(newRenderState);
      this.updateIsRenderable();

      if (
        USE_RTT === true &&
        this.rtt === true &&
        newRenderState === CoreNodeRenderState.OutOfBounds
      ) {
        // notify children that we are going out of bounds
        // we have to do this now before we stop processing the render tree
        this.notifyChildrenRTTOfUpdate(newRenderState);
      }
    }

    // Mark quad dirty only when visual data (transforms, colors) actually
    // changed, so the WebGL renderer only re-uploads modified slots.
    if (
      updateType &
      (UpdateType.Global |
        UpdateType.PremultipliedColors |
        UpdateType.WorldAlpha)
    ) {
      this.isQuadDirty = true;
    }
  }

  private findParentRTTNode(): CoreNode | null {
    let rttNode: CoreNode | null = this.parent;
    while (rttNode && !rttNode.rtt) {
      rttNode = rttNode.parent;
    }
    return rttNode;
  }

  private notifyChildrenRTTOfUpdate(renderState: CoreNodeRenderState) {
    for (const child of this.children) {
      // force child to update render state
      child.updateRenderState(renderState);
      child.updateIsRenderable();
      child.notifyChildrenRTTOfUpdate(renderState);
    }
  }

  protected notifyParentRTTOfUpdate() {
    if (this.parent === null) {
      return;
    }

    const rttNode = this.rttParent || this.findParentRTTNode();
    if (!rttNode) {
      return;
    }

    // If an RTT node is found, mark it for re-rendering
    rttNode.hasRTTupdates = true;
    rttNode.setUpdateType(UpdateType.RenderTexture);

    // if rttNode is nested, also make it update its RTT parent
    if (rttNode.parentHasRenderTexture === true) {
      rttNode.notifyParentRTTOfUpdate();
    }
  }

  checkRenderBounds(): CoreNodeRenderState {
    if (boundInsideBound(this.renderBound!, this.strictBound!)) {
      return CoreNodeRenderState.InViewport;
    }

    if (boundInsideBound(this.renderBound!, this.preloadBound!)) {
      return CoreNodeRenderState.InBounds;
    }

    // check if we're larger then our parent, we're definitely in the viewport
    if (boundLargeThanBound(this.renderBound!, this.strictBound!)) {
      return CoreNodeRenderState.InViewport;
    }

    // check if we dont have dimensions, take our parent's render state
    if (this.parent !== null && (this.props.w === 0 || this.props.h === 0)) {
      return this.parent.renderState;
    }

    return CoreNodeRenderState.OutOfBounds;
  }

  updateBoundingRect() {
    const transform = (this.sceneGlobalTransform ||
      this.globalTransform) as Matrix3d;
    const renderCoords = (this.sceneRenderCoords ||
      this.renderCoords) as RenderCoords;

    if (transform.tb === 0 || transform.tc === 0) {
      this.renderBound = createBound(
        renderCoords.x1,
        renderCoords.y1,
        renderCoords.x3,
        renderCoords.y3,
        this.renderBound,
      );
    } else {
      const { x1, y1, x2, y2, x3, y3, x4, y4 } = renderCoords;
      this.renderBound = createBound(
        Math.min(x1, x2, x3, x4),
        Math.min(y1, y2, y3, y4),
        Math.max(x1, x2, x3, x4),
        Math.max(y1, y2, y3, y4),
        this.renderBound,
      );
    }
  }

  createRenderBounds(): void {
    if (this.parent !== null && this.parent.strictBound !== undefined) {
      // we have a parent with a valid bound, copy it
      const parentBound = this.parent.strictBound;
      this.strictBound = createBound(
        parentBound.x1,
        parentBound.y1,
        parentBound.x2,
        parentBound.y2,
        this.strictBound,
      );

      this.preloadBound = createPreloadBounds(
        this.strictBound,
        this.boundsMargin as [number, number, number, number],
        this.preloadBound,
      );
    } else {
      // no parent or parent does not have a bound, take the stage boundaries
      this.strictBound = this.stage.strictBound;
      this.preloadBound = this.stage.preloadBound;
    }

    // if clipping is disabled, we're done
    if (this.props.clipping === false) {
      return;
    }

    // only create local clipping bounds if node itself is in bounds
    // this can only be done if we have a render bound already
    if (this.renderBound === undefined) {
      return;
    }

    // if we're out of bounds, we're done
    if (boundInsideBound(this.renderBound, this.strictBound) === false) {
      return;
    }

    // clipping is enabled and we are in bounds create our own bounds
    const { x, y, w, h } = this.props;

    // Pick the global transform if available, otherwise use the local transform
    // global transform is only available if the node in an RTT chain
    const { tx, ty } = this.sceneGlobalTransform || this.globalTransform || {};
    const _x = tx ?? x;
    const _y = ty ?? y;
    this.strictBound = createBound(_x, _y, _x + w, _y + h, this.strictBound);

    this.preloadBound = createPreloadBounds(
      this.strictBound,
      this.boundsMargin as [number, number, number, number],
      this.preloadBound,
    );
  }

  updateRenderState(renderState: CoreNodeRenderState) {
    if (renderState === this.renderState) {
      return;
    }

    const previous = this.renderState;
    this.renderState = renderState;

    // If node visibility changes, dirty the render list cache
    if (
      renderState === CoreNodeRenderState.OutOfBounds ||
      previous === CoreNodeRenderState.OutOfBounds
    ) {
      this.stage.requestRenderListUpdate();
    }

    if (EMIT_BOUNDS_EVENTS) {
      const event = CoreNodeRenderStateMap.get(renderState);
      assertTruthy(event);
      this.emit(event, {
        previous,
        current: renderState,
      });
    }
  }

  /**
   * Checks if the node is renderable based on world alpha, dimensions and out of bounds status.
   */
  checkBasicRenderability(): boolean {
    if (this.worldAlpha === 0 || this.isOutOfBounds() === true) {
      return false;
    } else {
      return true;
    }
  }

  /**
   * Updates the `isRenderable` property based on various conditions.
   */
  updateIsRenderable() {
    let newIsRenderable = false;
    let needsTextureOwnership = false;

    // If the node is out of bounds or has an alpha of 0, it is not renderable
    if (this.checkBasicRenderability() === false) {
      this.updateTextureOwnership(false);
      this.setRenderable(false);
      return;
    }

    if (this.texture !== null) {
      // preemptive check for failed textures this will mark the current node as non-renderable
      // and will prevent further checks until the texture is reloaded or retry is reset on the texture
      if (this.texture.retryCount > this.texture.maxRetryCount) {
        // texture has failed to load, we cannot render
        this.updateTextureOwnership(false);
        this.setRenderable(false);
        return;
      }

      needsTextureOwnership = true;
      // Use cached boolean instead of string comparison
      newIsRenderable = this.textureLoaded;
    } else if (
      // check shader
      (this.props.shader !== this.stage.renderer.getDefaultShaderNode() ||
        this.hasColorProps === true) &&
      // check dimensions
      this.hasDimensions() === true
    ) {
      // This mean we have dimensions and a color set, so we can render a ColorTexture
      newIsRenderable = true;
    }

    this.updateTextureOwnership(needsTextureOwnership);
    this.setRenderable(newIsRenderable);
  }

  /**
   * Sets the renderable state and triggers changes if necessary.
   * @param isRenderable - The new renderable state
   */
  setRenderable(isRenderable: boolean) {
    const previousIsRenderable = this.isRenderable;
    this.isRenderable = isRenderable;

    // Emit event if renderable status has changed
    if (previousIsRenderable !== isRenderable) {
      this.stage.requestRenderListUpdate();
      if (EMIT_BOUNDS_EVENTS) {
        this.emit('renderable', {
          type: 'renderable',
          isRenderable,
        } satisfies NodeRenderablePayload);
      }
    }
  }

  /**
   * Changes the renderable state of the node.
   */
  updateTextureOwnership(isRenderable: boolean) {
    this.texture?.setRenderableOwner(this._id, isRenderable);
  }

  /**
   * Checks if the node is out of the viewport bounds.
   */
  isOutOfBounds(): boolean {
    return this.renderState <= CoreNodeRenderState.OutOfBounds;
  }

  /**
   * Checks if the node has dimensions (width/height)
   */
  hasDimensions(): boolean {
    return this.props.w !== 0 && this.props.h !== 0;
  }

  calculateRenderCoords() {
    const { w, h } = this.props;

    const g = this.globalTransform!;
    const tx = g.tx,
      ty = g.ty,
      ta = g.ta,
      tb = g.tb,
      tc = g.tc,
      td = g.td;
    if (tb === 0 && tc === 0) {
      const minX = tx;
      const maxX = tx + w * ta;
      const minY = ty;
      const maxY = ty + h * td;
      this.renderCoords = RenderCoords.translate(
        //top-left
        minX,
        minY,
        //top-right
        maxX,
        minY,
        //bottom-right
        maxX,
        maxY,
        //bottom-left
        minX,
        maxY,
        this.renderCoords,
      );
    } else {
      this.renderCoords = RenderCoords.translate(
        //top-left
        tx,
        ty,
        //top-right
        tx + w * ta,
        ty + w * tc,
        //bottom-right
        tx + w * ta + h * tb,
        ty + w * tc + h * td,
        //bottom-left
        tx + h * tb,
        ty + h * td,
        this.renderCoords,
      );
    }
    if (!USE_RTT || this.sceneGlobalTransform === undefined) {
      return;
    }

    const {
      tx: stx,
      ty: sty,
      ta: sta,
      tb: stb,
      tc: stc,
      td: std,
    } = this.sceneGlobalTransform;
    if (stb === 0 && stc === 0) {
      const minX = stx;
      const maxX = stx + w * sta;
      const minY = sty;
      const maxY = sty + h * std;
      this.sceneRenderCoords = RenderCoords.translate(
        //top-left
        minX,
        minY,
        //top-right
        maxX,
        minY,
        //bottom-right
        maxX,
        maxY,
        //bottom-left
        minX,
        maxY,
        this.sceneRenderCoords,
      );
    } else {
      this.sceneRenderCoords = RenderCoords.translate(
        //top-left
        stx,
        sty,
        //top-right
        stx + w * sta,
        sty + w * stc,
        //bottom-right
        stx + w * sta + h * stb,
        sty + w * stc + h * std,
        //bottom-left
        stx + h * stb,
        sty + h * std,
        this.sceneRenderCoords,
      );
    }
  }

  /**
   * This function calculates the clipping rectangle for a node.
   *
   * The function then checks if the node is rotated. If the node requires clipping and is not rotated, a new clipping rectangle is created based on the node's global transform and dimensions.
   * If a parent clipping rectangle exists, it is intersected with the node's clipping rectangle (if it exists), or replaces the node's clipping rectangle.
   *
   * Finally, the node's parentClippingRect and clippingRect properties are updated.
   */
  calculateClippingRect(parentClippingRect: RectWithValid) {
    const { clippingRect, props, globalTransform: gt } = this;
    const { clipping } = props;
    const isRotated = gt!.tb !== 0 || gt!.tc !== 0;

    if (clipping === true && isRotated === false) {
      clippingRect.x = gt!.tx;
      clippingRect.y = gt!.ty;
      clippingRect.w = this.props.w * gt!.ta;
      clippingRect.h = this.props.h * gt!.td;
      clippingRect.valid = true;
    } else {
      clippingRect.valid = false;
    }

    if (parentClippingRect.valid === true && clippingRect.valid === true) {
      // Intersect parent clipping rect with node clipping rect
      intersectRect(parentClippingRect, clippingRect, clippingRect);
    } else if (parentClippingRect.valid === true) {
      // Copy parent clipping rect
      copyRect(parentClippingRect, clippingRect);
      clippingRect.valid = true;
    }
  }

  /**
   * Destroy the node and cleanup all resources
   */
  destroy(isChild: boolean = false): void {
    if (this.destroyed === true || this.preventDestroy === true) {
      if (isChild && this.preventDestroy === true) {
        this.props.parent = null;
      }
      return;
    }
    this.destroyed = true;

    // Detach from parent first to stop propagation of updates
    if (isChild === false) {
      const parent = this.parent;
      if (parent !== null) {
        parent.removeChild(this);
      }
      this.props.parent = null;
      this.stage.requestRender();
    }

    this.removeAllListeners();
    this.unloadTexture();
    this.isRenderable = false;

    if (this.hasShaderTimeFn === true) {
      this.stage.untrackTimedNode(this);
    }

    if (USE_RTT && this.rtt === true) {
      this.stage.renderer.removeRTTNode(this);
    }

    // Kill children
    for (let i = 0, n = this.children.length; i < n; i++) {
      this.children[i]!.destroy(true);
    }
    this.children.length = 0;

    this.props.texture = null;
  }

  renderQuads(renderer: CoreRenderer): void {
    if (USE_RTT && this.parentHasRenderTexture === true) {
      const rtt = renderer.renderToTextureActive;
      if (rtt === false || this.parentRenderTexture !== renderer.activeRttNode)
        return;
    }
    // There is a race condition where the texture can be null
    // with RTT nodes. Adding this defensively to avoid errors.
    // Also check if we have a valid texture or default texture to render
    if (USE_RTT && this.renderTexture!.state !== 'loaded') {
      return;
    }

    renderer.addQuad(this);
  }

  get renderTexture(): Texture | null {
    return this.props.texture || this.stage.defaultTexture;
  }

  get renderTextureCoords(): TextureCoords | undefined {
    return this.textureCoords || this.stage.renderer.defaultTextureCoords;
  }

  get quadBufferCollection(): BufferCollection {
    return (this.stage.renderer as WebGlRenderer).quadBufferCollection;
  }

  get width(): number {
    return this.props.w;
  }

  get height(): number {
    return this.props.h;
  }

  get time(): number {
    if (this.hasShaderTimeFn === true) {
      return this.getTimerValue();
    }
    return 0;
  }

  getTimerValue(): number {
    if (typeof this.shader!.time === 'function') {
      return this.shader!.time(this.stage);
    }
    return this.stage.elapsedTime;
  }

  sortChildren() {
    this.children.sort((a, b) => a.props.zIndex - b.props.zIndex);
    this.stage.requestRenderListUpdate();
  }

  removeChild(node: CoreNode, targetParent: CoreNode | null = null) {
    if (targetParent === null) {
      if (
        USE_RTT &&
        this.props.rtt === true &&
        this.parentHasRenderTexture === true
      ) {
        node.clearRTTInheritance();
      }

      if (ENABLE_AUTOSIZE) {
        const autosizeTarget = this.autosizer || this.parentAutosizer;
        if (autosizeTarget !== null) {
          autosizeTarget.detach(node);
        }
      }
    }
    removeChild(node, this.children);
    this.stage.requestRenderListUpdate();
  }

  addChild(node: CoreNode, previousParent: CoreNode | null = null) {
    const inRttCluster =
      USE_RTT &&
      (this.props.rtt === true || this.parentHasRenderTexture === true);
    const children = this.children;
    let attachToAutosizer = false;
    let autosizeTarget: Autosizer | null = null;
    if (ENABLE_AUTOSIZE) {
      autosizeTarget = this.autosizer || this.parentAutosizer;
      attachToAutosizer = autosizeTarget !== null;
    }

    node.parentHasRenderTexture = inRttCluster;
    if (previousParent !== null) {
      const previousParentInRttCluster =
        USE_RTT &&
        (previousParent.props.rtt === true ||
          previousParent.parentHasRenderTexture === true);
      if (inRttCluster === false && previousParentInRttCluster === true) {
        // update child RTT status
        node.clearRTTInheritance();
      }

      if (ENABLE_AUTOSIZE) {
        const previousAutosizer = node.autosizer || node.parentAutosizer;
        if (previousAutosizer !== null) {
          if (!autosizeTarget || previousAutosizer.id !== autosizeTarget.id) {
            previousAutosizer.detach(node);
          }
          attachToAutosizer = false;
        }
      }
    }

    if (ENABLE_AUTOSIZE && attachToAutosizer === true && autosizeTarget) {
      //if this is true, then the autosizer really exists
      autosizeTarget.attach(node);
    }

    if (inRttCluster === true) {
      node.markChildrenWithRTT(this);
    }

    children.push(node);

    // check if we need to sort
    const lastIndex = children.length - 1;
    let shouldSort = node.zIndex !== 0;

    if (shouldSort === false && lastIndex > 0) {
      // If the new node has zIndex 0, we check if any existing children have (had) non-zero zIndex.
      // Since children are sorted, we only need to check the first and the last (before the new one).
      // The new node is at `lastIndex`. The previous last node is at `lastIndex - 1`.
      const first = children[0]!;
      const last = children[lastIndex - 1]!;
      shouldSort = first.zIndex !== 0 || last.zIndex !== 0;
    }

    if (shouldSort) {
      this.setUpdateType(UpdateType.SortZIndexChildren);
    }
    this.setUpdateType(UpdateType.Children);
    this.stage.requestRenderListUpdate();
  }

  //#region Properties
  get id(): number {
    return this._id;
  }

  get data(): CustomDataMap | undefined {
    return this.props.data;
  }

  set data(d: CustomDataMap | undefined) {
    this.props.data = d;
  }

  get x(): number {
    return this.props.x;
  }

  set x(value: number) {
    if (this.props.x !== value) {
      this.props.x = value;
      this.setUpdateType(UpdateType.Local);
    }
  }

  get absX(): number {
    return (
      this.props.x +
      -this.props.w * this.props.mountX +
      (this.props.parent?.absX || this.props.parent?.globalTransform?.tx || 0)
    );
  }

  get absY(): number {
    return (
      this.props.y +
      -this.props.h * this.props.mountY +
      (this.props.parent?.absY ?? 0)
    );
  }

  get y(): number {
    return this.props.y;
  }

  set y(value: number) {
    if (this.props.y !== value) {
      this.props.y = value;
      this.setUpdateType(UpdateType.Local);
    }
  }

  get w(): number {
    return this.props.w;
  }

  set w(value: number) {
    const props = this.props;
    if (props.w !== value) {
      props.w = value;
      let updateType = UpdateType.Local;

      if (
        props.texture !== null &&
        this.stage.calculateTextureCoord === true &&
        props.textureOptions !== null
      ) {
        this.textureCoords = this.stage.renderer.getTextureCoords!(this);
      }

      if (props.rtt === true) {
        this.framebufferDimensions!.w = value;
        this.texture = this.stage.txManager.createTexture(
          'RenderTexture',
          this.framebufferDimensions!,
        );
        updateType |= UpdateType.RenderTexture;
      }
      this.setUpdateType(updateType);
    }
  }

  get h(): number {
    return this.props.h;
  }

  set h(value: number) {
    const props = this.props;
    if (props.h !== value) {
      props.h = value;
      let updateType = UpdateType.Local;

      if (
        props.texture !== null &&
        this.stage.calculateTextureCoord === true &&
        props.textureOptions !== null
      ) {
        this.textureCoords = this.stage.renderer.getTextureCoords!(this);
      }

      if (props.rtt === true) {
        this.framebufferDimensions!.h = value;
        this.texture = this.stage.txManager.createTexture(
          'RenderTexture',
          this.framebufferDimensions!,
        );
        updateType |= UpdateType.RenderTexture;
      }
      this.setUpdateType(updateType);
    }
  }

  get scale(): number {
    // The CoreNode `scale` property is only used by Animations.
    // Unlike INode, `null` should never be possibility for Animations.
    return this.scaleX;
  }

  set scale(value: number) {
    // The CoreNode `scale` property is only used by Animations.
    // Unlike INode, `null` should never be possibility for Animations.
    this.scaleX = value;
    this.scaleY = value;
    this.updateIsSimple();
  }

  get scaleX(): number {
    return this.props.scaleX;
  }

  set scaleX(value: number) {
    if (this.props.scaleX !== value) {
      this.props.scaleX = value;
      this.setUpdateType(UpdateType.Local);
      this.updateIsSimple();
    }
  }

  get scaleY(): number {
    return this.props.scaleY;
  }

  set scaleY(value: number) {
    if (this.props.scaleY !== value) {
      this.props.scaleY = value;
      this.setUpdateType(UpdateType.Local);
      this.updateIsSimple();
    }
  }

  get mount(): number {
    return this.props.mount;
  }

  set mount(value: number) {
    if (this.props.mountX !== value || this.props.mountY !== value) {
      this.props.mountX = value;
      this.props.mountY = value;
      this.props.mount = value;
      this.setUpdateType(UpdateType.Local);
      this.updateIsSimple();
    }
  }

  get mountX(): number {
    return this.props.mountX;
  }

  set mountX(value: number) {
    if (this.props.mountX !== value) {
      this.props.mountX = value;
      this.setUpdateType(UpdateType.Local);
      this.updateIsSimple();
    }
  }

  get mountY(): number {
    return this.props.mountY;
  }

  set mountY(value: number) {
    if (this.props.mountY !== value) {
      this.props.mountY = value;
      this.setUpdateType(UpdateType.Local);
      this.updateIsSimple();
    }
  }

  get pivot(): number {
    return this.props.pivot;
  }

  set pivot(value: number) {
    if (this.props.pivotX !== value || this.props.pivotY !== value) {
      this.props.pivotX = value;
      this.props.pivotY = value;
      this.props.pivot = value;
      this.setUpdateType(UpdateType.Local);
    }
  }

  get pivotX(): number {
    return this.props.pivotX;
  }

  set pivotX(value: number) {
    if (this.props.pivotX !== value) {
      this.props.pivotX = value;
      this.setUpdateType(UpdateType.Local);
    }
  }

  get pivotY(): number {
    return this.props.pivotY;
  }

  set pivotY(value: number) {
    if (this.props.pivotY !== value) {
      this.props.pivotY = value;
      this.setUpdateType(UpdateType.Local);
    }
  }

  get rotation(): number {
    return this.props.rotation;
  }

  set rotation(value: number) {
    if (this.props.rotation !== value) {
      this.props.rotation = value;
      this.setUpdateType(UpdateType.Local);
      this.updateIsSimple();
    }
  }

  get alpha(): number {
    return this.props.alpha;
  }

  set alpha(value: number) {
    this.props.alpha = value;
    this.setUpdateType(
      UpdateType.PremultipliedColors |
        UpdateType.WorldAlpha |
        UpdateType.Children |
        UpdateType.IsRenderable,
    );
    this.childUpdateType |= UpdateType.WorldAlpha;
  }

  get autosize(): boolean {
    return this.props.autosize;
  }

  set autosize(value: boolean) {
    if (this.props.autosize === value) {
      return;
    }

    this.props.autosize = value;

    if (value === true && this.autosizer === null) {
      this.autosizer = new Autosizer(this);
    } else {
      this.autosizer = null;
    }
  }

  get boundsMargin(): number | [number, number, number, number] | null {
    const props = this.props;
    if (props.boundsMargin !== null) {
      return props.boundsMargin;
    }

    const parent = this.parent;
    if (parent !== null) {
      const margin = parent.boundsMargin;
      if (margin !== undefined) {
        return margin;
      }
    }

    return this.stage.boundsMargin;
  }

  set boundsMargin(value: number | [number, number, number, number] | null) {
    if (value === this.props.boundsMargin) {
      return;
    }

    if (value === null) {
      this.props.boundsMargin = value;
    } else {
      const bm: [number, number, number, number] = Array.isArray(value)
        ? value
        : [value, value, value, value];

      this.props.boundsMargin = bm;
    }
    this.setUpdateType(UpdateType.RenderBounds);
  }

  get clipping(): boolean {
    return this.props.clipping;
  }

  set clipping(value: boolean) {
    this.props.clipping = value;
    this.setUpdateType(
      UpdateType.Clipping | UpdateType.RenderBounds | UpdateType.Children,
    );
    this.childUpdateType |= UpdateType.Global | UpdateType.Clipping;
  }

  get color(): number {
    return this.props.color;
  }

  set color(value: number) {
    const p = this.props;
    if (p.color === value) return;

    p.color = value;

    const has = value > 0;

    if (has !== this.hasColorProps) {
      this.setUpdateType(UpdateType.IsRenderable);
    }
    this.hasColorProps = has;

    if (p.colorTop !== value) this.colorTop = value;
    if (p.colorBottom !== value) this.colorBottom = value;
    if (p.colorLeft !== value) this.colorLeft = value;
    if (p.colorRight !== value) this.colorRight = value;

    this.setUpdateType(UpdateType.PremultipliedColors);
  }

  get colorTop(): number {
    return this.props.colorTop;
  }

  set colorTop(value: number) {
    if (this.props.colorTl !== value || this.props.colorTr !== value) {
      this.colorTl = value;
      this.colorTr = value;
    }
    this.props.colorTop = value;
    this.hasColorProps = value > 0;
    this.setUpdateType(
      UpdateType.PremultipliedColors | UpdateType.IsRenderable,
    );
  }

  get colorBottom(): number {
    return this.props.colorBottom;
  }

  set colorBottom(value: number) {
    if (this.props.colorBl !== value || this.props.colorBr !== value) {
      this.colorBl = value;
      this.colorBr = value;
    }
    this.props.colorBottom = value;
    this.hasColorProps = value > 0;
    this.setUpdateType(
      UpdateType.PremultipliedColors | UpdateType.IsRenderable,
    );
  }

  get colorLeft(): number {
    return this.props.colorLeft;
  }

  set colorLeft(value: number) {
    if (this.props.colorTl !== value || this.props.colorBl !== value) {
      this.colorTl = value;
      this.colorBl = value;
    }
    this.props.colorLeft = value;
    this.hasColorProps = value > 0;
    this.setUpdateType(
      UpdateType.PremultipliedColors | UpdateType.IsRenderable,
    );
  }

  get colorRight(): number {
    return this.props.colorRight;
  }

  set colorRight(value: number) {
    if (this.props.colorTr !== value || this.props.colorBr !== value) {
      this.colorTr = value;
      this.colorBr = value;
    }
    this.props.colorRight = value;
    this.hasColorProps = value > 0;
    this.setUpdateType(
      UpdateType.PremultipliedColors | UpdateType.IsRenderable,
    );
  }

  get colorTl(): number {
    return this.props.colorTl;
  }

  set colorTl(value: number) {
    this.props.colorTl = value;
    this.hasColorProps = value > 0;
    this.setUpdateType(
      UpdateType.PremultipliedColors | UpdateType.IsRenderable,
    );
  }

  get colorTr(): number {
    return this.props.colorTr;
  }

  set colorTr(value: number) {
    this.props.colorTr = value;
    this.hasColorProps = value > 0;
    this.setUpdateType(
      UpdateType.PremultipliedColors | UpdateType.IsRenderable,
    );
  }

  get colorBl(): number {
    return this.props.colorBl;
  }

  set colorBl(value: number) {
    this.props.colorBl = value;
    this.hasColorProps = value > 0;
    this.setUpdateType(
      UpdateType.PremultipliedColors | UpdateType.IsRenderable,
    );
  }

  get colorBr(): number {
    return this.props.colorBr;
  }

  set colorBr(value: number) {
    this.props.colorBr = value;
    this.hasColorProps = value > 0;
    this.setUpdateType(
      UpdateType.PremultipliedColors | UpdateType.IsRenderable,
    );
  }

  get zIndex(): number {
    return this.props.zIndex;
  }

  set zIndex(value: number) {
    let sanitizedValue = value;
    if (isNaN(sanitizedValue) || Number.isFinite(sanitizedValue) === false) {
      console.warn(
        `zIndex was set to an invalid value: ${value}, defaulting to 0`,
      );
      sanitizedValue = 0;
    }

    //Clamp to safe integer range
    if (sanitizedValue > Number.MAX_SAFE_INTEGER) {
      sanitizedValue = 1000;
    } else if (sanitizedValue < Number.MIN_SAFE_INTEGER) {
      sanitizedValue = -1000;
    }

    if (this.props.zIndex === sanitizedValue) {
      return;
    }
    this.props.zIndex = sanitizedValue;
    const parent = this.parent;
    if (parent !== null) {
      parent.setUpdateType(UpdateType.SortZIndexChildren);
    }
  }

  get parent(): CoreNode | null {
    return this.props.parent;
  }

  set parent(newParent: CoreNode | null) {
    const oldParent = this.props.parent;
    if (oldParent === newParent) {
      return;
    }
    this.props.parent = newParent;
    if (oldParent) {
      oldParent.removeChild(this, newParent);
    }
    if (newParent !== null) {
      newParent.addChild(this, oldParent);
    }
    //since this node has a new parent, recalc global and render bounds
    this.setUpdateType(UpdateType.Global | UpdateType.RenderBounds);
  }

  get rtt(): boolean {
    return this.props.rtt;
  }

  set rtt(value: boolean) {
    if (this.props.rtt === value) {
      return;
    }
    this.props.rtt = value;

    if (value === true) {
      this.initRenderTexture();
      this.markChildrenWithRTT();
    } else {
      this.cleanupRenderTexture();
    }

    this.setUpdateType(UpdateType.RenderTexture);

    if (this.parentHasRenderTexture === true) {
      this.notifyParentRTTOfUpdate();
    }
  }

  get preventDestroy(): boolean | undefined {
    return this.props.preventDestroy;
  }

  set preventDestroy(value: boolean | undefined) {
    this.props.preventDestroy = value;
  }

  private initRenderTexture() {
    this.framebufferDimensions = {
      w: this.props.w,
      h: this.props.h,
    };
    this.texture = this.stage.txManager.createTexture(
      'RenderTexture',
      this.framebufferDimensions,
    );
    this.stage.renderer.renderToTexture(this);
  }

  private cleanupRenderTexture() {
    this.unloadTexture();
    this.clearRTTInheritance();

    this.hasRTTupdates = false;
    this.texture = null;
    this.framebufferDimensions = null;
  }

  private markChildrenWithRTT(node: CoreNode | null = null) {
    const parent = node || this;

    for (const child of parent.children) {
      child.setUpdateType(UpdateType.All);
      child.parentHasRenderTexture = true;
      child.markChildrenWithRTT();
    }
  }

  // Apply RTT inheritance when a node has an RTT-enabled parent
  private applyRTTInheritance(parent: CoreNode) {
    if (parent.rtt) {
      // Only the RTT node should be added to `renderToTexture`
      parent.setUpdateType(UpdateType.RenderTexture);
    }

    // Propagate `parentHasRenderTexture` downwards
    this.markChildrenWithRTT(parent);
  }

  // Clear RTT inheritance when detaching from an RTT chain
  private clearRTTInheritance() {
    // if this node is RTT itself stop the propagation important for nested RTT nodes
    // for the initial RTT node this is already handled in `set rtt`
    if (this.rtt) {
      return;
    }

    // If there's still an RTT ancestor higher up (nested RTT case), descendants
    // should inherit from that ancestor rather than be detached from RTT
    // entirely. Otherwise — when this node was the only RTT in the chain —
    // fully clear inheritance.
    const ancestorRTT = this.findParentRTTNode();

    for (const child of this.children) {
      if (ancestorRTT !== null) {
        child.parentHasRenderTexture = true;
        child.rttParent = ancestorRTT;
      } else {
        child.parentHasRenderTexture = false;
        child.rttParent = null;
      }
      // force child to update everything as the RTT inheritance has changed
      child.setUpdateType(UpdateType.All);
      child.clearRTTInheritance();
    }
  }

  get shader(): CoreShaderNode<any> | null {
    return this.props.shader;
  }

  set shader(shader: CoreShaderNode<any> | null) {
    // Null means "use the stage's default shader".  Handle this before the
    // equality short-circuit so that `set shader(null)` still applies the
    // default when `props.shader` is also null (e.g. when a framework
    // adopted a freshly-allocated props bag where shader was cleared).
    if (shader === null) {
      const def = this.stage.defShaderNode;
      if (this.props.shader === def) return;
      this.hasShaderUpdater = false;
      this.props.shader = def;
      this.setUpdateType(UpdateType.IsRenderable);
      return;
    }
    if (this.props.shader === shader) {
      return;
    }
    if (shader.shaderKey !== 'default') {
      this.hasShaderUpdater = shader.update !== undefined;
      this.hasShaderTimeFn = shader.time !== undefined;
      shader.attachNode(this);
    }

    if (this.hasShaderTimeFn === true) {
      this.stage.trackTimedNode(this);
    } else {
      this.stage.untrackTimedNode(this);
    }
    this.props.shader = shader;
    this.setUpdateType(UpdateType.IsRenderable | UpdateType.RecalcUniforms);
  }

  get src(): string | null {
    return this.props.src;
  }

  set src(imageUrl: string | null) {
    if (this.props.src === imageUrl) {
      return;
    }

    this.props.src = imageUrl;

    if (!imageUrl) {
      this.texture = null;
      return;
    }

    this.texture = this.stage.txManager.createTexture('ImageTexture', {
      src: imageUrl,
      w: this.props.w,
      h: this.props.h,
      type: this.props.imageType,
      sx: this.props.srcX,
      sy: this.props.srcY,
      sw: this.props.srcWidth,
      sh: this.props.srcHeight,
    });
  }

  set imageType(type: 'regular' | 'compressed' | 'svg' | null) {
    if (this.props.imageType === type) {
      return;
    }

    this.props.imageType = type;
  }

  get imageType() {
    return this.props.imageType || null;
  }

  get srcHeight(): number | undefined {
    return this.props.srcHeight;
  }

  set srcHeight(value: number) {
    this.props.srcHeight = value;
  }

  get srcWidth(): number | undefined {
    return this.props.srcWidth;
  }

  set srcWidth(value: number) {
    this.props.srcWidth = value;
  }

  get srcX(): number | undefined {
    return this.props.srcX;
  }

  set srcX(value: number) {
    this.props.srcX = value;
  }

  get srcY(): number | undefined {
    return this.props.srcY;
  }

  set srcY(value: number) {
    this.props.srcY = value;
  }

  /**
   * Returns the framebuffer dimensions of the RTT parent
   */
  get parentFramebufferDimensions(): Dimensions | null {
    if (this.rttParent !== null) {
      return this.rttParent.framebufferDimensions;
    }
    this.rttParent = this.findParentRTTNode();
    return this.rttParent ? this.rttParent.framebufferDimensions : null;
  }

  /**
   * Returns the parent render texture node if it exists.
   */
  get parentRenderTexture(): CoreNode | null {
    let parent = this.parent;
    while (parent) {
      if (parent.rtt) {
        return parent;
      }
      parent = parent.parent;
    }
    return null;
  }

  get texture(): Texture | null {
    return this.props.texture;
  }

  set texture(value: Texture | null) {
    if (this.props.texture === value) {
      return;
    }

    const oldTexture = this.props.texture;
    if (oldTexture) {
      this.unloadTexture();
      if (this.autosizer !== null && value === null) {
        this.autosizer.setMode(AutosizeMode.Children); // Set to children size mode
      }
    }

    this.textureCoords = undefined;
    this.props.texture = value;
    this.textureLoaded = value !== null && value.state === 'loaded';

    if (value !== null) {
      if (this.autosizer !== null) {
        this.autosizer.setMode(AutosizeMode.Texture); // Set to texture size mode
      }
      value.setRenderableOwner(this._id, this.isRenderable);
      this.loadTexture();
    }

    if (this.texture?.type === TextureType.subTexture && this.textureLoaded) {
      // When setting the texture value of a subtexture but the atlas is already loaded,
      // requestRenderListUpdate is not triggered, but we still need to update the quad
      this.isQuadDirty = true;
    }
    this.setUpdateType(UpdateType.IsRenderable);
    this.updateIsSimple();
  }

  set textureOptions(value: TextureOptions) {
    this.props.textureOptions = value;
    if (this.stage.calculateTextureCoord === true && value !== null) {
      this.textureCoords = this.stage.renderer.getTextureCoords!(this);
    }
    this.updateIsSimple();
  }

  get textureOptions(): TextureOptions {
    return this.props.textureOptions;
  }

  set interactive(value: boolean | undefined) {
    this.props.interactive = value;
    // Update Stage's interactive Set
    if (value === true) {
      this.stage.interactiveNodes.add(this);
    }
  }

  get interactive(): boolean | undefined {
    return this.props.interactive;
  }

  get componentName(): string | undefined {
    return this.props.componentName;
  }

  get componentLocation(): string | undefined {
    return this.props.componentLocation;
  }

  setRTTUpdates(type: number) {
    this.hasRTTupdates = true;
    this.parent?.setRTTUpdates(type);
  }

  animate(
    props: Partial<CoreNodeAnimateProps>,
    settings: Partial<AnimationSettings>,
  ): IAnimationController {
    return createAnimation(this.stage.animationManager, this, props, settings);
  }

  animateProp(
    name: string,
    value: number,
    settings: Partial<AnimationSettings>,
  ): IAnimationController {
    const existing = this._animations[name];

    if (existing && existing.settings === settings) {
      const controller = existing.controller;
      const values = controller.props ? controller.props[name] : null;

      if (values) {
        values.start = (this as any)[name] ?? 0;
        values.target = value;
        controller.progress = 0;

        if (settings.adaptiveDuration === true) {
          const now = performance.now();
          const elapsed = now - controller.lastRunTime;
          controller.lastRunTime = now;
          const duration = settings.duration ?? controller.duration;
          controller.duration = elapsed < duration ? elapsed : duration;
        }

        return controller.start();
      }
    }

    const animationProps: Partial<CoreNodeAnimateProps> = { [name]: value };
    const controller = createAnimation(
      this.stage.animationManager,
      this,
      animationProps,
      settings,
    );
    this._animations[name] = { controller, settings };
    return controller.start();
  }

  animateToTarget(prop: string): number | undefined {
    const animation = this._animations[prop];
    if (!animation) {
      return undefined;
    }
    return animation.controller.props?.[prop]?.target;
  }

  flush() {
    // no-op
  }

  /**
   * Add a texture to the current RenderOp.
   *
   * @param texture
   * @returns Assigned Texture Index of the texture in the render op
   */
  addTexture(texture: WebGlCtxTexture): number {
    const textures = this.renderOpTextures;
    const length = textures.length;

    for (let i = 0; i < length; i++) {
      if (textures[i] === texture) {
        return i;
      }
    }

    if (length >= 1) {
      return 0xffffffff;
    }

    textures.push(texture);
    return length;
  }

  draw(renderer: WebGlRenderer) {
    const { glw, options, stage } = renderer;
    const shader = this.props.shader as any;

    stage.shManager.useShader(shader.program);
    shader.program.bindRenderOp(this);

    // Clipping
    if (this.clippingRect.valid === true) {
      const pixelRatio =
        USE_RTT && this.parentHasRenderTexture ? 1 : stage.pixelRatio;

      const clipX = Math.round(this.clippingRect.x * pixelRatio);
      const clipWidth = Math.round(this.clippingRect.w * pixelRatio);
      const clipHeight = Math.round(this.clippingRect.h * pixelRatio);
      let clipY = Math.round(
        options.canvas.height - clipHeight - this.clippingRect.y * pixelRatio,
      );
      // if parent has render texture, we need to adjust the scissor rect
      // to be relative to the parent's framebuffer
      if (USE_RTT && this.parentHasRenderTexture) {
        const parentFramebufferDimensions = this.parentFramebufferDimensions;
        clipY =
          parentFramebufferDimensions !== null
            ? parentFramebufferDimensions.h - this.props.h
            : 0;
      }

      glw.setScissorTest(true);
      glw.scissor(clipX, clipY, clipWidth, clipHeight);
    } else {
      glw.setScissorTest(false);
    }

    const quadIdx = (this.renderOpBufferIdx / 20) * 6 * 2;
    glw.drawElements(
      glw.TRIANGLES,
      6 * this.numQuads,
      glw.UNSIGNED_SHORT,
      quadIdx,
    );
  }

  //#endregion Properties
}
