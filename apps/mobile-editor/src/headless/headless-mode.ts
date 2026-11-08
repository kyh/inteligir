// The page nothing shows, the phone's one place that runs the editor's code with no editor drawn.
// A `mergeJob` is a block two devices changed, which the phone's replica settles a CONFLICT
// through: the editor's own diff3 over each side's markdown answers it. The page loads nothing:
// its policy refuses every connection (`connect-src 'none'`).

import { mergeBlocks } from "@repo/editor/stale-write";

import type { PageBridge } from "../bridge/page-bridge";
import type { MergeAnswer, MergeSides } from "@repo/editor-bridge/protocol";

// the editor's merge of a block two devices changed; null for a merge that broke on the way
/** @internal */
export const mergeSides = (sides: MergeSides): MergeAnswer => {
  try {
    return mergeBlocks(sides);
  } catch {
    return null;
  }
};

export const serveHeadless = (bridge: PageBridge): (() => void) =>
  bridge.onNative((event) => {
    if (event.type === "mergeJob") {
      bridge.emit({ id: event.id, merged: mergeSides(event.sides), type: "mergeAnswer" });
    }
  });
