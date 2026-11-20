import { PlateLeaf } from "platejs/react";
import type { PlateLeafProps } from "platejs/react";

import { getEditorHostActions } from "@repo/editor/host-io";

const hasRangeSelection = () => {
  const selection = document.getSelection();

  return selection !== null && !selection.isCollapsed;
};

export const TagChipLeaf = (props: PlateLeafProps) => {
  const { text } = props.leaf;
  const tag = text.startsWith("#") ? text.slice(1) : "";

  return (
    <PlateLeaf
      {...props}
      className="cursor-pointer rounded-sm bg-primary/10 px-0.5 text-primary transition-colors hover:bg-primary/20"
      attributes={{
        ...props.attributes,
        onClick: () => {
          if (tag !== "" && !hasRangeSelection()) {
            getEditorHostActions().items.showTag(tag);
          }
        },
        title: `Show items tagged #${tag}`,
      }}
    />
  );
};
