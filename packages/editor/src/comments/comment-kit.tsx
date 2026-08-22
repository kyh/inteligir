// The comment surface's editor half (issue #583): the anchored-range tint,
// ⌘⇧A create-from-selection with its inline first-comment popover, and the
// scroll-to-thread helper the panel calls. The SIDECAR stays the app's (its
// routes own entries); this kit owns only what lives in the buffer — marker
// pairs — and the pixels over them.

import { useEffect, useRef, useState } from "react";
import {
  ElementApi,
  isHotkey,
  KEYS,
  NodeApi,
  TextApi,
  type DecoratedRange,
  type SlateEditor,
} from "platejs";
import { PlateLeaf, createPlatePlugin, useEditorRef, type PlateLeafProps } from "platejs/react";

import { cn } from "@repo/ui/lib/utils";
import { Button } from "@repo/ui/components/button";
import { Textarea } from "@repo/ui/components/textarea";

import { holdsCommentMarkers, scanBlockComments } from "./comment-ranges";
import {
  findCommentMarker,
  insertCommentMarkers,
  mintCommentId,
  removeCommentMarkers,
} from "./comment-markers";
import { setPendingCreate, useCommentSurface } from "./comment-store";

function CommentRangeLeaf(props: PlateLeafProps) {
  const raw = typeof props.leaf.commentIds === "string" ? props.leaf.commentIds : "";
  const ids = raw.split(",").filter((id) => id !== "");
  const orphan = props.leaf.commentOrphan === true;
  const { actions, knownIds, resolvedIds } = useCommentSurface();
  const resolved = ids.length > 0 && ids.every((id) => resolvedIds.has(id));
  const unknown = ids.length > 0 && ids.every((id) => !knownIds.has(id));
  return (
    <PlateLeaf
      {...props}
      as="span"
      className={cn(
        "cursor-pointer rounded-[2px]",
        orphan || unknown
          ? "bg-amber-500/10 underline decoration-amber-500/50 decoration-dotted underline-offset-2"
          : resolved
            ? "bg-emerald-500/[0.06]"
            : "bg-amber-300/20 hover:bg-amber-300/30",
        // Review markup is not content: the tint stays on screen only.
        "print:bg-transparent print:no-underline",
      )}
      attributes={{
        ...props.attributes,
        onClick: () => {
          if (ids.length > 0) actions?.open(ids);
        },
      }}
    >
      {props.children}
    </PlateLeaf>
  );
}

/** Begin the ⌘⇧A flow: markers in (one undo step), popover armed. */
function beginCreate(editor: SlateEditor): boolean {
  const domSelection = window.getSelection();
  const rect =
    domSelection !== null && domSelection.rangeCount > 0
      ? domSelection.getRangeAt(0).getBoundingClientRect()
      : null;
  const id = mintCommentId();
  if (!insertCommentMarkers(editor, id)) return false;
  setPendingCreate({
    id,
    rect:
      rect === null
        ? { bottom: 120, left: 120, top: 100 }
        : { bottom: rect.bottom, left: rect.left, top: rect.top },
  });
  return true;
}

function CommentCreateHost() {
  const editor = useEditorRef();
  const pending = useCommentSurface((state) => state.pendingCreate);
  const actions = useCommentSurface((state) => state.actions);
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const fieldRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (pending !== null) {
      setText("");
      requestAnimationFrame(() => fieldRef.current?.focus());
    }
  }, [pending]);

  if (pending === null) return null;

  const cancel = (): void => {
    removeCommentMarkers(editor, [pending.id]);
    setPendingCreate(null);
  };

  const save = (): void => {
    const trimmed = text.trim();
    if (trimmed === "" || saving || actions === null) return;
    setSaving(true);
    void (async () => {
      const ok = await actions.create(pending.id, trimmed).catch(() => false);
      setSaving(false);
      if (!ok) {
        // The entry never landed; a marker pair pointing at nothing would be
        // an orphan the user did not choose.
        removeCommentMarkers(editor, [pending.id]);
      }
      setPendingCreate(null);
    })();
  };

  return (
    <div
      className="fixed z-50 w-72 rounded-lg border border-border bg-popover p-2 shadow-md"
      style={{ left: pending.rect.left, top: pending.rect.bottom + 8 }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          cancel();
        }
      }}
    >
      <Textarea
        ref={fieldRef}
        aria-label="Comment"
        placeholder="Comment…"
        value={text}
        rows={2}
        className="mb-2 resize-none"
        onChange={(event) => {
          setText(event.target.value);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            save();
          }
        }}
      />
      <div className="flex justify-end gap-1.5">
        <Button size="xs" variant="ghost" onClick={cancel}>
          Cancel
        </Button>
        <Button size="xs" disabled={saving || text.trim() === ""} onClick={save}>
          Save
        </Button>
      </div>
    </div>
  );
}

/** Scroll the live editor to the FIRST marker of `rootId`. */
export function scrollToCommentMarker(editor: SlateEditor, rootId: string): boolean {
  const entry = findCommentMarker(editor, rootId);
  if (entry === null) return false;
  try {
    const dom = editor.api.toDOMNode(entry[0]);
    dom?.scrollIntoView({ behavior: "smooth", block: "center" });
    return dom !== undefined;
  } catch {
    return false;
  }
}

export const CommentKit = [
  createPlatePlugin({
    key: "commentRange",
    node: { isLeaf: true },
    // TEXT-level, the tag-chip precedent: Plate applies a decoration only to
    // the node it was returned FOR, so a block-level range never reaches the
    // leaves. Each text run asks its parent block's scan and keeps the slice
    // of any comment range that covers it (markers split texts at the exact
    // selection edges, so interior runs are covered whole).
    decorate: ({ editor, entry }) => {
      const [node, path] = entry;
      if (!TextApi.isText(node)) return undefined;
      const parentPath = path.slice(0, -1);
      const parent = NodeApi.get(editor, parentPath);
      if (!ElementApi.isElement(parent) || !holdsCommentMarkers(parent)) return undefined;
      const scan = scanBlockComments(editor, [parent, parentPath]);
      const index = path[path.length - 1];
      if (index === undefined) return undefined;
      const decorations: DecoratedRange[] = [];
      const clip = (
        anchor: { path: number[]; offset: number },
        focus: { path: number[]; offset: number },
        ids: readonly string[],
        orphan: boolean,
      ): void => {
        const from = anchor.path[anchor.path.length - 1];
        const to = focus.path[focus.path.length - 1];
        if (from === undefined || to === undefined || index < from || index > to) return;
        const startOffset = index === from ? anchor.offset : 0;
        const endOffset = index === to ? focus.offset : node.text.length;
        if (startOffset >= endOffset) return;
        const decorated: DecoratedRange & {
          commentIds: string;
          commentRange: true;
          commentOrphan?: true;
        } = {
          anchor: { offset: startOffset, path },
          commentIds: ids.join(","),
          commentRange: true,
          focus: { offset: endOffset, path },
        };
        if (orphan) decorated.commentOrphan = true;
        decorations.push(decorated);
      };
      for (const range of scan.ranges) {
        clip(range.anchor, range.focus, range.ids, false);
      }
      if (scan.unpairedIds.length > 0) {
        const start = editor.api.start(parentPath);
        const end = editor.api.end(parentPath);
        if (start && end) clip(start, end, scan.unpairedIds, true);
      }
      return decorations.length > 0 ? decorations : undefined;
    },
  }).withComponent(CommentRangeLeaf),

  createPlatePlugin({
    key: "commentCreate",
    render: { afterEditable: () => <CommentCreateHost /> },
  }).extend(() => ({
    handlers: {
      onKeyDown: ({ editor, event }) => {
        if (!isHotkey("mod+shift+a", event)) return;
        if (editor.api.some({ match: { type: [editor.getType(KEYS.codeBlock)] } })) return;
        if (beginCreate(editor)) {
          event.preventDefault();
        }
      },
    },
  })),
];
