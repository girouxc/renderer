import type {
  ITextNode,
  ITextNodeProps,
  RendererMain,
} from '@lightningjs/renderer';
import type { ExampleSettings } from '../common/ExampleSettings.js';
import { paginateTestRows, type TestRow } from '../common/paginateTestRows.js';
import { PageContainer } from '../common/PageContainer.js';
import { constructTestRow } from '../common/constructTestRow.js';
import { waitForLoadedDimensions } from '../common/utils.js';

export async function automation(settings: ExampleSettings) {
  // Snapshot all the pages
  await (await test(settings)).snapshotPages();
}

export default async function test(settings: ExampleSettings) {
  const { renderer } = settings;
  const pageContainer = new PageContainer(settings, {
    w: renderer.settings.appWidth,
    h: renderer.settings.appHeight,
    title: 'Text Vertical Align',
  });

  await paginateTestRows(pageContainer, [
    ...generateVerticalAlignTest(renderer, 'sdf'),
    null,
    ...generateVerticalAlignTest(renderer, 'canvas'),
  ]);

  return pageContainer;
}

const NODE_PROPS = {
  color: 0x000000ff,
  fontFamily: 'Ubuntu',
  textRendererOverride: 'sdf',
  fontSize: 50,
  lineHeight: 70,
} satisfies Partial<ITextNodeProps>;

const CONTAINER_SIZE = 200;
const CONTAINER_SIZE_3L = 280;

function getSquare(
  renderer: RendererMain,
  node: ITextNode,
  size = CONTAINER_SIZE,
) {
  const wrapper = renderer.createNode({
    w: size,
    h: size,
  });
  const line1 = renderer.createNode({
    w: size,
    h: 1,
    color: 0x00ff00ff,
    y: NODE_PROPS.lineHeight,
  });
  line1.parent = wrapper;
  const line2 = renderer.createNode({
    w: size,
    h: 1,
    color: 0x00ff00ff,
    y: NODE_PROPS.lineHeight * 2,
  });
  line2.parent = wrapper;
  if (size >= NODE_PROPS.lineHeight * 3) {
    const line3 = renderer.createNode({
      w: size,
      h: 1,
      color: 0x00ff00ff,
      y: NODE_PROPS.lineHeight * 3,
    });
    line3.parent = wrapper;
  }
  node.parent = wrapper;
  return wrapper;
}

function generateVerticalAlignTest(
  renderer: RendererMain,
  textRenderer: 'canvas' | 'sdf',
): TestRow[] {
  return [
    {
      title: `One Line ('verticalAlign', ${textRenderer}, fontSize = 50, lineHeight = 70)`,
      content: async (rowNode) => {
        const nodeProps = {
          ...NODE_PROPS,
          text: 'txyz',
          contain: 'height',
          textRendererOverride: textRenderer,
          maxHeight: CONTAINER_SIZE,
        } satisfies Partial<ITextNodeProps>;

        const baselineNode = renderer.createTextNode({
          ...nodeProps,
          verticalAlign: 'middle',
        });

        return await constructTestRow({ renderer, rowNode }, [
          'verticalAlign: middle\n(default)\n->',
          getSquare(renderer, baselineNode),
          'top ->',
          getSquare(
            renderer,
            renderer.createTextNode({
              ...nodeProps,
              verticalAlign: 'top',
            }),
          ),
          'bottom ->',
          getSquare(
            renderer,
            renderer.createTextNode({
              ...nodeProps,
              verticalAlign: 'bottom',
            }),
          ),
        ]);
      },
    },
    {
      title: `Two Lines ('verticalAlign', ${textRenderer}, fontSize = 50, lineHeight = 70)`,
      content: async (rowNode) => {
        const nodeProps = {
          ...NODE_PROPS,
          text: 'abcd\ntxyz',
          textRendererOverride: textRenderer,
          contain: 'height',
          maxHeight: CONTAINER_SIZE,
        } satisfies Partial<ITextNodeProps>;

        const baselineNode = renderer.createTextNode({
          ...nodeProps,
          verticalAlign: 'middle',
        });

        return await constructTestRow({ renderer, rowNode }, [
          'verticalAlign: middle\n(default)\n->',
          getSquare(renderer, baselineNode),
          'top ->',
          getSquare(
            renderer,
            renderer.createTextNode({
              ...nodeProps,
              verticalAlign: 'top',
            }),
          ),
          'bottom ->',
          getSquare(
            renderer,
            renderer.createTextNode({
              ...nodeProps,
              verticalAlign: 'bottom',
            }),
          ),
        ]);
      },
    },
    {
      title: `Three Lines ('verticalAlign', ${textRenderer}, fontSize = 50, lineHeight = 70)`,
      content: async (rowNode) => {
        const nodeProps = {
          ...NODE_PROPS,
          text: 'abcd\nefgh\ntxyz',
          textRendererOverride: textRenderer,
          contain: 'height',
          maxHeight: CONTAINER_SIZE_3L,
        } satisfies Partial<ITextNodeProps>;

        const baselineNode = renderer.createTextNode({
          ...nodeProps,
          verticalAlign: 'middle',
        });

        return await constructTestRow(
          { renderer, rowNode, containerSize: CONTAINER_SIZE_3L },
          [
            'verticalAlign: middle\n(default)\n->',
            getSquare(renderer, baselineNode, CONTAINER_SIZE_3L),
            'top ->',
            getSquare(
              renderer,
              renderer.createTextNode({
                ...nodeProps,
                verticalAlign: 'top',
              }),
              CONTAINER_SIZE_3L,
            ),
            'bottom ->',
            getSquare(
              renderer,
              renderer.createTextNode({
                ...nodeProps,
                verticalAlign: 'bottom',
              }),
              CONTAINER_SIZE_3L,
            ),
          ],
        );
      },
    },
    {
      title: `Explicit h, no maxHeight ('verticalAlign', ${textRenderer}, fontSize = 50, lineHeight = 70)`,
      content: async (rowNode) => {
        const baseProps = {
          ...NODE_PROPS,
          text: 'txyz',
          textRendererOverride: textRenderer,
          forceLoad: true,
        } satisfies Partial<ITextNodeProps>;

        const makeBoxedTextNode = async (
          verticalAlign: 'top' | 'middle' | 'bottom',
        ) => {
          const node = renderer.createTextNode({
            ...baseProps,
            verticalAlign,
            parent: rowNode,
          });
          await waitForLoadedDimensions(node);
          node.h = CONTAINER_SIZE;
          return node;
        };

        const middleNode = await makeBoxedTextNode('middle');
        const topNode = await makeBoxedTextNode('top');
        const bottomNode = await makeBoxedTextNode('bottom');

        return await constructTestRow({ renderer, rowNode }, [
          'verticalAlign: middle\n(node.h, no maxHeight)\n->',
          getSquare(renderer, middleNode),
          'top ->',
          getSquare(renderer, topNode),
          'bottom ->',
          getSquare(renderer, bottomNode),
        ]);
      },
    },
  ] satisfies TestRow[];
}
