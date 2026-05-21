import { type INode } from '@lightningjs/renderer';
import logo from '../assets/lightning.png';
import type { ExampleSettings } from '../common/ExampleSettings.js';

export async function automation(settings: ExampleSettings) {
  const destroy = await test(settings);
  await settings.snapshot();
  destroy(120);
  await settings.snapshot();
}

export default async function test({
  renderer,
  testRoot,
  automation,
}: ExampleSettings) {
  // create 100 nodes
  const numOuterNodes = 190;
  const nodes: INode[] = [];

  const bg = renderer.createNode({
    y: 80,
    w: 1920,
    h: 1000,
    color: 0xff1e293b,
    parent: testRoot,
  });

  const quadsNode = renderer.createTextNode({
    fontFamily: 'Ubuntu',
    fontSize: 40,
    x: 20,
    y: 20,
    parent: testRoot,
    text: 'Number of Quads Rendered: ',
  });

  renderer.on('renderUpdate', (target, payload) => {
    quadsNode.text = `Number of Quads Rendered: ${payload.quads}`;
  });

  const create = async (nodes: INode[] = [], delay = 0) => {
    const gridSize = Math.floor(Math.sqrt(numOuterNodes));

    for (let i = 0; i < numOuterNodes; i++) {
      const baseX = (i % gridSize) * 150;
      const baseY = Math.floor(i / gridSize) * 60;

      if (automation === false)
        await new Promise((resolve) => setTimeout(resolve, delay));
      const node = renderer.createNode({
        w: 125,
        h: 25,
        x: baseX,
        y: baseY,
        color: 0xff0000ff,
        src: logo,
        shader: renderer.createShader('Rounded', {
          radius: 50,
        }),
        parent: bg,
      });

      nodes.push(node);

      const textNode = renderer.createTextNode({
        w: 125,
        h: 25,
        rtt: false,
        x: baseX,
        y: baseY + 25,
        text: 'Lightning 3',
        color: 0xffffffff,
        parent: bg,
      });

      nodes.push(textNode);
    }

    console.log(
      `Created ${numOuterNodes} texture nodes and ${numOuterNodes} text nodes`,
    );
  };

  const destroy = (amount = 1) => {
    const nodesToDestroy = nodes.splice(0, amount);
    nodesToDestroy.forEach((node) => {
      node.destroy();
    });

    if (nodes.length > 0 && automation === false) {
      setTimeout(destroy, 10);
    } else if (nodes.length === 0 && automation === false) {
      console.log('All nodes destroyed');
      create(nodes, 10);
      setTimeout(destroy, 1000 + numOuterNodes * 2 * 10);
    }
  };

  if (automation === false) {
    await create(nodes, 10);
    setTimeout(destroy, 1000);
  } else {
    await create(nodes, 0);
  }

  return destroy;
}
