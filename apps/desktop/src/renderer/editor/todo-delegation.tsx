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
import type { Descendant, TElement } from "platejs";
import { useEditorRef } from "platejs/react";

import { toast } from "@repo/ui/components/sonner";

import { DelegateButton, DelegationStatusBadge } from "@renderer/delegation/status-badge";
import { isTodoItem, todoIndex } from "@renderer/editor/todo-item";
import { findDelegation, useDelegationStore } from "@renderer/stores/delegation-store";
import { useOpenNote } from "@renderer/workspace/open-note-store";
import { useVaultActions } from "@renderer/workspace/vault-context";

function DelegateControl({ element, checked }: { element: TElement; checked: boolean }) {
  const { flush } = useVaultActions();
  const plateEditor = useEditorRef();
  const delegations = useDelegationStore((s) => s.delegations);
  const delegate = useDelegationStore((s) => s.delegate);
  const cancel = useDelegationStore((s) => s.cancel);
  const submittingRef = useRef(false);

  // The checkbox belongs to the open note — the single mounted editor always
  // serves vault-context's open file, and flush() flushes exactly this file.
  const sourceFile = useOpenNote((s) => s.editor.path);
  const text = elementText(element);
  const ordinal = todoIndex(plateEditor, element);

  const delegation = sourceFile === null ? null : findDelegation(delegations, sourceFile, ordinal);

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
      const result = await delegate(sourceFile, ordinal);
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
        <DelegationStatusBadge
          delegation={delegation}
          onCancel={() => cancel(delegation.id)}
          onRetry={() => void handleDelegate()}
        />
      ) : (
        !checked && <DelegateButton onClick={() => void handleDelegate()} />
      )}
    </span>
  );
}

export default DelegateControl;

/** Concatenate an element's text content (recursing through inline children). */
function elementText(node: Descendant): string {
  if ("text" in node && typeof node.text === "string") return node.text;
  if ("children" in node && Array.isArray(node.children)) {
    return node.children.map(elementText).join("");
  }
  return "";
}
