import type { ExampleSettings } from '../common/ExampleSettings.js';

/**
 * Visual inspection page for vertical text alignment when
 * `lineHeight === boxHeight`.
 *
 * Each box is a fixed size with a colored background and a horizontal red
 * line drawn at the geometric center (y = h / 2). A text node is placed at
 * (0, 0) inside the box with `lineHeight = boxHeight` and varying `fontSize`.
 *
 * What "centered" should mean is the open question — current behavior is
 * baseline anchoring, so the *baseline* sits at `halfLeading + ascender`
 * from the top of the line box and the visual mass of the glyphs shifts
 * with the font's asc / desc ratio. The red guide line lets you eyeball
 * how far each glyph row's optical center drifts from the box's geometric
 * center as fontSize changes.
 */
export default async function test({ renderer, testRoot }: ExampleSettings) {
  testRoot.color = 0xf0f0f0ff;

  const BOX_W = 220;
  const BOX_H = 120;
  const COL_GAP = 20;
  const ROW_GAP = 20;
  const MARGIN_X = 40;
  const HEADER_H = 60;
  const ROW_LABEL_W = 130;

  const FONT_SIZES = [20, 40, 60, 80, 100];
  const SAMPLES: Array<{ label: string; text: string }> = [
    { label: 'caps', text: 'TXYZ' },
    { label: 'mixed', text: 'Abcg' },
    // Mixed-case word with no descenders (caps + lowercase ascenders +
    // x-height-only letters). Useful for spotting whether lowercase letters
    // sit comfortably with capitals when the descender tail isn't present
    // to pull the eye downward.
    { label: 'no desc.', text: 'Acme' },
    { label: 'descend.', text: 'gjpqy' },
    { label: 'digits', text: '1234' },
    { label: 'punct.', text: ',._—' },
  ];

  renderer.createTextNode({
    parent: testRoot,
    x: MARGIN_X,
    y: 10,
    text: 'Vertical centering — lineHeight = boxHeight (red line = box center)',
    fontFamily: 'Ubuntu',
    fontSize: 28,
    color: 0x222222ff,
  });

  // Column labels (one per sample, above the first row)
  for (let c = 0; c < SAMPLES.length; c++) {
    const col = SAMPLES[c]!;
    renderer.createTextNode({
      parent: testRoot,
      x: MARGIN_X + ROW_LABEL_W + c * (BOX_W + COL_GAP),
      y: HEADER_H,
      text: `${col.label}: "${col.text}"`,
      fontFamily: 'Ubuntu',
      fontSize: 18,
      color: 0x333333ff,
    });
  }

  const ROWS_Y = HEADER_H + 30;
  // A repeating soft palette so each row is easy to distinguish.
  const BOX_COLORS = [
    0xdfe9f5ff, 0xf5e9dfff, 0xe2f0e2ff, 0xf0e2f0ff, 0xfff4ccff,
  ];

  for (let r = 0; r < FONT_SIZES.length; r++) {
    const fontSize = FONT_SIZES[r]!;
    const rowY = ROWS_Y + r * (BOX_H + ROW_GAP);

    // Row label: which fontSize this row uses.
    renderer.createTextNode({
      parent: testRoot,
      x: MARGIN_X,
      y: rowY + BOX_H / 2,
      mountY: 0.5,
      text: `fontSize ${fontSize}`,
      fontFamily: 'Ubuntu',
      fontSize: 20,
      color: 0x222222ff,
    });

    for (let c = 0; c < SAMPLES.length; c++) {
      const sample = SAMPLES[c]!;
      const boxX = MARGIN_X + ROW_LABEL_W + c * (BOX_W + COL_GAP);

      // Colored container.
      const box = renderer.createNode({
        parent: testRoot,
        x: boxX,
        y: rowY,
        w: BOX_W,
        h: BOX_H,
        color: BOX_COLORS[r % BOX_COLORS.length]!,
        clipping: true,
      });

      // Geometric center guide. Height is 1.35, not 1, to avoid sub-pixel
      // rasterization gaps: at the default examples config (resolution=720,
      // appHeight=1080) the logical→physical scale is 0.667, so a 1-logical-px
      // line at certain Y positions covers no pixel center and disappears
      // (e.g. the fontSize 60 row at y=430). A 2-logical-px line is always
      // ≥ 1 physical pixel and guaranteed to rasterize.
      renderer.createNode({
        parent: box,
        x: 0,
        y: Math.round(BOX_H / 2),
        w: BOX_W,
        h: 1.35,
        color: 0xff0000ff,
      });

      // The text under test — lineHeight == box height.
      renderer.createTextNode({
        parent: box,
        x: 0,
        y: 0,
        text: sample.text,
        fontFamily: 'Ubuntu',
        fontSize,
        lineHeight: BOX_H,
        color: 0x111111ff,
        textAlign: 'center',
        maxWidth: BOX_W,
      });
    }
  }

  return testRoot;
}
