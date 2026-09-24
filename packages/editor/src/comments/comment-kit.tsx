import { useEffect, useRef, useState } from "react";
import { KEYS } from "platejs";
import type { DecoratedRange, SlateEditor } from "platejs";
import { PlateLeaf, createPlatePlugin, useEditorRef } from "platejs/react";
import type { PlateLeafProps } from "platejs/react";

import { editorShortcutFor } from "@repo/editor/editor-shortcuts";
import type { EditorShortcut } from "@repo/editor/editor-shortcuts";
import { liveEditorPath } from "@repo/editor/live-editor";
import { stringProp } from "@repo/editor/node-props";
import { useOpenNotePath } from "@repo/editor/note/open-note-context";
import { cn } from "@repo/ui/lib/cn";
import { isImeComposing } from "@repo/ui/lib/ime";
import { Button } from "@repo/ui/components/button";
import { Popover, PopoverContent } from "@repo/ui/components/popover";
import { Textarea } from "@repo/ui/components/textarea";
import { mintCommentId } from "@repo/notes/comments/sidecar-schema";
import { splitMarkerIds } from "@repo/notes/markdown/remark-inline-constructs";

import { commentSpans } from "./comment-ranges";
import { findCommentMarker, insertCommentMarkers, removeCommentMarkers } from "./comment-markers";
import {
  clearPendingCreate,
  setPendingCreate,
  useCommentMeta,
  useCommentSurface,
} from "./comment-store";

// exported alone as well: the empty Comments tab says how to make the first one
export const ADD_COMMENT_SHORTCUT: EditorShortcut<"add-comment"> = {
  action: "add-comment",
  hotkey: "mod+shift+a",
  label: "Comment on the selection",
};

export const COMMENT_SHORTCUTS: readonly EditorShortcut<"add-comment">[] = [ADD_COMMENT_SHORTCUT];

const rangeClassName = (state: {
  orphan: boolean;
  resolved: boolean;
  unknown: boolean;
}): string => {
  if (state.orphan || state.unknown) {
    return "bg-amber-500/10 underline decoration-amber-500/50 decoration-dotted underline-offset-2";
  }
  if (state.resolved) {
    return "bg-emerald-500/[0.06]";
  }
  return "bg-amber-300/20 hover:bg-amber-300/30";
};

type CommentDecoration = DecoratedRange & {
  commentIds: string;
  commentRange: true;
  commentOrphan?: true;
};

const CommentRangeLeaf = (props: PlateLeafProps) => {
  const ids = splitMarkerIds(stringProp(props.leaf, "commentIds") ?? "");
  const orphan = props.leaf.commentOrphan === true;
  const actions = useCommentSurface((state) => state.actions);
  const notePath = useOpenNotePath();
  const { knownIds, resolvedIds } = useCommentMeta(notePath);
  const resolved = ids.length > 0 && ids.every((id) => resolvedIds.has(id));
  const unknown = ids.length > 0 && ids.every((id) => !knownIds.has(id));
  return (
    <PlateLeaf
      {...props}
      as="span"
      className={cn(
        "cursor-pointer rounded-[2px]",
        rangeClassName({ orphan, resolved, unknown }),
        "print:bg-transparent print:no-underline",
      )}
      attributes={{
        ...props.attributes,
        onClick: () => {
          if (ids.length > 0) {
            actions?.open(ids);
          }
        },
      }}
    >
      {props.children}
    </PlateLeaf>
  );
};

const beginCreate = (editor: SlateEditor): boolean => {
  // with no note nothing would claim the popover and the marker pair would be stranded, so refuse before minting
  const path = liveEditorPath(editor);
  if (path === null) {
    return false;
  }
  const domSelection = window.getSelection();
  const rect =
    domSelection !== null && domSelection.rangeCount > 0
      ? domSelection.getRangeAt(0).getBoundingClientRect()
      : null;
  const id = mintCommentId((length) => crypto.getRandomValues(new Uint8Array(length)));
  if (!insertCommentMarkers(editor, id)) {
    return false;
  }
  setPendingCreate({
    id,
    path,
    rect:
      rect === null
        ? { bottom: 120, height: 20, left: 120, right: 120, top: 100, width: 0 }
        : {
            bottom: rect.bottom,
            height: rect.height,
            left: rect.left,
            right: rect.right,
            top: rect.top,
            width: rect.width,
          },
  });
  return true;
};

const CommentCreateHost = () => {
  const editor = useEditorRef();
  const notePath = useOpenNotePath();
  const armed = useCommentSurface((state) => state.pendingCreate);
  const actions = useCommentSurface((state) => state.actions);
  const [text, setText] = useState("");
  // keyed by the create it saves, so a create armed meanwhile is not held by another's save
  const [savingId, setSavingId] = useState<string | null>(null);
  const fieldRef = useRef<HTMLTextAreaElement | null>(null);

  // drawn only over the note that minted it, so cancel and save act on the document holding the markers
  const pending = armed !== null && armed.path === notePath ? armed : null;
  const pendingId = pending?.id ?? null;

  // arming happens outside React, so the draft is re-keyed during render rather than from an event
  const [draftId, setDraftId] = useState(pendingId);
  if (draftId !== pendingId) {
    setDraftId(pendingId);
    setText("");
  }

  useEffect(() => {
    if (pendingId === null) {
      return;
    }
    requestAnimationFrame(() => fieldRef.current?.focus());
  }, [pendingId]);

  if (pending === null) {
    return null;
  }

  const saving = savingId === pending.id;

  // a save in flight owns the markers: its answer decides whether they stay
  const cancel = (): void => {
    if (saving) {
      return;
    }
    removeCommentMarkers(editor, [pending.id]);
    clearPendingCreate(pending.id);
  };

  const save = (): void => {
    const trimmed = text.trim();
    if (trimmed === "" || saving || actions === null) {
      return;
    }
    const { id } = pending;
    setSavingId(id);
    void (async () => {
      const ok = await actions.create(id, trimmed).catch(() => false);
      setSavingId((current) => (current === id ? null : current));
      if (!ok) {
        removeCommentMarkers(editor, [id]);
      }
      clearPendingCreate(id);
    })();
  };

  // a virtual anchor: the selection's box is what the markers were minted around, and the
  // selection itself is gone once the field takes focus
  const anchor = { getBoundingClientRect: () => DOMRect.fromRect(pending.rect) };
  return (
    <Popover
      open
      onOpenChange={(open) => {
        if (!open) {
          cancel();
        }
      }}
    >
      <PopoverContent anchor={anchor} side="bottom" align="start" className="gap-2 p-2">
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
            if (isImeComposing(event)) {
              return;
            }
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              save();
            }
          }}
        />
        <div className="flex justify-end gap-1.5">
          <Button size="compact" variant="ghost" disabled={saving} onClick={cancel}>
            Cancel
          </Button>
          <Button size="compact" disabled={saving || text.trim() === ""} onClick={save}>
            Save
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
};

export const scrollToCommentMarker = (editor: SlateEditor, rootId: string): boolean => {
  const entry = findCommentMarker(editor, rootId);
  if (entry === null) {
    return false;
  }
  try {
    const dom = editor.api.toDOMNode(entry[0]);
    dom?.scrollIntoView({ behavior: "smooth", block: "center" });
    return dom !== undefined;
  } catch {
    return false;
  }
};

export const CommentKit = [
  createPlatePlugin({
    // Returned for the root alone: Slate splits a root range across every block it crosses and
    // re-renders only a block whose share moved, so a range minted over three paragraphs tints
    // the untouched middle one. Returned per node, a block that did not change keeps the
    // decorations it last rendered with.
    decorate: ({ editor, entry }) => {
      if (entry[1].length > 0) {
        return;
      }
      const decorations = commentSpans(editor).flatMap(
        ({ extent, ids, orphan }): CommentDecoration[] => {
          if (extent === null) {
            return [];
          }
          // the ids ride as the joined string: a decoration is compared shallowly per render
          const decorated: CommentDecoration = {
            ...extent,
            commentIds: ids.join(","),
            commentRange: true,
          };
          if (orphan) {
            decorated.commentOrphan = true;
          }
          return [decorated];
        },
      );
      return decorations.length > 0 ? decorations : undefined;
    },
    key: "commentRange",
    node: { isLeaf: true },
  }).withComponent(CommentRangeLeaf),

  createPlatePlugin({
    key: "commentCreate",
    render: { afterEditable: () => <CommentCreateHost /> },
  }).extend(() => ({
    handlers: {
      onKeyDown: ({ editor, event }) => {
        if (editorShortcutFor(COMMENT_SHORTCUTS, event)?.action !== "add-comment") {
          return;
        }
        if (editor.api.some({ match: { type: [editor.getType(KEYS.codeBlock)] } })) {
          return;
        }
        if (beginCreate(editor)) {
          event.preventDefault();
        }
      },
    },
  })),
];
