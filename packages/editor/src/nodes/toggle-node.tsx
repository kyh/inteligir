// Vendored from plate (github.com/udecode/plate), MIT. © Plate contributors.
// Hiding is CSS via [data-toggle-collapsed], not a split of props.children: Plate hands the
// element all its Slate children as one React child, and hidden blocks must stay mounted for Slate.

import { ChevronRightIcon } from "lucide-react";
import { PlateElement, useElement, type PlateElementProps } from "platejs/react";
import { useToggleButton, useToggleButtonState } from "@platejs/toggle/react";

import { Tooltip } from "@repo/ui/components/tooltip";
import { cn } from "@repo/ui/lib/utils";

import { stringProp } from "@repo/editor/node-props";
import { TOGGLE_COLLAPSED_ATTR } from "@repo/editor/style-hooks";

export function ToggleElement(props: PlateElementProps) {
  const element = useElement();
  const { editor } = props;
  // under NODE_ENV=test NodeIdPlugin is off, so ids are absent and the chevron is inert.
  const id = stringProp(element, "id") ?? "";
  const state = useToggleButtonState(id);
  const { buttonProps, open } = useToggleButton(state);

  const onChevronClick = (e: React.MouseEvent) => {
    // collapsing with the selection in the body strands the DOM selection in a hidden subtree.
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
      className="relative pl-6"
      attributes={{
        ...props.attributes,
        [TOGGLE_COLLAPSED_ATTR]: open ? undefined : "",
      }}
    >
      <Tooltip content={open ? "Collapse toggle" : "Expand toggle"}>
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
            className={cn(
              "size-4 transition-transform duration-75",
              open ? "rotate-90" : "rotate-0",
            )}
          />
        </button>
      </Tooltip>
      {props.children}
    </PlateElement>
  );
}
