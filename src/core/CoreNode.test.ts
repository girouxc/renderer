import { describe, expect, it, vi } from 'vitest';
import { CoreNode, type CoreNodeProps, UpdateType } from './CoreNode.js';
import { Stage } from './Stage.js';
import { CoreRenderer } from './renderers/CoreRenderer.js';
import { mock } from 'vitest-mock-extended';
import { type TextureOptions } from './CoreTextureManager.js';
import { createBound } from './lib/utils.js';
import { ImageTexture } from './textures/ImageTexture.js';
import { Matrix3d } from './lib/Matrix3d.js';
import { EventEmitter } from '../common/EventEmitter.js';
import { premultiplyColorABGR } from '../utils.js';

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
    placeholderColor: 0,
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

  describe('simple-path localTransform writes', () => {
    it('reuses the same Matrix3d instance across x/y updates', () => {
      const parent = new CoreNode(stage, defaultProps());
      parent.globalTransform = Matrix3d.identity();
      const node = new CoreNode(stage, defaultProps({ parent }));

      node.x = 10;
      node.y = 20;
      node.update(0, clippingRect);
      const lt = node.localTransform!;
      expect(lt.tx).toBe(10);
      expect(lt.ty).toBe(20);

      node.x = 100;
      node.y = 200;
      node.update(1, clippingRect);
      // Same instance — no realloc per frame.
      expect(node.localTransform).toBe(lt);
      expect(lt.tx).toBe(100);
      expect(lt.ty).toBe(200);
      // Identity-shape preserved.
      expect(lt.ta).toBe(1);
      expect(lt.tb).toBe(0);
      expect(lt.tc).toBe(0);
      expect(lt.td).toBe(1);
      expect(node._localIsTranslate).toBe(true);
    });

    it('resets ta/tb/tc/td when transitioning non-simple -> simple', () => {
      const parent = new CoreNode(stage, defaultProps());
      parent.globalTransform = Matrix3d.identity();
      const node = new CoreNode(stage, defaultProps({ parent }));
      node.props.w = 100;
      node.props.h = 100;
      node.pivot = 0.5;

      // First, become non-simple via rotation — local matrix gets non-identity ta/tb/tc/td.
      node.x = 50;
      node.y = 50;
      node.rotation = Math.PI / 2;
      node.update(0, clippingRect);
      expect(node._localIsTranslate).toBe(false);
      const lt = node.localTransform!;
      // Sanity: matrix is no longer in identity-shape
      expect(lt.ta === 1 && lt.tb === 0 && lt.tc === 0 && lt.td === 1).toBe(
        false,
      );

      // Clear rotation — now simple again.
      node.rotation = 0;
      node.x = 5;
      node.y = 7;
      node.update(1, clippingRect);

      // Matrix must be restored to identity-shape, NOT carrying stale rotation.
      expect(node.localTransform).toBe(lt);
      expect(lt.ta).toBe(1);
      expect(lt.tb).toBe(0);
      expect(lt.tc).toBe(0);
      expect(lt.td).toBe(1);
      expect(node._localIsTranslate).toBe(true);
    });
  });

  describe('translate-only global fast path', () => {
    it('produces the same global translate as parent + local for simple chains', () => {
      const parent = new CoreNode(stage, defaultProps());
      parent.globalTransform = Matrix3d.translate(30, 40);
      // parent is set up by the test as translate-only.
      parent._globalIsTranslate = true;

      const node = new CoreNode(stage, defaultProps({ parent }));
      node.x = 5;
      node.y = 7;
      node.update(0, clippingRect);

      expect(node.globalTransform!.tx).toBe(35);
      expect(node.globalTransform!.ty).toBe(47);
      expect(node.globalTransform!.ta).toBe(1);
      expect(node.globalTransform!.tb).toBe(0);
      expect(node.globalTransform!.tc).toBe(0);
      expect(node.globalTransform!.td).toBe(1);
      expect(node._globalIsTranslate).toBe(true);
    });

    it('propagates _globalIsTranslate through grandchildren', () => {
      const root = new CoreNode(stage, defaultProps());
      root.globalTransform = Matrix3d.identity();
      root._globalIsTranslate = true;

      const mid = new CoreNode(stage, defaultProps({ parent: root }));
      mid.x = 10;
      mid.y = 20;
      mid.update(0, clippingRect);
      expect(mid._globalIsTranslate).toBe(true);

      const leaf = new CoreNode(stage, defaultProps({ parent: mid }));
      leaf.x = 3;
      leaf.y = 4;
      leaf.update(0, clippingRect);
      expect(leaf._globalIsTranslate).toBe(true);
      expect(leaf.globalTransform!.tx).toBe(13);
      expect(leaf.globalTransform!.ty).toBe(24);
    });

    it('does not take the fast path when parent is not translate-only', () => {
      const parent = new CoreNode(stage, defaultProps());
      // Parent global has a rotation baked in.
      parent.globalTransform = Matrix3d.rotate(Math.PI / 2);
      parent._globalIsTranslate = false;

      const node = new CoreNode(stage, defaultProps({ parent }));
      node.x = 10;
      node.y = 0;
      node.update(0, clippingRect);
      // Child is simple itself but parent has rotation, so the resulting
      // global cannot be translate-only.
      expect(node._globalIsTranslate).toBe(false);
    });

    it('clears _globalIsTranslate when the node becomes non-simple', () => {
      const parent = new CoreNode(stage, defaultProps());
      parent.globalTransform = Matrix3d.identity();
      parent._globalIsTranslate = true;

      const node = new CoreNode(stage, defaultProps({ parent }));
      node.props.w = 100;
      node.props.h = 100;
      node.x = 10;
      node.y = 20;
      node.update(0, clippingRect);
      expect(node._globalIsTranslate).toBe(true);

      // Add rotation -> non-simple -> global is no longer translate-only.
      node.pivot = 0.5;
      node.rotation = Math.PI / 4;
      node.update(1, clippingRect);
      expect(node._globalIsTranslate).toBe(false);
    });

    it('restores identity-shape on globalTransform when re-entering the fast path', () => {
      const parent = new CoreNode(stage, defaultProps());
      parent.globalTransform = Matrix3d.identity();
      parent._globalIsTranslate = true;

      const node = new CoreNode(stage, defaultProps({ parent }));
      node.props.w = 100;
      node.props.h = 100;
      node.pivot = 0.5;
      node.x = 10;
      node.y = 20;
      node.rotation = Math.PI / 2;
      node.update(0, clippingRect);
      expect(node._globalIsTranslate).toBe(false);
      const gt = node.globalTransform!;
      // sanity: rotation baked into the global
      expect(gt.ta === 1 && gt.tb === 0 && gt.tc === 0 && gt.td === 1).toBe(
        false,
      );

      // Remove rotation -> simple again -> fast path applies, must reset ta/tb/tc/td.
      node.rotation = 0;
      node.x = 5;
      node.y = 6;
      node.update(1, clippingRect);

      expect(node._globalIsTranslate).toBe(true);
      expect(node.globalTransform).toBe(gt);
      expect(gt.ta).toBe(1);
      expect(gt.tb).toBe(0);
      expect(gt.tc).toBe(0);
      expect(gt.td).toBe(1);
      expect(gt.tx).toBe(5);
      expect(gt.ty).toBe(6);
    });
  });

  describe('updateBoundingRect axis-alignment check', () => {
    it('uses 4-corner bounds when one shear component is non-zero', () => {
      // Without the && fix, the axis-aligned branch fires whenever EITHER
      // tb or tc is 0, which produces wrong bounds for matrices with
      // a single non-zero shear and a sign that places corners outside
      // the (x1,y1)–(x3,y3) diagonal.
      const parent = new CoreNode(stage, defaultProps());
      parent.globalTransform = Matrix3d.identity();
      const node = new CoreNode(stage, defaultProps({ parent }));
      node.props.w = 100;
      node.props.h = 100;
      node.update(0, clippingRect);

      const gt = node.globalTransform!;
      gt.ta = 1;
      gt.tb = 0;
      gt.tc = -0.5;
      gt.td = 1;
      gt.tx = 0;
      gt.ty = 100;

      node.calculateRenderCoords();
      node.updateBoundingRect();

      // Corners with the above matrix:
      //  TL (0, 100), TR (100, 50), BR (100, 150), BL (0, 200)
      // Correct bounds: x in [0, 100], y in [50, 200].
      // Axis-aligned diagonal would yield y in [100, 150] — wrong.
      const rb = node.renderBound!;
      expect(rb.x1).toBe(0);
      expect(rb.x2).toBe(100);
      expect(rb.y1).toBe(50);
      expect(rb.y2).toBe(200);
    });

    it('still uses the diagonal bounds when both shear components are zero', () => {
      const parent = new CoreNode(stage, defaultProps());
      parent.globalTransform = Matrix3d.identity();
      const node = new CoreNode(stage, defaultProps({ parent }));
      node.props.w = 100;
      node.props.h = 100;
      node.x = 10;
      node.y = 20;
      node.update(0, clippingRect);

      const rb = node.renderBound!;
      expect(rb.x1).toBe(10);
      expect(rb.y1).toBe(20);
      expect(rb.x2).toBe(110);
      expect(rb.y2).toBe(120);
    });
  });

  describe('updateLocalTransform scale-only fast path', () => {
    it('produces correct ta/td without touching tb/tc for scale-only nodes', () => {
      const parent = new CoreNode(stage, defaultProps());
      parent.globalTransform = Matrix3d.identity();
      const node = new CoreNode(stage, defaultProps({ parent }));
      node.x = 10;
      node.y = 20;
      node.props.w = 100;
      node.props.h = 100;
      node.scaleX = 2;
      node.scaleY = 3;

      node.update(0, clippingRect);

      const lt = node.localTransform!;
      expect(lt.ta).toBe(2);
      expect(lt.tb).toBe(0);
      expect(lt.tc).toBe(0);
      expect(lt.td).toBe(3);
      // No pivot configured -> translation is just (x - mountTranslate)
      expect(lt.tx).toBe(10);
      expect(lt.ty).toBe(20);
    });

    it('applies pivot correctly under scale (no rotation)', () => {
      const parent = new CoreNode(stage, defaultProps());
      parent.globalTransform = Matrix3d.identity();
      const node = new CoreNode(stage, defaultProps({ parent }));
      node.props.w = 100;
      node.props.h = 100;
      node.x = 0;
      node.y = 0;
      node.pivot = 0.5;
      node.scaleX = 2;
      node.scaleY = 2;

      node.update(0, clippingRect);

      // Algebraically: pivot scaling around the center.
      //   tx = x - mountX*w + pivotX*w*(1 - sx)
      //      = 0 - 0       + 50*(1-2) = -50
      //   ty similarly = -50
      const lt = node.localTransform!;
      expect(lt.ta).toBe(2);
      expect(lt.tb).toBe(0);
      expect(lt.tc).toBe(0);
      expect(lt.td).toBe(2);
      expect(lt.tx).toBe(-50);
      expect(lt.ty).toBe(-50);
    });
  });

  describe('eagerly-allocated transforms (Fix 6)', () => {
    it('allocates localTransform and globalTransform on construction', () => {
      const node = new CoreNode(stage, defaultProps());
      expect(node.localTransform).toBeInstanceOf(Matrix3d);
      expect(node.globalTransform).toBeInstanceOf(Matrix3d);
    });

    it('initial matrices are in identity-shape', () => {
      const node = new CoreNode(stage, defaultProps());
      const lt = node.localTransform!;
      const gt = node.globalTransform!;
      expect(lt.ta).toBe(1);
      expect(lt.tb).toBe(0);
      expect(lt.tc).toBe(0);
      expect(lt.td).toBe(1);
      expect(gt.ta).toBe(1);
      expect(gt.tb).toBe(0);
      expect(gt.tc).toBe(0);
      expect(gt.td).toBe(1);
    });

    it('reuses the same globalTransform instance across updates', () => {
      const parent = new CoreNode(stage, defaultProps());
      parent.globalTransform = Matrix3d.translate(0, 0);
      parent._globalIsTranslate = true;
      const node = new CoreNode(stage, defaultProps({ parent }));
      const gtBefore = node.globalTransform!;

      node.x = 10;
      node.y = 20;
      node.update(0, clippingRect);
      expect(node.globalTransform).toBe(gtBefore);

      node.x = 100;
      node.update(1, clippingRect);
      expect(node.globalTransform).toBe(gtBefore);

      // And after going into non-simple territory the same instance is still
      // mutated in place rather than reallocated.
      node.props.w = 100;
      node.props.h = 100;
      node.pivot = 0.5;
      node.rotation = Math.PI / 2;
      node.update(2, clippingRect);
      expect(node.globalTransform).toBe(gtBefore);
    });

    it('_localIsTranslate defaults to true so the first update can take the fast path', () => {
      const node = new CoreNode(stage, defaultProps());
      expect(node._localIsTranslate).toBe(true);
    });
  });

  describe('cached _hasContainResize (Fix 4)', () => {
    it('starts as false on a fresh node', () => {
      const node = new CoreNode(stage, defaultProps());
      expect(node._hasContainResize).toBe(false);
    });

    it('flips to true when both texture and contain resizeMode are set', () => {
      const node = new CoreNode(stage, defaultProps());
      const tex = mock<ImageTexture>({ state: 'loaded' });
      node.texture = tex;
      expect(node._hasContainResize).toBe(false);

      node.textureOptions = { resizeMode: { type: 'contain' } };
      expect(node._hasContainResize).toBe(true);
    });

    it('flips back to false when texture is cleared or resizeMode changes', () => {
      const node = new CoreNode(stage, defaultProps());
      const tex = mock<ImageTexture>({ state: 'loaded' });
      node.texture = tex;
      node.textureOptions = { resizeMode: { type: 'contain' } };
      expect(node._hasContainResize).toBe(true);

      node.textureOptions = { resizeMode: { type: 'cover' } };
      expect(node._hasContainResize).toBe(false);

      node.textureOptions = { resizeMode: { type: 'contain' } };
      expect(node._hasContainResize).toBe(true);

      node.texture = null;
      expect(node._hasContainResize).toBe(false);
    });
  });

  describe('children update loop branches', () => {
    it('inherited childUpdateType is applied even to children with updateType=0', () => {
      const root = new CoreNode(stage, defaultProps());
      root.globalTransform = Matrix3d.identity();
      root.worldAlpha = 1;

      const parent = new CoreNode(stage, defaultProps({ parent: root }));
      parent.alpha = 1;
      parent.w = 100;
      parent.h = 100;

      const child = new CoreNode(stage, defaultProps({ parent }));
      child.alpha = 1;
      child.w = 100;
      child.h = 100;

      // Bring both to steady state then clear pending work on the child.
      parent.update(0, clippingRect);
      child.updateType = 0;

      // Mark parent dirty with WorldAlpha — it should cascade into the
      // child via the `childUpdateType !== 0` loop branch, even though
      // the child started this frame with no pending work.
      parent.alpha = 0.5;
      parent.update(1, clippingRect);

      expect(child.worldAlpha).toBeCloseTo(0.5, 5);
    });

    it('skips children with no pending work when there is nothing to inherit', () => {
      const root = new CoreNode(stage, defaultProps());
      root.globalTransform = Matrix3d.identity();
      root.worldAlpha = 1;

      const parent = new CoreNode(stage, defaultProps({ parent: root }));
      parent.alpha = 1;
      parent.w = 100;
      parent.h = 100;

      const childA = new CoreNode(stage, defaultProps({ parent }));
      childA.alpha = 1;
      childA.w = 100;
      childA.h = 100;
      const childB = new CoreNode(stage, defaultProps({ parent }));
      childB.alpha = 1;
      childB.w = 100;
      childB.h = 100;

      parent.update(0, clippingRect);
      childA.updateType = 0;
      childB.updateType = 0;

      // Mark only childB dirty. Force parent into the Children branch
      // without seeding any inherited bits, so the loop should take the
      // `childUpdateType === 0` branch and only walk dirty children.
      childB.setUpdateType(UpdateType.Local);
      parent.updateType |= UpdateType.Children;
      parent.childUpdateType = 0;

      const spyA = vi.spyOn(childA, 'update');
      const spyB = vi.spyOn(childB, 'update');

      parent.update(1, clippingRect);

      expect(spyA).not.toHaveBeenCalled();
      expect(spyB).toHaveBeenCalledTimes(1);
    });
  });

  describe('clipping property', () => {
    it('defaults to false', () => {
      const node = new CoreNode(stage, defaultProps());
      expect(node.clipping).toBe(false);
    });

    it('accepts boolean true via setter', () => {
      const node = new CoreNode(stage, defaultProps());
      node.clipping = true;
      expect(node.clipping).toBe(true);
      expect(node.props.clipping).toBe(true);
    });

    it('stores a [top, right, bottom, left] tuple as-is', () => {
      const node = new CoreNode(stage, defaultProps());
      const tuple: [number, number, number, number] = [10, 20, 30, 40];
      node.clipping = tuple;
      expect(node.props.clipping).toBe(tuple);
      expect(node.clipping).toBe(tuple);
    });

    it('accepts negative margins (insets the clip rect)', () => {
      const node = new CoreNode(stage, defaultProps());
      node.clipping = [-5, -5, -5, -5];
      expect(node.clipping).toEqual([-5, -5, -5, -5]);
    });

    it('clears margins when reassigned to a plain boolean', () => {
      const node = new CoreNode(stage, defaultProps());
      node.clipping = [10, 20, 30, 40];
      node.clipping = true;
      expect(node.clipping).toBe(true);
      node.clipping = false;
      expect(node.clipping).toBe(false);
    });

    it('short-circuits redundant writes of the same reference', () => {
      const node = new CoreNode(stage, defaultProps());
      const tuple: [number, number, number, number] = [10, 20, 30, 40];
      node.clipping = tuple;
      node.updateType = 0;
      node.clipping = tuple;
      expect(node.updateType).toBe(0);
    });

    it('schedules clipping + render-bounds updates when value changes', () => {
      const node = new CoreNode(stage, defaultProps());
      node.updateType = 0;
      node.clipping = [10, 20, 30, 40];
      expect(node.updateType & UpdateType.Clipping).toBeTruthy();
      expect(node.updateType & UpdateType.RenderBounds).toBeTruthy();
    });

    it('expands the clipping rect outward by the configured margins', () => {
      const parent = new CoreNode(stage, defaultProps());
      parent.globalTransform = Matrix3d.identity();
      parent.worldAlpha = 1;

      const node = new CoreNode(stage, defaultProps({ parent }));
      node.alpha = 1;
      node.x = 100;
      node.y = 100;
      node.w = 50;
      node.h = 50;
      node.clipping = [10, 20, 30, 40];

      node.update(0, { x: 0, y: 0, w: 1000, h: 1000, valid: true });

      // Expected: x = 100 - 40 = 60, y = 100 - 10 = 90,
      //           w = 50 + 40 + 20 = 110, h = 50 + 10 + 30 = 90
      expect(node.clippingRect.valid).toBe(true);
      expect(node.clippingRect.x).toBe(60);
      expect(node.clippingRect.y).toBe(90);
      expect(node.clippingRect.w).toBe(110);
      expect(node.clippingRect.h).toBe(90);
    });

    it('produces the unmodified node rect when clipping = true with no margins', () => {
      const parent = new CoreNode(stage, defaultProps());
      parent.globalTransform = Matrix3d.identity();
      parent.worldAlpha = 1;

      const node = new CoreNode(stage, defaultProps({ parent }));
      node.alpha = 1;
      node.x = 25;
      node.y = 35;
      node.w = 50;
      node.h = 60;
      node.clipping = true;

      node.update(0, { x: 0, y: 0, w: 1000, h: 1000, valid: true });

      expect(node.clippingRect.x).toBe(25);
      expect(node.clippingRect.y).toBe(35);
      expect(node.clippingRect.w).toBe(50);
      expect(node.clippingRect.h).toBe(60);
    });

    it('still intersects with parent clipping rect when margins push beyond it', () => {
      const parent = new CoreNode(stage, defaultProps());
      parent.globalTransform = Matrix3d.identity();
      parent.worldAlpha = 1;

      const node = new CoreNode(stage, defaultProps({ parent }));
      node.alpha = 1;
      node.x = 100;
      node.y = 100;
      node.w = 50;
      node.h = 50;
      // Margins try to extend the clip past the parent bounds:
      node.clipping = [100, 100, 100, 100];

      // Parent clip limits us to (0,0,200,200).
      node.update(0, { x: 0, y: 0, w: 200, h: 200, valid: true });

      expect(node.clippingRect.valid).toBe(true);
      expect(node.clippingRect.x).toBe(0);
      expect(node.clippingRect.y).toBe(0);
      expect(node.clippingRect.w).toBe(200);
      expect(node.clippingRect.h).toBe(200);
    });

    it('does not produce its own clip rect when the node is rotated, even with margins', () => {
      const parent = new CoreNode(stage, defaultProps());
      parent.globalTransform = Matrix3d.identity();
      parent.worldAlpha = 1;

      const node = new CoreNode(stage, defaultProps({ parent }));
      node.alpha = 1;
      node.x = 100;
      node.y = 100;
      node.w = 50;
      node.h = 50;
      node.clipping = [10, 10, 10, 10];
      node.rotation = Math.PI / 4;

      // No parent clip rect to inherit — rotated nodes must skip their own clip.
      node.update(0, { x: 0, y: 0, w: 0, h: 0, valid: false });

      expect(node.clippingRect.valid).toBe(false);
    });

    it('shares the invalid default rect when neither node nor ancestor clips', () => {
      const parent = new CoreNode(stage, defaultProps());
      parent.globalTransform = Matrix3d.identity();
      parent.worldAlpha = 1;

      const node = new CoreNode(stage, defaultProps({ parent }));
      node.alpha = 1;
      node.setUpdateType(UpdateType.Clipping);

      node.update(0, { x: 0, y: 0, w: 0, h: 0, valid: false });

      // No own allocation: the field still points at the shared default that
      // every freshly-constructed node starts with.
      const fresh = new CoreNode(stage, defaultProps());
      expect(node.clippingRect).toBe(fresh.clippingRect);
      expect(node.clippingRect.valid).toBe(false);
    });

    it('never mutates the shared default when a sibling node clips', () => {
      const clipParent = new CoreNode(stage, defaultProps());
      clipParent.globalTransform = Matrix3d.identity();
      clipParent.worldAlpha = 1;

      const clippingNode = new CoreNode(
        stage,
        defaultProps({ parent: clipParent }),
      );
      clippingNode.worldAlpha = 1;
      clippingNode.alpha = 1;
      clippingNode.x = 10;
      clippingNode.y = 20;
      clippingNode.w = 30;
      clippingNode.h = 40;
      clippingNode.clipping = true;
      clippingNode.update(0, { x: 0, y: 0, w: 1000, h: 1000, valid: true });

      // A separate non-clipping node must still see a pristine invalid default.
      const plain = new CoreNode(stage, defaultProps());
      expect(plain.clippingRect.valid).toBe(false);
      expect(plain.clippingRect.x).toBe(0);
      expect(plain.clippingRect.y).toBe(0);
      expect(plain.clippingRect.w).toBe(0);
      expect(plain.clippingRect.h).toBe(0);
    });

    it('allocates its own rect to inherit a valid ancestor clip rect', () => {
      const parent = new CoreNode(stage, defaultProps());
      parent.globalTransform = Matrix3d.identity();
      parent.worldAlpha = 1;

      const node = new CoreNode(stage, defaultProps({ parent }));
      node.alpha = 1;
      node.setUpdateType(UpdateType.Clipping);

      const fresh = new CoreNode(stage, defaultProps());
      node.update(0, { x: 5, y: 6, w: 20, h: 30, valid: true });

      // Now owns a private rect carrying the parent's clip values.
      expect(node.clippingRect).not.toBe(fresh.clippingRect);
      expect(node.clippingRect.valid).toBe(true);
      expect(node.clippingRect.x).toBe(5);
      expect(node.clippingRect.y).toBe(6);
      expect(node.clippingRect.w).toBe(20);
      expect(node.clippingRect.h).toBe(30);
    });
  });

  describe('RecalcUniforms scoping', () => {
    const makeAttachedNode = () => {
      // Fresh stage per node: earlier tests can mutate the shared stage
      // mock's bound objects through by-reference strictBound assignment
      // in createRenderBounds.
      const localStage = mock<Stage>({
        strictBound: createBound(0, 0, 200, 200),
        preloadBound: createBound(0, 0, 200, 200),
        defaultTexture: {
          state: 'loaded',
        },
        renderer: mock<CoreRenderer>() as CoreRenderer,
      });
      const parent = new CoreNode(localStage, defaultProps());
      parent.globalTransform = Matrix3d.identity();
      parent.worldAlpha = 1;

      const node = new CoreNode(
        localStage,
        defaultProps({ parent, w: 100, h: 100 }),
      );
      node.alpha = 1;
      return node;
    };

    it('should not set RecalcUniforms on pure translation', () => {
      const node = makeAttachedNode();
      node.update(0, clippingRect);

      node.x = 50;
      node.y = 25;

      expect(node.updateType & UpdateType.Local).toBe(UpdateType.Local);
      expect(node.updateType & UpdateType.RecalcUniforms).toBe(0);
    });

    it('should set RecalcUniforms when w changes', () => {
      const node = makeAttachedNode();
      node.update(0, clippingRect);

      node.w = 150;

      expect(node.updateType & UpdateType.RecalcUniforms).toBe(
        UpdateType.RecalcUniforms,
      );
    });

    it('should set RecalcUniforms when h changes', () => {
      const node = makeAttachedNode();
      node.update(0, clippingRect);

      node.h = 75;

      expect(node.updateType & UpdateType.RecalcUniforms).toBe(
        UpdateType.RecalcUniforms,
      );
    });

    it('should run the shader updater on resize but not on translation', () => {
      const node = makeAttachedNode();
      const shader = {
        shaderKey: 'test',
        update: vi.fn(),
        attachNode: vi.fn(),
        time: undefined,
      };
      // Assignment raises RecalcUniforms | IsRenderable via the setter
      node.shader = shader as never;
      node.update(0, clippingRect);
      expect(shader.update).toHaveBeenCalledTimes(1);

      // Pure translation: no uniform recompute
      node.x = 50;
      node.update(0, clippingRect);
      expect(shader.update).toHaveBeenCalledTimes(1);

      // Resize: uniforms depend on dimensions, must recompute
      node.w = 150;
      node.update(0, clippingRect);
      expect(shader.update).toHaveBeenCalledTimes(2);
    });
  });

  describe('placeholderColor', () => {
    // A texture fake on a real EventEmitter so CoreNode's loadTextureTask
    // subscribes for real and we can drive the loaded/freed/failed handler
    // chain by emitting, like the engine does.
    function emittingTexture(state: string): ImageTexture & {
      emit: (event: string, data?: unknown) => void;
    } {
      return Object.assign(new EventEmitter(), {
        state,
        preventCleanup: false,
        retryCount: 0,
        maxRetryCount: 1,
        dimensions: { w: 100, h: 100 },
        setRenderableOwner: vi.fn(),
      }) as unknown as ImageTexture & {
        emit: (event: string, data?: unknown) => void;
      };
    }

    function visibleNode(): CoreNode {
      const parent = new CoreNode(stage, defaultProps());
      parent.globalTransform = Matrix3d.identity();
      parent.worldAlpha = 1;

      const node = new CoreNode(stage, defaultProps({ parent }));
      node.alpha = 1;
      node.x = 0;
      node.y = 0;
      node.w = 100;
      node.h = 100;
      return node;
    }

    // Flush the queueMicrotask(loadTextureTask) so listeners attach.
    const flushMicrotasks = () => Promise.resolve();

    it('renders the placeholder while the texture is loading', () => {
      const node = visibleNode();
      node.placeholderColor = 0x336699ff;
      node.texture = emittingTexture('initial');

      node.update(0, clippingRect);

      expect(node.placeholderActive).toBe(true);
      expect(node.isRenderable).toBe(true);
      expect(node.renderTexture).toBe(stage.defaultTexture);

      const expected = premultiplyColorABGR(0x336699ff, 1);
      expect(node.premultipliedColorTl).toBe(expected);
      expect(node.premultipliedColorTr).toBe(expected);
      expect(node.premultipliedColorBl).toBe(expected);
      expect(node.premultipliedColorBr).toBe(expected);
    });

    it('is inactive without a placeholderColor (loading renders nothing)', () => {
      const node = visibleNode();
      node.texture = emittingTexture('initial');

      node.update(0, clippingRect);

      expect(node.placeholderActive).toBe(false);
      expect(node.isRenderable).toBe(false);
    });

    it('is inactive without a texture (color-only nodes are unaffected)', () => {
      const node = visibleNode();
      node.placeholderColor = 0x336699ff;

      node.update(0, clippingRect);

      expect(node.placeholderActive).toBe(false);
    });

    it('switches to the texture and regular colors once loaded', async () => {
      const node = visibleNode();
      node.color = 0xffffffff;
      node.placeholderColor = 0x336699ff;
      const texture = emittingTexture('initial');
      node.texture = texture;
      node.update(0, clippingRect);
      expect(node.renderTexture).toBe(stage.defaultTexture);

      await flushMicrotasks();
      (texture as { state: string }).state = 'loaded';
      texture.emit('loaded', { w: 100, h: 100 });
      node.isQuadDirty = false;
      node.update(1, clippingRect);

      expect(node.placeholderActive).toBe(false);
      expect(node.isRenderable).toBe(true);
      expect(node.renderTexture).toBe(texture);
      expect(node.premultipliedColorTl).toBe(
        premultiplyColorABGR(0xffffffff, 1),
      );
      // The color switch must reach the GPU quad buffer
      expect(node.isQuadDirty).toBe(true);
    });

    it('shows the placeholder again while a freed texture reloads', async () => {
      const node = visibleNode();
      node.placeholderColor = 0x336699ff;
      const texture = emittingTexture('initial');
      node.texture = texture;
      node.update(0, clippingRect);

      await flushMicrotasks();
      (texture as { state: string }).state = 'loaded';
      texture.emit('loaded', { w: 100, h: 100 });
      node.update(1, clippingRect);
      expect(node.placeholderActive).toBe(false);

      (texture as { state: string }).state = 'freed';
      texture.emit('freed');
      node.update(2, clippingRect);

      expect(node.placeholderActive).toBe(true);
      expect(node.isRenderable).toBe(true);
      expect(node.renderTexture).toBe(stage.defaultTexture);
      expect(node.premultipliedColorTl).toBe(
        premultiplyColorABGR(0x336699ff, 1),
      );
    });

    it('keeps the placeholder when the texture permanently fails', async () => {
      const node = visibleNode();
      node.placeholderColor = 0x336699ff;
      const texture = emittingTexture('initial');
      node.texture = texture;
      node.update(0, clippingRect);

      await flushMicrotasks();
      (texture as { state: string }).state = 'failed';
      (texture as { retryCount: number }).retryCount = 2; // > maxRetryCount (1)
      texture.emit('failed', new Error('404'));
      node.update(1, clippingRect);

      expect(node.placeholderActive).toBe(true);
      expect(node.isRenderable).toBe(true);
      expect(node.renderTexture).toBe(stage.defaultTexture);
    });

    it('a permanently failed texture without a placeholder stays non-renderable', async () => {
      const node = visibleNode();
      const texture = emittingTexture('initial');
      node.texture = texture;
      node.update(0, clippingRect);

      await flushMicrotasks();
      (texture as { state: string }).state = 'failed';
      (texture as { retryCount: number }).retryCount = 2;
      texture.emit('failed', new Error('404'));
      node.update(1, clippingRect);

      expect(node.isRenderable).toBe(false);
    });

    it('deactivates when placeholderColor is cleared while loading', () => {
      const node = visibleNode();
      node.placeholderColor = 0x336699ff;
      node.texture = emittingTexture('initial');
      node.update(0, clippingRect);
      expect(node.isRenderable).toBe(true);

      node.placeholderColor = 0;
      node.update(1, clippingRect);

      expect(node.placeholderActive).toBe(false);
      expect(node.isRenderable).toBe(false);
    });

    it('updates the shown color when placeholderColor changes while active', () => {
      const node = visibleNode();
      node.placeholderColor = 0x336699ff;
      node.texture = emittingTexture('initial');
      node.update(0, clippingRect);

      node.placeholderColor = 0x993311ff;
      node.update(1, clippingRect);

      expect(node.premultipliedColorTl).toBe(
        premultiplyColorABGR(0x993311ff, 1),
      );
    });

    it('does not activate when the assigned texture is already loaded', () => {
      const node = visibleNode();
      node.placeholderColor = 0x336699ff;
      const texture = emittingTexture('loaded');
      node.texture = texture;

      node.update(0, clippingRect);

      expect(node.placeholderActive).toBe(false);
      expect(node.renderTexture).toBe(texture);
    });
  });
});
