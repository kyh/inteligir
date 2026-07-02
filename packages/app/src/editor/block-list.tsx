import { useEffect, useRef, useState } from "react";
import { isOrderedList } from "@platejs/list";
import { useTodoListElement, useTodoListElementState } from "@platejs/list/react";
import {
  AlertCircleIcon,
  CheckCircle2Icon,
  Clock3Icon,
  Loader2Icon,
  RotateCwIcon,
  SparklesIcon,
  XIcon,
} from "lucide-react";
import type { Descendant, TElement } from "platejs";
import {
  type PlateEditor,
  type PlateElementProps,
  type RenderNodeWrapper,
  useEditorRef,
  useReadOnly,
} from "platejs/react";

import { Checkbox } from "@repo/ui/components/checkbox";
import { toast } from "@repo/ui/components/sonner";
import { cn } from "@repo/ui/lib/utils";

import { findDelegation, useDelegationStore } from "../stores/delegation-store";
import { isTodoItem } from "./todo-item";
import { useVault } from "../workspace/vault-context";
import type { Delegation } from "@repo/core/delegation";

// Renders the list marker (bullet / number / checkbox) around a block that
// carries `listStyleType`, plus — for todo items — the "Delegate" affordance and
// live delegation status. Plate models lists as indented blocks rather than a
// dedicated node, so this wrapper draws the affordance.

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
      <DelegateControl element={props.element} checked={checked} />
    </li>
  );
}

// ---------------------------------------------------------------------------
// Delegation affordance + status — a contentEditable={false} sibling so Slate
// keeps mapping the item's text children directly and never treats the control
// as editable content.
// ---------------------------------------------------------------------------

// The checkbox's ordinal — its position among all real todo items in the
// document. main counts the same `- [ ]` / `- [x]` lines in the raw markdown, so
// the two agree by position with no text matching and duplicate labels stay
// distinct.
function todoIndex(editor: PlateEditor, element: TElement): number {
  const path = editor.api.findPath(element);
  const top = path?.[0];
  if (top === undefined) return -1;
  let count = 0;
  for (let i = 0; i < top; i++) {
    if (isTodoItem(editor.children[i])) count++;
  }
  return count;
}

function DelegateControl({ element, checked }: { element: TElement; checked: boolean }) {
  const { editor: vaultEditor, flush } = useVault();
  const plateEditor = useEditorRef();
  const delegations = useDelegationStore((s) => s.delegations);
  const delegate = useDelegationStore((s) => s.delegate);
  const cancel = useDelegationStore((s) => s.cancel);
  const submittingRef = useRef(false);

  const sourceFile = vaultEditor.path;
  const text = elementText(element);
  const index = todoIndex(plateEditor, element);
  // A phantom checkbox (a plain bullet Plate tagged `todo` without `checked`)
  // has no `- [ ]` on disk — never offer to delegate it, or the ordinal would
  // resolve to a different real checkbox.
  if (sourceFile === null || text.trim() === "" || !isTodoItem(element)) return null;

  const delegation = findDelegation(delegations, sourceFile, index);

  // The "Done" badge is temporary — it lingers briefly after a delegation
  // finishes, then hides (the checked box is the durable signal), so it doesn't
  // sit on the line and drift as you edit.
  const [doneHidden, setDoneHidden] = useState(false);
  const finishedAt = delegation?.status === "done" ? delegation.finishedAt : null;
  useEffect(() => {
    if (finishedAt === null) {
      setDoneHidden(false);
      return;
    }
    const remaining = 6000 - (Date.now() - finishedAt);
    if (remaining <= 0) {
      setDoneHidden(true);
      return;
    }
    const t = setTimeout(() => setDoneHidden(true), remaining);
    return () => clearTimeout(t);
  }, [finishedAt]);
  const showBadge = delegation !== null && !(delegation.status === "done" && doneHidden);

  const handleDelegate = async () => {
    // Guard against double-submits (rapid Delegate/Retry clicks) starting
    // overlapping delegations for the same checkbox before the first one lands.
    if (submittingRef.current) return;
    submittingRef.current = true;
    try {
      // Persist the checkbox to disk first — the agent reads the file, not the
      // in-memory buffer. If the save didn't land, abort: the agent would resolve
      // the task against stale on-disk content (maybe the wrong/old checkbox).
      const saved = await flush();
      if (!saved) {
        toast.error("Couldn't save your edits — try again before delegating.");
        return;
      }
      const result = await delegate(sourceFile, index);
      if (!result.ok) toast.error(result.error ?? "Couldn't delegate that task.");
    } finally {
      submittingRef.current = false;
    }
  };

  return (
    <span
      contentEditable={false}
      className="absolute top-0 right-0 flex items-center gap-1"
      onMouseDown={(e) => e.preventDefault()}
    >
      {showBadge && delegation ? (
        <StatusBadge
          delegation={delegation}
          onCancel={() => cancel(delegation.id)}
          onRetry={() => void handleDelegate()}
        />
      ) : (
        !checked && (
          <button
            type="button"
            onClick={() => void handleDelegate()}
            title="Delegate this task to an agent"
            className="flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 hover:bg-foreground/10 hover:text-foreground"
          >
            <SparklesIcon className="size-3" />
            Delegate
          </button>
        )
      )}
    </span>
  );
}

function StatusBadge({
  delegation,
  onCancel,
  onRetry,
}: {
  delegation: Delegation;
  onCancel: () => void;
  onRetry: () => void;
}) {
  switch (delegation.status) {
    case "queued":
      return (
        <span className="flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
          <Clock3Icon className="size-3" />
          Queued
          <button type="button" onClick={onCancel} title="Cancel" className="hover:text-foreground">
            <XIcon className="size-3" />
          </button>
        </span>
      );
    case "running":
      return (
        <span className="flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] text-primary">
          <Loader2Icon className="size-3 animate-spin" />
          Working…
        </span>
      );
    case "done":
      return (
        <span
          className="flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] text-emerald-600 dark:text-emerald-400"
          title={delegation.resultSummary ?? "Done"}
        >
          <CheckCircle2Icon className="size-3" />
          Done
        </span>
      );
    case "failed":
      return (
        <span
          className="flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] text-destructive"
          title={delegation.error ?? "Failed"}
        >
          <AlertCircleIcon className="size-3" />
          Failed
          <button
            type="button"
            onClick={onRetry}
            title="Retry delegation"
            className="hover:text-foreground"
          >
            <RotateCwIcon className="size-3" />
          </button>
        </span>
      );
  }
}

/** Concatenate an element's text content (recursing through inline children). */
function elementText(node: Descendant): string {
  if ("text" in node && typeof node.text === "string") return node.text;
  if ("children" in node && Array.isArray(node.children)) {
    return node.children.map(elementText).join("");
  }
  return "";
}
