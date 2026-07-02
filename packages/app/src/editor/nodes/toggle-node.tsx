/* Adapted from Plate Plus Potion (https://pro.platejs.org) — used under the
 * held Plate Plus license. */
// Toggle block for the NESTED document model (`<toggle>` MDX with block
// children — WP1's serialization contract), which differs from Plate's flat
// indent-sibling model: the first child block is the always-visible summary
// row; children 2..n are the collapsible body. Open state lives in the toggle
// plugin's store (openIds) keyed by node id — never on the node — so
// collapse/expand cannot dirty the document.
//
// Hiding happens in CSS, not by splitting `props.children`: Plate hands the
// element ALL of its rendered Slate children as a single React child (plus a
// BelowRootNodes sibling), so a React-level split can't separate summary from
// body without poking into opaque internals. Instead every Slate block after
// the first is hidden by the `[data-toggle-collapsed]` rule in styles.css —
// kept mounted (Slate needs the DOM) but invisible, mirroring the flat-model
// plugin's hidden style.

import { ChevronRightIcon } from "lucide-react";
import { PlateElement, useElement, type PlateElementProps } from "platejs/react";
import { useToggleButton, useToggleButtonState } from "@platejs/toggle/react";

import { cn } from "@repo/ui/lib/utils";

export function ToggleElement(props: PlateElementProps) {
  const element = useElement();
  const { editor } = props;
  // NodeIdPlugin (a v53 core default) stamps ids on live blocks; under
  // NODE_ENV=test ids are absent and the chevron becomes inert.
  const id = typeof element.id === "string" ? element.id : "";
  const state = useToggleButtonState(id);
  const { buttonProps, open } = useToggleButton(state);

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
    <PlateElement
      {...props}
      className="relative mb-1 pl-6"
      attributes={{
        ...props.attributes,
        "data-toggle-collapsed": open ? undefined : "",
      }}
    >
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
      {props.children}
    </PlateElement>
  );
}
