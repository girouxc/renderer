import type { ExampleSettings } from '../common/ExampleSettings.js';

export async function automation(settings: ExampleSettings) {
  await test(settings);
  await settings.snapshot();
}

export default async function test({ renderer, testRoot }: ExampleSettings) {
  // Checkerboard background so partial transparency is visible
  const tile = 100;
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 13; col++) {
      renderer.createNode({
        x: col * tile,
        y: row * tile,
        w: tile,
        h: tile,
        color: (row + col) % 2 === 0 ? 0x113355ff : 0xddaa33ff,
        parent: testRoot,
      });
    }
  }

  // 1. Parent at alpha 0.4: normal child fades with it,
  //    ignoreParentAlpha child renders at its own alpha (1)
  const fadedParent = renderer.createNode({
    x: 40,
    y: 40,
    w: 560,
    h: 200,
    alpha: 0.4,
    parent: testRoot,
  });
  renderer.createNode({
    x: 0,
    y: 0,
    w: 260,
    h: 200,
    color: 0xff0000ff,
    parent: fadedParent,
  });
  renderer.createNode({
    x: 300,
    y: 0,
    w: 260,
    h: 200,
    color: 0xff0000ff,
    ignoreParentAlpha: true,
    parent: fadedParent,
  });

  // 2. Parent at alpha 0.05: normal child is nearly invisible,
  //    ignoreParentAlpha child remains fully visible. (At alpha exactly 0
  //    the whole subtree is culled from rendering, by design.)
  const invisibleParent = renderer.createNode({
    x: 700,
    y: 40,
    w: 560,
    h: 200,
    alpha: 0.05,
    parent: testRoot,
  });
  renderer.createNode({
    x: 0,
    y: 0,
    w: 260,
    h: 200,
    color: 0x00ff00ff,
    parent: invisibleParent,
  });
  renderer.createNode({
    x: 300,
    y: 0,
    w: 260,
    h: 200,
    color: 0x00ff00ff,
    ignoreParentAlpha: true,
    parent: invisibleParent,
  });

  // 3. The ignoring node's own alpha still applies (0.5), and its
  //    descendants inherit its world alpha as usual (0.5 * 0.5 = 0.25)
  const fadedParent2 = renderer.createNode({
    x: 40,
    y: 320,
    w: 560,
    h: 200,
    alpha: 0.1,
    parent: testRoot,
  });
  const halfAlphaChild = renderer.createNode({
    x: 0,
    y: 0,
    w: 260,
    h: 200,
    color: 0x0000ffff,
    alpha: 0.5,
    ignoreParentAlpha: true,
    parent: fadedParent2,
  });
  renderer.createNode({
    x: 300,
    y: 0,
    w: 260,
    h: 200,
    color: 0x0000ffff,
    alpha: 0.5,
    parent: halfAlphaChild,
  });

  // 4. Text node child: ignoreParentAlpha keeps text readable while the
  //    parent fades
  const textParent = renderer.createNode({
    x: 700,
    y: 320,
    w: 560,
    h: 200,
    alpha: 0.1,
    parent: testRoot,
  });
  renderer.createTextNode({
    x: 0,
    y: 0,
    text: 'Faded with parent',
    fontFamily: 'Ubuntu',
    fontSize: 40,
    color: 0x000000ff,
    parent: textParent,
  });
  renderer.createTextNode({
    x: 0,
    y: 80,
    text: 'ignoreParentAlpha',
    fontFamily: 'Ubuntu',
    fontSize: 40,
    color: 0x000000ff,
    ignoreParentAlpha: true,
    parent: textParent,
  });

  // 5. Toggling back off behaves like a normal child again
  const toggledParent = renderer.createNode({
    x: 40,
    y: 600,
    w: 560,
    h: 200,
    alpha: 0.4,
    parent: testRoot,
  });
  const toggled = renderer.createNode({
    x: 0,
    y: 0,
    w: 260,
    h: 200,
    color: 0xff00ffff,
    ignoreParentAlpha: true,
    parent: toggledParent,
  });
  toggled.ignoreParentAlpha = false;
}
