import rockoImg from '../assets/rocko.png';
import type { ExampleSettings } from '../common/ExampleSettings.js';

export async function automation(settings: ExampleSettings) {
  await test(settings);
  await settings.snapshot();
}

export default async function test({ renderer, testRoot }: ExampleSettings) {
  const amounts = [0, 2, 6, 12];
  const size = 300;
  const gap = 20;

  for (let i = 0; i < amounts.length; i++) {
    renderer.createNode({
      x: 20 + i * (size + gap),
      y: 20,
      w: size,
      h: size,
      texture: renderer.createTexture('ImageTexture', {
        src: rockoImg,
      }),
      shader: renderer.createShader('Blur', {
        amount: amounts[i],
      }),
      parent: testRoot,
    });
  }
}
