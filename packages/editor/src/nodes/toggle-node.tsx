// @license MIT, vendored from plate (github.com/udecode/plate). © Plate contributors.

import { ChevronRightIcon } from "lucide-react";
import { PlateElement, useElement } from "platejs/react";
import type { PlateElementProps } from "platejs/react";
import { useToggleButton, useToggleButtonState } from "@platejs/toggle/react";

import { Tooltip } from "@repo/ui/components/tooltip";
import { cn } from "@repo/ui/lib/cn";

import { stringProp } from "@repo/editor/headless/node-props";
import { TOGGLE_COLLAPSED_ATTR } from "@repo/editor/style-hooks";

export const ToggleElement = (props: PlateElementProps) => {
  const element = useElement();
  const { editor } = props;
  const id = stringProp(element, "id") ?? "";
  const state = useToggleButtonState(id);
  const { buttonProps, open } = useToggleButton(state);

  const handleMouseDown = buttonProps.onMouseDown;

  const handleChevronClick = (e: React.MouseEvent) => {
    if (open && editor.selection && editor.api.some({ match: (n) => n === element })) {
      const path = editor.api.findPath(element);
      const point = path ? editor.api.end([...path, 0]) : undefined;

      if (point) {
        editor.tf.select(point);
      }
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
          onMouseDown={handleMouseDown}
          onClick={handleChevronClick}
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
};
