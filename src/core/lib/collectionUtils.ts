import type { CoreNode } from '../CoreNode.js';

// Stable in-place sort by zIndex. Array.prototype.sort is not stable on
// Chrome < 70 (V8 quicksorts arrays longer than 10), and equal-zIndex
// siblings must keep insertion order or paint order silently reshuffles.
// Children arrays are small and nearly sorted (kept sorted; a re-sort
// usually follows a single zIndex change), so insertion sort is O(n) in
// practice and allocation-free.
export const sortByZIndexStable = (nodes: CoreNode[]): void => {
  const len = nodes.length;
  for (let i = 1; i < len; i++) {
    const node = nodes[i]!;
    const z = node.props.zIndex;
    let j = i - 1;
    while (j >= 0 && nodes[j]!.props.zIndex > z) {
      nodes[j + 1] = nodes[j]!;
      j--;
    }
    nodes[j + 1] = node;
  }
};

export const incrementalRepositionByZIndex = (
  changedNodes: CoreNode[],
  nodes: CoreNode[],
): void => {
  for (let i = 0; i < changedNodes.length; i++) {
    const node = changedNodes[i]!;
    const currentIndex = findChildIndexById(node, nodes);
    if (currentIndex === -1) continue;

    const targetZIndex = node.props.zIndex;

    //binary search for correct insertion position
    let left = 0;
    let right = nodes.length;

    while (left < right) {
      const mid = (left + right) >>> 1;
      if (nodes[mid]!.props.zIndex <= targetZIndex) {
        left = mid + 1;
      } else {
        right = mid;
      }
    }

    //adjust target position if it's after the current position
    const targetIndex = left > currentIndex ? left - 1 : left;

    //only reposition if target is different from current
    if (targetIndex !== currentIndex) {
      nodes.splice(currentIndex, 1);
      nodes.splice(targetIndex, 0, node);
    }
  }
};

export const findChildIndexById = (
  node: CoreNode,
  children: CoreNode[],
): number => {
  for (let i = 0; i < children.length; i++) {
    const child = children[i]!;

    // @ts-expect-error - accessing protected property
    if (child._id === node._id) {
      return i;
    }
  }
  return -1;
};

export const removeChild = (node: CoreNode, children: CoreNode[]): void => {
  const index = findChildIndexById(node, children);
  if (index !== -1) {
    children.splice(index, 1);
  }
};
