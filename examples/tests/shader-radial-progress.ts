import type { ExampleSettings } from '../common/ExampleSettings.js';

export async function automation(settings: ExampleSettings) {
  await test(settings);
  await settings.snapshot();
}

export default async function test({ renderer, testRoot }: ExampleSettings) {
  const ANIM_DURATION = 2000;

  // 1. Self-animating fill: shader drives progress 0 → 1 from u_time, looping.
  //    No JS-side animation needed — pure GLSL/Canvas math each frame.
  //    Starts static (duration: 0); press SPACE to enable.
  const fillRing = renderer.createNode({
    x: 40,
    y: 40,
    w: 300,
    h: 300,
    color: 0x00000000,
    shader: renderer.createShader('RadialProgress', {
      width: 16,
      duration: 0,
      progress: 0,
      countdown: 0, // fill 0 -> 1
      colors: [0x4aff80ff],
      trackColor: 0x1c3a2aff,
    }),
    parent: testRoot,
  });

  // 2. Self-animating countdown: shader drives progress 1 → 0, looping.
  //    Matches the reference screenshot recipe (blue arc, dim blue track).
  //    Starts static (duration: 0); press SPACE to enable.
  const countdownRing = renderer.createNode({
    x: 380,
    y: 40,
    w: 300,
    h: 300,
    color: 0x00000000,
    shader: renderer.createShader('RadialProgress', {
      width: 14,
      duration: 0,
      progress: 1,
      countdown: 1, // drain 1 -> 0
      colors: [0x4aa3ffff],
      trackColor: 0x1f3a5cff,
    }),
    parent: testRoot,
  });

  // 3. Multi-stop gradient swept along the arc, 50% progress
  renderer.createNode({
    x: 720,
    y: 40,
    w: 300,
    h: 300,
    color: 0x00000000,
    shader: renderer.createShader('RadialProgress', {
      width: 24,
      progress: 0.5,
      colors: [0x4aa3ffff, 0x9ad6ffff, 0xffffffff],
      trackColor: 0x1f3a5c66,
    }),
    parent: testRoot,
  });

  // 4. Counter-clockwise, butt caps, partial sweep
  renderer.createNode({
    x: 40,
    y: 380,
    w: 300,
    h: 300,
    color: 0x00000000,
    shader: renderer.createShader('RadialProgress', {
      width: 20,
      progress: 0.35,
      direction: -1,
      cap: 0,
      colors: [0xff66aaff, 0xffaa66ff],
      trackColor: 0x33333366,
    }),
    parent: testRoot,
  });

  // 5. Full ring with multi-stop sweep (no track)
  renderer.createNode({
    x: 380,
    y: 380,
    w: 300,
    h: 300,
    color: 0x00000000,
    shader: renderer.createShader('RadialProgress', {
      width: 18,
      progress: 1,
      colors: [0xff0080ff, 0xffaa00ff, 0x00ffaaff, 0xff0080ff],
    }),
    parent: testRoot,
  });

  // 6. Custom startAngle (9 o'clock), 80% progress
  renderer.createNode({
    x: 720,
    y: 380,
    w: 300,
    h: 300,
    color: 0x00000000,
    shader: renderer.createShader('RadialProgress', {
      width: 12,
      progress: 0.8,
      startAngle: Math.PI,
      colors: [0xffffffff],
      trackColor: 0x33333366,
    }),
    parent: testRoot,
  });

  // Instructions
  const instructions = renderer.createTextNode({
    x: 40,
    y: 720,
    fontSize: 28,
    fontFamily: 'Ubuntu',
    color: 0xffffffff,
    text: 'Press SPACE to toggle the fill + countdown animations (top-left, top-middle).',
    parent: testRoot,
  });

  const statusLabel = renderer.createTextNode({
    x: 40,
    y: 760,
    fontSize: 24,
    fontFamily: 'Ubuntu',
    color: 0xaaaaaaff,
    text: 'animation: off',
    parent: testRoot,
  });
  // statusLabel and instructions kept as locals so they aren't GC-tracked away
  void instructions;

  let animationOn = false;
  window.addEventListener('keydown', (e) => {
    if (e.key !== ' ' && e.code !== 'Space') return;
    e.preventDefault();
    animationOn = !animationOn;
    const d = animationOn ? ANIM_DURATION : 0;
    fillRing.shader.props!.duration = d;
    countdownRing.shader.props!.duration = d;
    statusLabel.text = 'animation: ' + (animationOn ? 'on' : 'off');
  });
}
