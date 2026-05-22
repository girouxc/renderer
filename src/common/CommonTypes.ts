import type { CoreNodeRenderState } from '../core/CoreNode.js';
import type { TextureError } from '../core/TextureError.js';

/**
 * Types shared between Main Space and Core Space
 *
 * @remarks
 *
 * @module
 */

/**
 * Represents a width and height.
 */
export interface Dimensions {
  w: number;
  h: number;
}

/**
 * Payload for when text is loaded
 */
export type NodeTextLoadedPayload = {
  type: 'text';
  dimensions: Dimensions;
  /**
   * Visible glyph extent — from the first line's cap-top to the last
   * line's descender bottom. See `CoreTextNode.trimmedHeight`.
   */
  trimmedHeight: number;
};

/**
 * Payload for when texture is loaded
 */
export type NodeTextureLoadedPayload = {
  type: 'texture';
  dimensions: Dimensions;
};

/**
 * Combined type for all loaded payloads
 */
export type NodeLoadedPayload =
  | NodeTextLoadedPayload
  | NodeTextureLoadedPayload;

/**
 * Payload for when text failed to load
 */
export type NodeTextFailedPayload = {
  type: 'text';
  error: Error;
};

/**
 * Payload for when texture failed to load
 */
export type NodeTextureFailedPayload = {
  type: 'texture';
  error: TextureError;
};

/**
 * Payload for when texture failed to load
 */
export type NodeTextureFreedPayload = {
  type: 'texture';
};

/**
 * Payload for when node renderable status changes
 */
export type NodeRenderablePayload = {
  type: 'renderable';
  isRenderable: boolean;
};

/**
 * Combined type for all failed payloads
 */
export type NodeFailedPayload =
  | NodeTextFailedPayload
  | NodeTextureFailedPayload;

/**
 * Event handler for when the texture/text of a node has loaded
 */
export type NodeLoadedEventHandler = (
  target: any,
  payload: NodeLoadedPayload,
) => void;

/**
 * Event handler for when the texture/text of a node has failed to load
 */
export type NodeFailedEventHandler = (
  target: any,
  payload: NodeFailedPayload,
) => void;

/**
 * Event handler for when the renderable status of a node changes
 */
export type NodeRenderableEventHandler = (
  target: any,
  payload: NodeRenderablePayload,
) => void;

export type NodeRenderStatePayload = {
  type: 'renderState';
  payload: CoreNodeRenderState;
};

export type NodeRenderStateEventHandler = (
  target: any,
  payload: NodeRenderStatePayload,
) => void;

/**
 * Event payload for when an FpsUpdate event is emitted by either the Stage or
 * MainRenderer
 */
export interface FpsUpdatePayload {
  fps: number;
  contextSpyData: Record<string, number> | null;
}

/**
 * Event payload for when a frame tick event is emitted by the Stage
 */
export interface FrameTickPayload {
  time: number;
  delta: number;
}

/**
 * Event payload for when a an animtion tick event is emitted
 */
export interface AnimationTickPayload {
  progress: number;
}

/**
 * Event payload for when an RenderUpdate event is emitted by the Stage
 */
export interface RenderUpdatePayload {
  quads: number;
  renderOps: number;
}
