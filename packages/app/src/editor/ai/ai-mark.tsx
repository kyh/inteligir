// The transient `ai` leaf mark — the highlight under text the AI is streaming
// into the document (the AI menu's generate flow). It exists so the editor can
// render the pending range; it NEVER serializes (markdown-kit lists it in
// disallowedNodes), so an autosave firing mid-stream writes clean bytes.

import { PlateLeaf, createPlatePlugin, type PlateLeafProps } from "platejs/react";

export const AI_MARK = "ai";

function AiLeaf(props: PlateLeafProps) {
  return (
    <PlateLeaf
      {...props}
      className="rounded-sm bg-primary/15 underline decoration-primary/40 decoration-dotted underline-offset-2"
    />
  );
}

export const AiMarkKit = [
  createPlatePlugin({ key: AI_MARK, node: { isLeaf: true } }).withComponent(AiLeaf),
];
