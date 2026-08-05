// Renders the list marker (bullet / number / checkbox) around a block that
// carries `listStyleType`, plus — for todo items — the "Delegate" affordance
// and live delegation status. Plate models lists as indented blocks rather
// than a dedicated node, so this wrapper draws the affordance.
//
// The delegation control lives in todo-delegation.tsx behind React.lazy: it
// reaches into vault-context (and through it the markdown pipeline and
// base-kit), so an eager import here would close an import cycle around the
// kit files. This module must stay workspace-free — list-kit imports it.

import { Suspense, lazy } from "react";
import { isOrderedList } from "@platejs/list";
import { useTodoListElement, useTodoListElementState } from "@platejs/list/react";
import { type PlateElementProps, type RenderNodeWrapper, useReadOnly } from "platejs/react";

import { Checkbox } from "@repo/ui/components/checkbox";
import { cn } from "@repo/ui/lib/utils";

const DelegateControl = lazy(() => import("@repo/editor/todo-delegation"));

const TODO_CONFIG: Record<
  string,
  {
    Li: (props: PlateElementProps) => React.ReactElement;
    Marker: (props: PlateElementProps) => React.ReactElement;
  }
> = {
  todo: { Li: TodoLi, Marker: TodoMarker },
};

export const BlockList: RenderNodeWrapper = (props) => {
  if (!props.element.listStyleType) return undefined;
  return (innerProps) => <List {...innerProps} />;
};

function List(props: PlateElementProps) {
  const { listStyleType, listStart } = props.element;
  const styleType = typeof listStyleType === "string" ? listStyleType : undefined;
  const start = typeof listStart === "number" ? listStart : undefined;
  const entry = styleType ? TODO_CONFIG[styleType] : undefined;
  const ListTag = isOrderedList(props.element) ? "ol" : "ul";

  return (
    <ListTag className="relative m-0 p-0" start={start} style={{ listStyleType: styleType }}>
      {entry?.Marker && <entry.Marker {...props} />}
      {entry?.Li ? <entry.Li {...props} /> : <li>{props.children}</li>}
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
      <Suspense fallback={null}>
        <DelegateControl element={props.element} checked={checked} />
      </Suspense>
    </li>
  );
}
