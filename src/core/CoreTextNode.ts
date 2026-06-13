import type {
  FontHandler,
  TextRenderer,
  TrProps,
  TextLayout,
  TextRenderInfo,
  SdfVertexCache,
} from './text-rendering/TextRenderer.js';
import { USE_RTT, premultiplyColorABGR } from '../utils.js';
import {
  CoreNode,
  CoreNodeRenderState,
  UpdateType,
  type CoreNodeProps,
} from './CoreNode.js';
import type { Stage } from './Stage.js';
import type {
  NodeTextFailedPayload,
  NodeTextLoadedPayload,
  NodeTextureLoadedPayload,
} from '../common/CommonTypes.js';
import type { RectWithValid } from './lib/utils.js';
import type { CoreRenderer } from './renderers/CoreRenderer.js';
import type { TextureLoadedEventHandler } from './textures/Texture.js';
import { Matrix3d } from './lib/Matrix3d.js';
export interface CoreTextNodeProps extends CoreNodeProps, TrProps {
  /**
   * Force Text Node to use a specific Text Renderer
   */
  textRendererOverride?: string | null;
  forceLoad: boolean;
}

export enum TextConstraint {
  'none' = 0,
  'width' = 1,
  'height' = 2,
  'both' = 3,
}

export class CoreTextNode extends CoreNode implements CoreTextNodeProps {
  private textRenderer: TextRenderer;
  private fontHandler: FontHandler;

  private _layoutGenerated = false;
  private _waitingForFont = false;
  private _containType: TextConstraint = TextConstraint.none;

  // SDF layout caching for performance
  private _cachedLayout: TextLayout | null = null;

  /** Cached pre-transformed SDF vertex data — avoids per-glyph matrix math when static. */
  private _sdfCache: SdfVertexCache = {
    vertices: null,
    glyphCount: 0,
    color: 0,
    alpha: -1,
    transform: new Float32Array(6),
    layoutRef: null,
  };

  // Text renderer properties - stored directly on the node
  private textProps: CoreTextNodeProps;

  private _renderInfo: TextRenderInfo = {
    width: 0,
    height: 0,
  };

  private _type: 'sdf' | 'canvas' = 'sdf'; // Default to SDF renderer

  constructor(
    stage: Stage,
    props: CoreTextNodeProps,
    textRenderer: TextRenderer,
  ) {
    super(stage, props);
    this.textRenderer = textRenderer;
    this.fontHandler = textRenderer.font;
    this._type = textRenderer.type;

    // Initialize text properties from props
    // Props are guaranteed to have all defaults resolved by Stage.createTextNode
    this.textProps = props;
    this._containType = TextConstraint[props.contain];

    this.setUpdateType(UpdateType.All);
  }

  protected override onTextureLoaded: TextureLoadedEventHandler = (
    _,
    dimensions,
  ) => {
    // If parent has a render texture, flag that we need to update
    if (USE_RTT && this.parentHasRenderTexture) {
      this.notifyParentRTTOfUpdate();
    }
    // ignore 1x1 pixel textures
    if (dimensions.w > 1 && dimensions.h > 1) {
      this.emit('loaded', {
        type: 'texture',
        dimensions,
      } satisfies NodeTextureLoadedPayload);
    }
    this.textureLoaded = true;
    this.setUpdateType(UpdateType.IsRenderable);
  };

  allowTextGeneration() {
    const p = this.props.parent;
    if (p === null) {
      return false;
    }
    if (p.worldAlpha > 0 && p.renderState > CoreNodeRenderState.OutOfBounds) {
      return true;
    }
    return false;
  }

  override updateLocalTransform() {
    const p = this.props;
    let { x, y, w, h } = p;
    const mountX = p.mountX;
    const mountY = p.mountY;
    let mountTranslateX = p.mountX * w;
    let mountTranslateY = p.mountY * h;

    const tProps = this.textProps;
    const { textAlign, verticalAlign, maxWidth, maxHeight } = tProps;
    const contain = this._containType;

    const hasMaxWidth = maxWidth > 0;
    const hasMaxHeight = maxHeight > 0;

    let containX = 0;
    let containY = 0;

    if (contain > 0 && (hasMaxWidth || hasMaxHeight)) {
      if (contain & TextConstraint.width && hasMaxWidth === true) {
        if (textAlign === 'right') {
          containX = maxWidth - w;
        } else if (textAlign === 'center') {
          containX = (maxWidth - w) * 0.5;
        }
        mountTranslateX = mountX * maxWidth;
      }
      if (contain & TextConstraint.height && hasMaxHeight === true) {
        mountTranslateY = mountY * maxHeight;
      }
    }

    const intrinsicH = this._renderInfo.height;
    const boxH = hasMaxHeight === true ? maxHeight : h;
    const slackY = boxH - intrinsicH;
    if (slackY > 0) {
      if (verticalAlign === 'bottom') {
        containY = slackY;
      } else if (verticalAlign === 'middle') {
        containY = slackY * 0.5;
      }
    }

    if (p.rotation !== 0 || p.scaleX !== 1 || p.scaleY !== 1) {
      const scaleRotate = Matrix3d.rotate(p.rotation, Matrix3d.temp).scale(
        p.scaleX,
        p.scaleY,
      );
      const pivotW =
        contain & TextConstraint.width && maxWidth > 0 ? maxWidth : w;
      const pivotH =
        contain & TextConstraint.height && maxHeight > 0 ? maxHeight : h;
      const pivotTranslateX = p.pivotX * pivotW;
      const pivotTranslateY = p.pivotY * pivotH;

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

    if (containX !== 0 || containY !== 0) {
      this.localTransform.translate(containX, containY);
    }
  }

  /**
   * Override CoreNode's update method to handle text-specific updates
   */
  override update(delta: number, parentClippingRect: RectWithValid): void {
    if (
      (this.textProps.forceLoad === true ||
        this.allowTextGeneration() === true) &&
      this._layoutGenerated === false
    ) {
      if (this.fontHandler.isFontLoaded(this.textProps.fontFamily) === true) {
        this._waitingForFont = false;
        this._cachedLayout = null; // Invalidate cached layout
        const resp = this.textRenderer.renderText(this.textProps);
        this.handleRenderResult(resp);
        this._layoutGenerated = true;
      } else if (this._waitingForFont === false) {
        this.fontHandler.waitingForFont(this.textProps.fontFamily, this);
        this._waitingForFont = true;
      }
    }

    // First run the standard CoreNode update
    super.update(delta, parentClippingRect);
  }

  /**
   * Override is renderable check for SDF text nodes
   */
  override updateIsRenderable(): void {
    // Canvas text relies on CoreNode's standard textureLoaded logic.
    if (this._type === 'canvas') {
      super.updateIsRenderable();
      return;
    }

    // For SDF, check if we have a cached layout. renderOnlyInViewport gates
    // SDF text the same way CoreNode gates quads: margin-ring text stays out
    // of the render list until it intersects the viewport.
    this.setRenderable(
      this.checkBasicRenderability() === true &&
        this._cachedLayout !== null &&
        (this.stage.renderOnlyInViewport === false ||
          this.renderState === CoreNodeRenderState.InViewport),
    );
  }

  /**
   * Handle the result of text rendering for both Canvas and SDF renderers
   */
  private handleRenderResult(result: TextRenderInfo): void {
    // Host paths on top
    const textRendererType = this._type;
    let width = result.width;
    let height = result.height;

    // Handle Canvas renderer (uses ImageData)
    if (textRendererType === 'canvas') {
      if (result.imageData === undefined) {
        // Empty text returns no imageData — clear the stale texture so the
        // previous text doesn't linger, then mark not renderable and continue
        // to update dimensions (w=0, h=0) rather than emitting a failure.
        this.texture = null;
        this.setRenderable(false);
      } else {
        this.texture = this.stage.txManager.createTexture('ImageTexture', {
          premultiplyAlpha: true,
          src: result.imageData as ImageData,
        });
        // It isn't renderable until the texture is loaded we have to set it to false here to avoid it
        // being detected as a renderable default color node in the next frame
        // it will be corrected once the texture is loaded
        this.setRenderable(false);

        if (this.renderState > CoreNodeRenderState.OutOfBounds) {
          // We do want the texture to load immediately. Routed through
          // updateTextureOwnership so the ownership cache stays in sync.
          this.updateTextureOwnership(true);
        }
      }
    }

    this._cachedLayout = result.layout || null;
    this.props.w = width;
    this.props.h = height;

    // Text dimensions may have changed, recalculate transforms and bounds.
    // RecalcUniforms because the direct props.w/h write above bypasses the
    // w/h setters and dimensions feed shader uniforms.
    this.setUpdateType(
      UpdateType.Local | UpdateType.RenderBounds | UpdateType.RecalcUniforms,
    );

    // Handle SDF renderer (uses layout caching)
    if (textRendererType === 'sdf') {
      this.setRenderable(true);
    }

    this._renderInfo = result;
    this.emitTextLoadedEvent();
  }

  // Reusable bound method for emitting loaded event
  private emitTextLoadedEvent = () => {
    this.emit('loaded', {
      type: 'text',
      dimensions: {
        w: this._renderInfo.width,
        h: this._renderInfo.height,
      },
    } satisfies NodeTextLoadedPayload);
  };

  /**
   * Override renderQuads to handle SDF vs Canvas rendering
   */
  override renderQuads(renderer: CoreRenderer): void {
    if (USE_RTT && this.parentHasRenderTexture === true) {
      const rtt = renderer.renderToTextureActive;
      if (rtt === false || this.parentRenderTexture !== renderer.activeRttNode)
        return;
    }

    // Canvas renderer: color is baked into the texture to preserve
    // native emoji colors. Use white tint with worldAlpha only.
    if (this._type === 'canvas') {
      const white = premultiplyColorABGR(0xffffffff, this.worldAlpha);
      this.premultipliedColorTl =
        this.premultipliedColorTr =
        this.premultipliedColorBl =
        this.premultipliedColorBr =
          white;
      super.renderQuads(renderer);
      return;
    }

    // Early return if no cached data
    if (!this._cachedLayout) {
      return;
    }

    const props = this.textProps;

    // Delegate to the text renderer which writes pre-transformed
    // vertices directly into the renderer's shared SDF buffer.
    // The renderer handles batching compatible text nodes into
    // single draw calls internally.
    this.textRenderer.renderQuads(
      renderer,
      this._cachedLayout as TextLayout,
      null!, // vertexBuffer is unused in batched SDF path
      {
        fontFamily: this.textProps.fontFamily,
        fontSize: props.fontSize,
        color: this.props.color || 0xffffffff,
        offsetY: props.offsetY,
        worldAlpha: this.worldAlpha,
        globalTransform: this.globalTransform!.getFloatArr(),
        clippingRect: this.clippingRect,
        width: this.props.w,
        height: this.props.h,
        parentHasRenderTexture: USE_RTT && this.parentHasRenderTexture,
        framebufferDimensions:
          USE_RTT && this.parentHasRenderTexture === true
            ? this.parentFramebufferDimensions
            : null,
        stage: this.stage,
        sdfCache: this._sdfCache,
      },
    );
  }

  override destroy(isChild: boolean = false): void {
    if (this._waitingForFont === true && this.fontHandler) {
      this.fontHandler.stopWaitingForFont(this.textProps.fontFamily, this);
    }

    // Clear cached layout and SDF vertex cache
    this._cachedLayout = null;
    this._sdfCache.vertices = null;
    this._sdfCache.layoutRef = null;

    this.fontHandler = null!; // Clear reference to avoid memory leaks
    this.textRenderer = null!; // Clear reference to avoid memory leaks

    super.destroy(isChild);
  }

  override set w(value: number) {
    this.maxWidth = value;
  }

  override get w(): number {
    return this.props.w;
  }

  override set h(value: number) {
    this.maxHeight = value;
  }

  override get h(): number {
    return this.props.h;
  }

  get maxWidth() {
    return this.textProps.maxWidth;
  }

  set maxWidth(value: number) {
    if (this.textProps.maxWidth !== value) {
      this.textProps.maxWidth = value;
      this._layoutGenerated = false;
      this.setUpdateType(UpdateType.Local);
    }
  }

  // Property getters and setters
  get maxHeight() {
    return this.textProps.maxHeight;
  }

  set maxHeight(value: number) {
    if (this.textProps.maxHeight !== value) {
      this.textProps.maxHeight = value;
      this._layoutGenerated = false;
      this.setUpdateType(UpdateType.Local);
    }
  }

  get contain(): TrProps['contain'] {
    return this.textProps.contain;
  }

  set contain(value: TrProps['contain']) {
    if (this.textProps.contain !== value) {
      this.textProps.contain = value;
      this._containType = TextConstraint[value];
      this.setUpdateType(UpdateType.Local);
    }
  }

  get text(): string {
    return this.textProps.text;
  }

  set text(value: string) {
    if (this.textProps.text !== value) {
      this.textProps.text = value;
      this._layoutGenerated = false;
      this.setUpdateType(UpdateType.Local);
    }
  }

  get fontSize(): number {
    return this.textProps.fontSize;
  }

  set fontSize(value: number) {
    if (this.textProps.fontSize !== value) {
      this.textProps.fontSize = value;
      this._layoutGenerated = false;
      this.setUpdateType(UpdateType.Local);
    }
  }

  get fontFamily(): string {
    return this.textProps.fontFamily;
  }

  set fontFamily(value: string) {
    if (this.textProps.fontFamily !== value) {
      if (this._waitingForFont === true) {
        this.fontHandler.stopWaitingForFont(this.textProps.fontFamily, this);
      }
      this.textProps.fontFamily = value;
      this._layoutGenerated = false;
      this.setUpdateType(UpdateType.Local);
    }
  }

  get fontStyle(): TrProps['fontStyle'] {
    return this.textProps.fontStyle;
  }

  set fontStyle(value: TrProps['fontStyle']) {
    if (this.textProps.fontStyle !== value) {
      this.textProps.fontStyle = value;
      this._layoutGenerated = false;
      this.setUpdateType(UpdateType.Local);
    }
  }

  get textAlign(): TrProps['textAlign'] {
    return this.textProps.textAlign;
  }

  set textAlign(value: TrProps['textAlign']) {
    if (this.textProps.textAlign !== value) {
      this.textProps.textAlign = value;
      this._layoutGenerated = false;
      this.setUpdateType(UpdateType.Local);
    }
  }

  get letterSpacing(): number {
    return this.textProps.letterSpacing;
  }

  set letterSpacing(value: number) {
    if (this.textProps.letterSpacing !== value) {
      this.textProps.letterSpacing = value;
      this._layoutGenerated = false;
      this.setUpdateType(UpdateType.Local);
    }
  }

  get lineHeight(): number {
    return this.textProps.lineHeight;
  }

  set lineHeight(value: number) {
    if (this.textProps.lineHeight !== value) {
      this.textProps.lineHeight = value;
      this._layoutGenerated = false;
      this.setUpdateType(UpdateType.Local);
    }
  }

  get maxLines(): number {
    return this.textProps.maxLines;
  }

  set maxLines(value: number) {
    if (this.textProps.maxLines !== value) {
      this.textProps.maxLines = value;
      this._layoutGenerated = false;
      this.setUpdateType(UpdateType.Local);
    }
  }

  get verticalAlign(): TrProps['verticalAlign'] {
    return this.textProps.verticalAlign;
  }

  set verticalAlign(value: TrProps['verticalAlign']) {
    if (this.textProps.verticalAlign !== value) {
      this.textProps.verticalAlign = value;
      this._layoutGenerated = false;
      this.setUpdateType(UpdateType.Local);
    }
  }

  get overflowSuffix(): string {
    return this.textProps.overflowSuffix;
  }

  set overflowSuffix(value: string) {
    if (this.textProps.overflowSuffix !== value) {
      this.textProps.overflowSuffix = value;
      this._layoutGenerated = false;
      this.setUpdateType(UpdateType.Local);
    }
  }

  get wordBreak(): TrProps['wordBreak'] {
    return this.textProps.wordBreak;
  }

  set wordBreak(value: TrProps['wordBreak']) {
    if (this.textProps.wordBreak !== value) {
      this.textProps.wordBreak = value;
      this._layoutGenerated = false;
      this.setUpdateType(UpdateType.Local);
    }
  }

  get offsetY(): number {
    return this.textProps.offsetY;
  }

  set offsetY(value: number) {
    if (this.textProps.offsetY !== value) {
      this.textProps.offsetY = value;
      this._layoutGenerated = false;
      this.setUpdateType(UpdateType.Local);
    }
  }

  override get color(): number {
    return this.props.color;
  }

  override set color(value: number) {
    super.color = value;
    if (this._type === 'canvas') {
      this._layoutGenerated = false;
      this.setUpdateType(UpdateType.Local);
    }
  }

  get forceLoad() {
    return this.textProps.forceLoad;
  }

  set forceLoad(value: boolean) {
    if (this.textProps.forceLoad !== value) {
      this.textProps.forceLoad = value;
      this.setUpdateType(UpdateType.Local);
    }
  }

  get renderInfo(): TextRenderInfo {
    return this._renderInfo;
  }
}
