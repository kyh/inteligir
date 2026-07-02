/* Adapted from Plate Plus Potion (https://pro.platejs.org) — used under the
 * held Plate Plus license. */
// Toggle block for the NESTED document model (`<toggle>` MDX with block
// children — WP1's serialization contract), which differs from Plate's flat
// indent-sibling model: the first child block is the always-visible summary
// row; children 2..n are the collapsible body. Open state lives in the toggle
// plugin's store (openIds) keyed by node id — never on the node — so
// collapse/expand cannot dirty the document.

import { Children, type ReactNode } from "react";
import { ChevronRightIcon } from "lucide-react";
import { PlateElement, useElement, type PlateElementProps } from "platejs/react";
import { useToggleButton, useToggleButtonState } from "@platejs/toggle/react";

import { cn } from "@repo/ui/lib/utils";

// Mirrors @platejs/toggle's hidden style for closed flat-model toggles: keeps
// the collapsed children mounted (Slate needs their DOM) but invisible.
const HIDDEN_STYLE: React.CSSProperties = {
  height: 0,
  margin: 0,
  overflow: "hidden",
  visibility: "hidden",
};

export function ToggleElement(props: PlateElementProps) {
  const element = useElement();
  const { editor } = props;
  // NodeIdPlugin (a v53 core default) stamps ids on live blocks; under
  // NODE_ENV=test ids are absent and the chevron becomes inert.
  const id = typeof element.id === "string" ? element.id : "";
  const state = useToggleButtonState(id);
  const { buttonProps, open } = useToggleButton(state);

  const childArray = Children.toArray(props.children);
  const summary: ReactNode = childArray[0] ?? null;
  const body = childArray.slice(1);

  const onChevronClick = (e: React.MouseEvent) => {
    // Collapsing while the selection sits in the body would strand the DOM
    // selection in a hidden subtree — move it to the end of the summary first.
    if (open && editor.selection && editor.api.some({ match: (n) => n === element })) {
      const path = editor.api.findPath(element);
      const point = path ? editor.api.end([...path, 0]) : undefined;
      if (point) editor.tf.select(point);
    }
    buttonProps.onClick(e);
  };

  return (
    <PlateElement {...props} className="relative mb-1 pl-6">
      <button
        type="button"
        aria-expanded={open}
        aria-label={open ? "Collapse toggle" : "Expand toggle"}
        className="absolute top-1 left-0 flex cursor-pointer items-center justify-center rounded-sm p-px transition-colors select-none hover:bg-hover"
        contentEditable={false}
        onMouseDown={buttonProps.onMouseDown}
        onClick={onChevronClick}
      >
        <ChevronRightIcon
          className={cn("size-4 transition-transform duration-75", open ? "rotate-90" : "rotate-0")}
        />
      </button>
      {summary}
      {body.length > 0 ? <div style={open ? undefined : HIDDEN_STYLE}>{body}</div> : null}
    </PlateElement>
  );
}
