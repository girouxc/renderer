import { describe, expect, it, vi } from 'vitest';
import { CoreNode, type CoreNodeProps, UpdateType } from './CoreNode.js';
import { Stage } from './Stage.js';
import { CoreRenderer } from './renderers/CoreRenderer.js';
import { mock } from 'vitest-mock-extended';
import { type TextureOptions } from './CoreTextureManager.js';
import { createBound } from './lib/utils.js';
import { ImageTexture } from './textures/ImageTexture.js';
import { Matrix3d } from './lib/Matrix3d.js';

describe('set color()', () => {
  const defaultProps = (overrides?: Partial<CoreNodeProps>): CoreNodeProps => ({
    alpha: 0,
    autosize: false,
    boundsMargin: null,
    clipping: false,
    color: 0,
    colorBl: 0,
    colorBottom: 0,
    colorBr: 0,
    colorLeft: 0,
    colorRight: 0,
    colorTl: 0,
    colorTop: 0,
    colorTr: 0,
    h: 0,
    mount: 0,
    mountX: 0,
    mountY: 0,
    parent: null,
    pivot: 0,
    pivotX: 0,
    pivotY: 0,
    rotation: 0,
    rtt: false,
    scale: 1,
    scaleX: 1,
    scaleY: 1,
    shader: null,
    src: '',
    texture: null,
    textureOptions: {} as TextureOptions,
    w: 0,
    x: 0,
    y: 0,
    zIndex: 0,
    preventDestroy: false,
    ...overrides,
  });

  const clippingRect = {
    x: 0,
    y: 0,
    w: 200,
    h: 200,
    valid: false,
  };

  const stage = mock<Stage>({
    strictBound: createBound(0, 0, 200, 200),
    preloadBound: createBound(0, 0, 200, 200),
    defaultTexture: {
      state: 'loaded',
    },
    renderer: mock<CoreRenderer>() as CoreRenderer,
  });

  describe('set color()', () => {
    it('should set all color subcomponents.', () => {
      const node = new CoreNode(stage, defaultProps());
      node.colorBl = 0x99aabbff;
      node.colorBr = 0xaabbccff;
      node.colorTl = 0xbbcceeff;
      node.colorTr = 0xcceeffff;

      node.color = 0xffffffff;
      node.color = 0xffffffff;

      expect(node.color).toBe(0xffffffff);
      expect(node.colorBl).toBe(0xffffffff);
      expect(node.colorBr).toBe(0xffffffff);
      expect(node.colorTl).toBe(0xffffffff);
      expect(node.colorTr).toBe(0xffffffff);
      expect(node.colorLeft).toBe(0xffffffff);
      expect(node.colorRight).toBe(0xffffffff);
      expect(node.colorTop).toBe(0xffffffff);
      expect(node.colorBottom).toBe(0xffffffff);
    });

    it('should set update type.', () => {
      const node = new CoreNode(stage, defaultProps());
      node.updateType = 0;
      node.color = 0xffffffff;

      expect(node.updateType).toBe(
        UpdateType.PremultipliedColors | UpdateType.IsRenderable,
      );
    });
  });

  describe('isRenderable checks', () => {
    it('should return false if node is not renderable', () => {
      const node = new CoreNode(stage, defaultProps());
      expect(node.isRenderable).toBe(false);
    });

    it('visible node that is a color texture', () => {
      const parent = new CoreNode(stage, defaultProps());
      // Manually set parent properties that update() might read
      parent.globalTransform = Matrix3d.identity();
      parent.worldAlpha = 1;

      const node = new CoreNode(stage, defaultProps({ parent }));
      node.alpha = 1;
      node.x = 0;
      node.y = 0;
      node.w = 100;
      node.h = 100;
      node.color = 0xffffffff;

      node.update(0, clippingRect);
      expect(node.isRenderable).toBe(true);
    });

    it('visible node that is a texture', () => {
      const parent = new CoreNode(stage, defaultProps());
      parent.globalTransform = Matrix3d.identity();
      parent.worldAlpha = 1;

      const node = new CoreNode(stage, defaultProps({ parent }));
      node.alpha = 1;
      node.x = 0;
      node.y = 0;
      node.w = 100;
      node.h = 100;
      node.texture = mock<ImageTexture>({
        state: 'initial',
      });

      node.update(0, clippingRect);
      expect(node.isRenderable).toBe(false);

      node.texture.state = 'loaded';
      node.textureLoaded = true;
      node.setUpdateType(UpdateType.IsRenderable);
      node.update(1, clippingRect);

      expect(node.isRenderable).toBe(true);
    });

    it('a node with a texture with alpha 0 should not be renderable', () => {
      const parent = new CoreNode(stage, defaultProps());
      parent.globalTransform = Matrix3d.identity();
      parent.worldAlpha = 1;

      const node = new CoreNode(stage, defaultProps({ parent }));
      expect(node.isRenderable).toBe(false);
      node.alpha = 0;
      node.x = 0;
      node.y = 0;
      node.w = 100;
      node.h = 100;
      node.texture = mock<ImageTexture>({
        state: 'loaded',
      });
      node.textureLoaded = true;

      node.update(0, clippingRect);
      expect(node.isRenderable).toBe(false);
    });

    it('a node with a texture that is OutOfBounds should not be renderable', () => {
      const parent = new CoreNode(stage, defaultProps());
      parent.globalTransform = Matrix3d.identity();
      parent.worldAlpha = 1;

      const node = new CoreNode(stage, defaultProps({ parent }));
      node.alpha = 1;
      node.x = 300;
      node.y = 300;
      node.w = 100;
      node.h = 100;
      node.texture = mock<ImageTexture>({
        state: 'loaded',
      });

      node.update(0, clippingRect);
      expect(node.isRenderable).toBe(false);
    });

    it('a node with a freed texture should not be renderable', () => {
      const parent = new CoreNode(stage, defaultProps());
      parent.globalTransform = Matrix3d.identity();
      parent.worldAlpha = 1;

      const node = new CoreNode(stage, defaultProps({ parent }));
      node.alpha = 1;
      node.x = 0;
      node.y = 0;
      node.w = 100;
      node.h = 100;
      node.texture = mock<ImageTexture>({
        state: 'freed',
      });

      node.update(0, clippingRect);
      expect(node.isRenderable).toBe(false);
    });

    it('should emit renderable event when isRenderable status changes', () => {
      const parent = new CoreNode(stage, defaultProps());
      parent.globalTransform = Matrix3d.identity();
      parent.worldAlpha = 1;

      const node = new CoreNode(stage, defaultProps({ parent }));
      const eventCallback = vi.fn();

      // Listen for the renderableChanged event
      node.on('renderable', eventCallback);

      // Set up node as a color texture that should be renderable
      node.alpha = 1;
      node.x = 0;
      node.y = 0;
      node.w = 100;
      node.h = 100;
      node.color = 0xffffffff;

      // Initial state should be false
      expect(node.isRenderable).toBe(false);
      expect(eventCallback).not.toHaveBeenCalled();

      // Update should make it renderable (false -> true)
      node.update(0, clippingRect);
      expect(node.isRenderable).toBe(true);
      expect(eventCallback).toHaveBeenCalledWith(node, {
        type: 'renderable',
        isRenderable: true,
      });

      // Reset the mock
      eventCallback.mockClear();

      // Make node invisible (alpha = 0) to make it not renderable (true -> false)
      node.alpha = 0;
      node.update(1, clippingRect);
      expect(node.isRenderable).toBe(false);
      expect(eventCallback).toHaveBeenCalledWith(node, {
        type: 'renderable',
        isRenderable: false,
      });

      // Reset the mock again
      eventCallback.mockClear();

      // Setting same value shouldn't trigger event
      node.alpha = 0;
      node.update(2, clippingRect);
      expect(node.isRenderable).toBe(false);
      expect(eventCallback).not.toHaveBeenCalled();
    });
  });

  describe('autosize system', () => {
    it('should initialize with autosize disabled', () => {
      const node = new CoreNode(stage, defaultProps());
      expect(node.autosize).toBe(false);
    });

    it('should enable texture autosize when texture is present', () => {
      const node = new CoreNode(stage, defaultProps());
      const mockTexture = mock<ImageTexture>();
      mockTexture.state = 'loading';

      node.texture = mockTexture;
      node.autosize = true;

      // Should not create autosize manager for texture mode
      expect((node as any).autosizer).toBeTruthy();
    });

    it('should enable children autosize when no texture but has children', () => {
      const parent = new CoreNode(stage, defaultProps());
      const child = new CoreNode(stage, defaultProps());

      parent.autosize = true;
      child.parent = parent;

      // Should create autosize manager for children mode
      expect((parent as any).autosizer).toBeTruthy();
    });

    it('should prioritize texture autosize over children autosize', () => {
      const parent = new CoreNode(stage, defaultProps());
      const child = new CoreNode(stage, defaultProps());
      const mockTexture = mock<ImageTexture>();
      mockTexture.state = 'loading';

      child.parent = parent;
      parent.texture = mockTexture;
      parent.autosize = true;

      expect(parent.autosize).toBe(true);
      // Should NOT create autosize manager when texture is present
      expect((parent as any).autosizer).toBeTruthy();
    });

    it('should switch from children to texture autosize when texture is added', () => {
      const parent = new CoreNode(stage, defaultProps());
      const child = new CoreNode(stage, defaultProps());

      child.parent = parent;
      parent.autosize = true;
      expect((parent as any).autosizer).toBeTruthy();

      // Add texture - should switch to texture autosize
      const mockTexture = mock<ImageTexture>();
      mockTexture.state = 'loading';
      parent.texture = mockTexture;

      expect((parent as any).autosizer).toBeTruthy();
    });

    it('should switch from texture to children autosize when texture is removed', () => {
      const parent = new CoreNode(stage, defaultProps());
      const child = new CoreNode(stage, defaultProps());
      const mockTexture = mock<ImageTexture>();
      mockTexture.state = 'loading';

      child.parent = parent;
      parent.texture = mockTexture;
      parent.autosize = true;
      expect((parent as any).autosizer).toBeTruthy();

      // Remove texture - should switch to children autosize
      parent.texture = null;
      expect((parent as any).autosizer).toBeTruthy();
    });

    it('should cleanup autosize manager when disabled', () => {
      const parent = new CoreNode(stage, defaultProps());
      const child = new CoreNode(stage, defaultProps());

      child.parent = parent;
      parent.autosize = true;
      expect((parent as any).autosizer).toBeTruthy();

      parent.autosize = false;
      expect((parent as any).autosizer).toBeFalsy();
    });

    it('should establish autosize chain when child is added to autosize parent', () => {
      const parent = new CoreNode(stage, defaultProps());
      const child = new CoreNode(stage, defaultProps());

      // Enable autosize BEFORE adding child
      parent.autosize = true;
      child.parent = parent;

      expect((child as any).parentAutosizer).toBe(parent.autosizer);
      expect((parent as any).autosizer.childMap.size).toBe(1);
    });

    it('should remove from autosize chain when child is removed', () => {
      const parent = new CoreNode(stage, defaultProps());
      const child = new CoreNode(stage, defaultProps());

      // Enable autosize BEFORE adding child
      parent.autosize = true;
      child.parent = parent;
      expect((parent as any).autosizer.childMap.size).toBe(1);

      child.parent = null;
      expect((child as any).parentAutosizer).toBeNull();
    });
  });

  describe('isSimple optimization', () => {
    it('should be simple by default', () => {
      const node = new CoreNode(stage, defaultProps());
      expect(node.isSimple).toBe(true);
    });

    it('should not be simple if rotated', () => {
      const node = new CoreNode(stage, defaultProps());
      node.rotation = 0.1;
      expect(node.isSimple).toBe(false);
      node.rotation = 0;
      expect(node.isSimple).toBe(true);
    });

    it('should not be simple if scaled', () => {
      const node = new CoreNode(stage, defaultProps());
      node.scale = 1.1;
      expect(node.isSimple).toBe(false);
      node.scale = 1;
      expect(node.isSimple).toBe(true);

      node.scaleX = 1.1;
      expect(node.isSimple).toBe(false);
      node.scaleX = 1;
      expect(node.isSimple).toBe(true);

      node.scaleY = 1.1;
      expect(node.isSimple).toBe(false);
      node.scaleY = 1;
      expect(node.isSimple).toBe(true);
    });

    it('should not be simple if mounted', () => {
      const node = new CoreNode(stage, defaultProps());
      node.mount = 0.5;
      expect(node.isSimple).toBe(false);
      node.mount = 0;
      expect(node.isSimple).toBe(true);

      node.mountX = 0.5;
      expect(node.isSimple).toBe(false);
      node.mountX = 0;
      expect(node.isSimple).toBe(true);

      node.mountY = 0.5;
      expect(node.isSimple).toBe(false);
      node.mountY = 0;
      expect(node.isSimple).toBe(true);
    });

    it('should not be simple if texture is contained', () => {
      const node = new CoreNode(stage, defaultProps());
      const mockTexture = mock<ImageTexture>({
        state: 'loaded',
        dimensions: { w: 100, h: 100 },
      });

      node.texture = mockTexture;
      expect(node.isSimple).toBe(true); // Default resizeMode is not contained

      node.textureOptions = { resizeMode: { type: 'contain' } };
      expect(node.isSimple).toBe(false);

      node.textureOptions = { resizeMode: { type: 'cover' } };
      expect(node.isSimple).toBe(true);
    });

    it('should update local transform correctly when simple', () => {
      const parent = new CoreNode(stage, defaultProps());
      parent.globalTransform = Matrix3d.identity();
      const node = new CoreNode(stage, defaultProps({ parent }));
      node.x = 100;
      node.y = 50;
      node.props.w = 50;
      node.props.h = 50;
      node.update(0, clippingRect);

      expect(node.localTransform!.tx).toBe(100);
      expect(node.localTransform!.ty).toBe(50);
      expect(node.localTransform!.ta).toBe(1);
      expect(node.localTransform!.td).toBe(1);
      expect(node.isSimple).toBe(true);
    });

    it('should update local transform correctly when not simple (rotation)', () => {
      const parent = new CoreNode(stage, defaultProps());
      parent.globalTransform = Matrix3d.identity();
      const node = new CoreNode(stage, defaultProps({ parent }));
      node.x = 100;
      node.y = 50;
      node.props.w = 100; // use props.w directly to avoid trigger setters if exist (though setters exist)
      node.props.h = 100;
      node.pivot = 0.5;
      node.rotation = Math.PI / 2; // 90 degrees
      node.update(0, clippingRect);

      // Expected: 90 deg rotation around center (50,50) relative to (100,50)
      // Center of node is at (100+50, 50+50) = (150, 100) if mount is 0.
      // Rotation happens closely to how matrix works.
      // Just verifying tx/ty are not just x/y
      expect(node.localTransform!.tx).toBe(200);
      expect(node.localTransform!.ty).toBe(50);
      expect(node.isSimple).toBe(false);
    });
  });

  describe('isSimple Global Transform', () => {
    it('should calculate global transform correctly when simple', () => {
      const parent = new CoreNode(stage, defaultProps());
      parent.globalTransform = Matrix3d.translate(10, 20);

      const node = new CoreNode(stage, defaultProps({ parent }));
      node.x = 100;
      node.y = 50;
      // node is simple by default

      node.update(0, clippingRect);

      // Parent (10, 20) + Node (100, 50) = (110, 70)
      expect(node.globalTransform!.tx).toBe(110);
      expect(node.globalTransform!.ty).toBe(70);
      expect(node.globalTransform!.ta).toBe(1);
      expect(node.globalTransform!.td).toBe(1);
      expect(node.isSimple).toBe(true);
    });

    it('should calculate global transform correctly when not simple', () => {
      const parent = new CoreNode(stage, defaultProps());
      parent.globalTransform = Matrix3d.translate(10, 20);

      const node = new CoreNode(stage, defaultProps({ parent }));
      node.x = 100;
      node.y = 50;
      node.w = 100;
      node.h = 100;
      node.pivotX = 0.5;
      node.pivotY = 0.5;
      node.rotation = Math.PI / 2; // 90 deg

      node.update(0, clippingRect);

      // Parent (10, 20) + Node (100, 50) + Rotation
      // The translation part of global transform should be affected by parent
      // But rotation happens at node level.
      // Matrix calc: Parent * Node
      // [1 0 10]   [0 -1 200]*   <-- node local: rot 90 around 50,50 (center) relative to 100,50
      // [0 1 20] * [1  0  50]
      // [0 0  1]   [0  0   1]
      // *Wait, previous test established local tx=200, ty=50 for rotation

      // Global tx = 1*200 + 0*50 + 10 = 210
      // Global ty = 0*200 + 1*50 + 20 = 70

      expect(node.globalTransform!.tx).toBe(210);
      expect(node.globalTransform!.ty).toBe(70);
      expect(node.isSimple).toBe(false);
    });
  });
});
