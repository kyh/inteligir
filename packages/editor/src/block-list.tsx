// Plate models lists as indented blocks, so this wrapper draws the marker.
// Must stay workspace-free: list-kit imports it.

import { isOrderedList } from "@platejs/list";
import { useTodoListElement, useTodoListElementState } from "@platejs/list/react";
import { type PlateElementProps, type RenderNodeWrapper, useReadOnly } from "platejs/react";

import { Checkbox } from "@repo/ui/components/checkbox";
import { cn } from "@repo/ui/lib/utils";

import { numberProp, stringProp } from "@repo/editor/node-props";

const TODO_STYLE_TYPE = "todo";

export const BlockList: RenderNodeWrapper = (props) => {
  if (!props.element.listStyleType) return undefined;
  return (innerProps) => <List {...innerProps} />;
};

function List(props: PlateElementProps) {
  const styleType = stringProp(props.element, "listStyleType");
  const start = numberProp(props.element, "listStart");
  const isTodo = styleType === TODO_STYLE_TYPE;
  const ListTag = isOrderedList(props.element) ? "ol" : "ul";

  return (
    <ListTag className="relative m-0 p-0" start={start} style={{ listStyleType: styleType }}>
      {isTodo && <TodoMarker {...props} />}
      {isTodo ? <TodoLi {...props} /> : <li>{props.children}</li>}
    </ListTag>
  );
}

function TodoMarker(props: PlateElementProps) {
  const state = useTodoListElementState({ element: props.element });
  const { checkboxProps } = useTodoListElement(state);
  const readOnly = useReadOnly();

  return (
    <div contentEditable={false}>
      <Checkbox
        className={cn("absolute top-1 -left-6", readOnly && "pointer-events-none")}
        {...checkboxProps}
      />
    </div>
  );
}

function TodoLi(props: PlateElementProps) {
  const checked = props.element.checked === true;
  return (
    <li className={cn("group relative list-none", checked && "text-muted-foreground line-through")}>
      {props.children}
    </li>
  );
}
