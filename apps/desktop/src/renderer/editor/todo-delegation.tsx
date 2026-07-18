// Delegation affordance + status badge for todo items — a contentEditable
// ={false} sibling so Slate keeps mapping the item's text children directly
// and never treats the control as editable content.
//
// Split from block-list.tsx and loaded via React.lazy: this module
// imports vault-context (which imports the markdown pipeline, which imports
// base-kit, which imports the kit files) — importing it eagerly from
// block-list would put the whole workspace inside the kit module graph and
// deadlock module init when an entrypoint reaches base-kit through a kit
// file. Deferring to render time breaks the cycle structurally.

import { useEffect, useRef, useState } from "react";
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
import { useEditorRef } from "platejs/react";

import { toast } from "@repo/ui/components/sonner";
import { Button } from "@repo/ui/components/button";

import { isTodoItem, todoIndex } from "@renderer/editor/todo-item";
import { findDelegation, useDelegationStore } from "@renderer/stores/delegation-store";
import { useVault } from "@renderer/workspace/vault-context";
import type { Delegation } from "@repo/features/delegation";

function DelegateControl({ element, checked }: { element: TElement; checked: boolean }) {
  const { editor: vaultEditor, flush } = useVault();
  const plateEditor = useEditorRef();
  const delegations = useDelegationStore((s) => s.delegations);
  const delegate = useDelegationStore((s) => s.delegate);
  const cancel = useDelegationStore((s) => s.cancel);
  const submittingRef = useRef(false);

  // The checkbox belongs to the open note — the single mounted editor always
  // serves vault-context's open file, and flush() flushes exactly this file.
  const sourceFile = vaultEditor.path;
  const text = elementText(element);
  const index = todoIndex(plateEditor, element);

  const delegation = sourceFile === null ? null : findDelegation(delegations, sourceFile, index);

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

  // A phantom checkbox (a plain bullet Plate tagged `todo` without `checked`)
  // has no `- [ ]` on disk — never offer to delegate it, or the ordinal would
  // resolve to a different real checkbox.
  if (sourceFile === null || text.trim() === "" || !isTodoItem(element)) return null;

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
          <Button
            variant="ghost"
            size="xs"
            onClick={() => void handleDelegate()}
            title="Delegate this task to an agent"
            className="h-auto rounded-full px-2 py-0.5 text-[10px] font-normal text-muted-foreground opacity-0 group-hover:opacity-100"
          >
            <SparklesIcon className="size-3" />
            Delegate
          </Button>
        )
      )}
    </span>
  );
}

export default DelegateControl;

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
          <button
            type="button"
            aria-label="Cancel delegation"
            onClick={onCancel}
            title="Cancel"
            className="hover:text-foreground"
          >
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
            aria-label="Retry delegation"
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
