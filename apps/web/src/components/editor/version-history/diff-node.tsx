import type { DiffOperation } from "@platejs/diff";
import type { TText } from "platejs";

import { PlateLeaf, type PlateLeafProps, type RenderNodeWrapper } from "platejs/react";

import { describeUpdate } from "./diff-plugin";

const diffOperationColors: Record<DiffOperation["type"], string> = {
  delete: "bg-red-200",
  insert: "bg-green-200",
  update: "bg-blue-200",
};

export const BlockDiff: RenderNodeWrapper =
  () =>
  ({ children, editor, element }) => {
    {
      if (!element.diff) return children;

      const diffOperation = element.diffOperation as DiffOperation;

      const label = {
        delete: "deletion",
        insert: "insertion",
        update: "update",
      }[diffOperation.type];

      const Component = editor.api.isInline(element) ? "span" : "div";

      return (
        <Component
          aria-label={label}
          className={diffOperationColors[diffOperation.type]}
          title={diffOperation.type === "update" ? describeUpdate(diffOperation) : undefined}
        >
          {children}
        </Component>
      );
    }
  };

export function DiffLeaf(props: PlateLeafProps<TText & { diffOperation: DiffOperation }>) {
  const diffOperation = props.leaf.diffOperation;

  const Component = {
    delete: "del",
    insert: "ins",
    update: "span",
  }[diffOperation.type] as any;

  return (
    <PlateLeaf
      {...props}
      as={Component}
      attributes={{
        ...props.attributes,
        title: diffOperation.type === "update" ? describeUpdate(diffOperation) : undefined,
      }}
      className={diffOperationColors[diffOperation.type]}
    />
  );
}
