import { describe, it, expect } from 'vitest';
import type { CoreNode } from '../CoreNode.js';
import { sortByZIndexStable } from './collectionUtils.js';

const makeNode = (zIndex: number, tag: number): CoreNode =>
  ({ props: { zIndex }, tag } as unknown as CoreNode);

const tags = (nodes: CoreNode[]): number[] => {
  const out: number[] = [];
  for (let i = 0; i < nodes.length; i++) {
    out.push((nodes[i] as unknown as { tag: number }).tag);
  }
  return out;
};

describe('sortByZIndexStable', () => {
  it('should sort nodes ascending by zIndex', () => {
    const nodes = [makeNode(3, 0), makeNode(1, 1), makeNode(2, 2)];

    sortByZIndexStable(nodes);

    expect(tags(nodes)).toEqual([1, 2, 0]);
  });

  it('should preserve insertion order for equal zIndex values', () => {
    const nodes = [
      makeNode(1, 0),
      makeNode(0, 1),
      makeNode(1, 2),
      makeNode(0, 3),
      makeNode(1, 4),
    ];

    sortByZIndexStable(nodes);

    expect(tags(nodes)).toEqual([1, 3, 0, 2, 4]);
  });

  it('should be stable for arrays longer than 10 elements', () => {
    // V8 on Chrome < 70 switched to an unstable quicksort above 10 elements;
    // this guards the case the native sort got wrong.
    const nodes: CoreNode[] = [];
    for (let i = 0; i < 20; i++) {
      nodes.push(makeNode(i % 2, i));
    }

    sortByZIndexStable(nodes);

    const expected: number[] = [];
    for (let i = 0; i < 20; i += 2) {
      expected.push(i);
    }
    for (let i = 1; i < 20; i += 2) {
      expected.push(i);
    }
    expect(tags(nodes)).toEqual(expected);
  });

  it('should handle negative and fractional zIndex values', () => {
    const nodes = [
      makeNode(0.5, 0),
      makeNode(-2, 1),
      makeNode(1000000000, 2),
      makeNode(0, 3),
      makeNode(-2, 4),
    ];

    sortByZIndexStable(nodes);

    expect(tags(nodes)).toEqual([1, 4, 3, 0, 2]);
  });

  it('should leave an already sorted array unchanged', () => {
    const nodes = [makeNode(0, 0), makeNode(0, 1), makeNode(1, 2)];

    sortByZIndexStable(nodes);

    expect(tags(nodes)).toEqual([0, 1, 2]);
  });

  it('should handle empty and single-element arrays', () => {
    const empty: CoreNode[] = [];
    const single = [makeNode(5, 0)];

    sortByZIndexStable(empty);
    sortByZIndexStable(single);

    expect(empty.length).toBe(0);
    expect(tags(single)).toEqual([0]);
  });
});
