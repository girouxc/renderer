import type { ExampleSettings } from '../common/ExampleSettings.js';
import robotImg from '../assets/robot/robot.png';

export async function automation(settings: ExampleSettings) {
  await test(settings);
  await settings.snapshot();
}

const SQUARE_SIZE = 200;
const PADDING = 40;

/**
 * Visual regression coverage for the `clipping: [top, right, bottom, left]`
 * tuple form. Each green square is a clipping container at the same x/y/w/h;
 * what differs is how far we let children spill beyond each side before the
 * scissor clips them.
 */
export default async function test({ renderer, testRoot }: ExampleSettings) {
  const cases: Array<{
    label: string;
    margin: [number, number, number, number] | true;
  }> = [
    { label: 'clipping: true', margin: true },
    { label: '[40, 0, 0, 0] (top only)', margin: [40, 0, 0, 0] },
    { label: '[0, 40, 0, 0] (right only)', margin: [0, 40, 0, 0] },
    { label: '[0, 0, 40, 0] (bottom only)', margin: [0, 0, 40, 0] },
    { label: '[0, 0, 0, 40] (left only)', margin: [0, 0, 0, 40] },
    { label: '[40, 40, 40, 40] (all sides)', margin: [40, 40, 40, 40] },
    { label: '[-20, -20, -20, -20] (inset)', margin: [-20, -20, -20, -20] },
  ];

  let curX = 20;
  const curY = 60;

  for (let i = 0; i < cases.length; i++) {
    const c = cases[i]!;

    renderer.createTextNode({
      x: curX,
      y: 20,
      w: SQUARE_SIZE,
      fontFamily: 'Ubuntu',
      fontSize: 18,
      color: 0xffffffff,
      text: c.label,
      parent: testRoot,
    });

    const clipContainer = renderer.createNode({
      x: curX,
      y: curY,
      w: SQUARE_SIZE,
      h: SQUARE_SIZE,
      color: 0x00ff00ff,
      parent: testRoot,
      clipping: c.margin,
    });

    // Child overflows the container on ALL sides so we can see which edges
    // the margin opens up.
    renderer.createNode({
      x: -60,
      y: -60,
      w: SQUARE_SIZE + 120,
      h: SQUARE_SIZE + 120,
      src: robotImg,
      parent: clipContainer,
    });

    curX += SQUARE_SIZE + PADDING;
  }
}
