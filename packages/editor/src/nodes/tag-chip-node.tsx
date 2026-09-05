// A leaf decoration, never a node, so a `#tag` costs the file only the bytes typed. Not a
// focusable control: a tabbable element mid-paragraph wrecks caret navigation; the keyboard
// route is typing `tag:<name>` into the palette.

import { PlateLeaf, type PlateLeafProps } from "platejs/react";

import { useAgentRequestActions } from "@repo/editor/agent-request";

// a drag ending over a chip fires a click; reads the DOM selection because Slate's lags a click by a tick.
function hasRangeSelection(): boolean {
  const selection = document.getSelection();
  return selection !== null && !selection.isCollapsed;
}

export function TagChipLeaf(props: PlateLeafProps) {
  const text = props.leaf.text;
  const tag = text.startsWith("#") ? text.slice(1) : "";
  return (
    <PlateLeaf
      {...props}
      className="cursor-pointer rounded-sm bg-primary/10 px-0.5 text-primary transition-colors hover:bg-primary/20"
      attributes={{
        ...props.attributes,
        onClick: () => {
          if (tag !== "" && !hasRangeSelection()) {
            useAgentRequestActions.getState().actions?.showTag(tag);
          }
        },
        title: `Show notes tagged #${tag}`,
      }}
    />
  );
}
