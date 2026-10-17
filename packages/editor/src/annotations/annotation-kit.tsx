import { useEffect, useRef, useState } from "react";
import { KEYS, RangeApi } from "platejs";
import type { DecoratedRange, SlateEditor } from "platejs";
import { PlateLeaf, createPlatePlugin, useEditorRef } from "platejs/react";
import type { PlateLeafProps } from "platejs/react";

import { editorShortcutFor } from "@repo/editor/editor-shortcuts";
import type { EditorShortcut } from "@repo/editor/editor-shortcuts";
import { getEditorHostActions } from "@repo/editor/host-io";
import { selectionEdgeLocked } from "@repo/editor/kits/rich-block-lock-kit";
import { liveEditorPath } from "@repo/editor/live-editor";
import { stringProp } from "@repo/editor/node-props";
import { useOpenNotePath } from "@repo/editor/note/open-note-context";
import { cn } from "@repo/ui/lib/cn";
import { isImeComposing } from "@repo/ui/lib/ime";
import { Button } from "@repo/ui/components/button";
import { Popover, PopoverContent } from "@repo/ui/components/popover";
import { Textarea } from "@repo/ui/components/textarea";
import { mintAnnotationId } from "@repo/notes/annotations/store-schema";
import { splitMarkerIds } from "@repo/notes/markdown/remark-inline-constructs";

import { annotationMarkerIds, annotationSpans, isAnnotationMarker } from "./annotation-ranges";
import {
  findAnnotationMarker,
  insertAnnotationMarkers,
  removeAnnotationMarkers,
} from "./annotation-markers";
import {
  clearPendingCreate,
  setPendingCreate,
  useAnnotationMeta,
  useAnnotationSurface,
} from "./annotation-store";

// exported alone as well: the empty Annotations tab says how to make the first one
export const ADD_ANNOTATION_SHORTCUT: EditorShortcut<"add-annotation"> = {
  action: "add-annotation",
  hotkey: "mod+shift+a",
  label: "Comment on the selection",
};

export const ANNOTATION_SHORTCUTS: readonly EditorShortcut<"add-annotation">[] = [
  ADD_ANNOTATION_SHORTCUT,
];

const rangeClassName = (state: { orphan: boolean; unknown: boolean }): string =>
  state.orphan || state.unknown
    ? "bg-amber-500/10 underline decoration-amber-500/50 decoration-dotted underline-offset-2"
    : "bg-amber-300/20 hover:bg-amber-300/30";

type AnnotationDecoration = DecoratedRange & {
  annotationIds: string;
  annotationRange: true;
  annotationOrphan?: true;
};

const AnnotationRangeLeaf = (props: PlateLeafProps) => {
  const ids = splitMarkerIds(stringProp(props.leaf, "annotationIds") ?? "");
  const orphan = props.leaf.annotationOrphan === true;
  const notePath = useOpenNotePath();
  const { knownIds } = useAnnotationMeta(notePath);
  const unknown = ids.length > 0 && ids.every((id) => !knownIds.has(id));
  return (
    <PlateLeaf
      {...props}
      as="span"
      className={cn(
        "cursor-pointer rounded-[2px]",
        rangeClassName({ orphan, unknown }),
        "print:bg-transparent print:no-underline",
      )}
      attributes={{
        ...props.attributes,
        onClick: () => {
          if (ids.length > 0) {
            getEditorHostActions().annotations.open(ids);
          }
        },
      }}
    >
      {props.children}
    </PlateLeaf>
  );
};

// a marker inside a code block is literal text there, and one inside a locked block never lands,
// so no annotation anchors in either
export const selectionTakesAnnotation = (editor: SlateEditor): boolean =>
  editor.selection !== null &&
  !RangeApi.isCollapsed(editor.selection) &&
  !editor.api.some({ match: { type: [editor.getType(KEYS.codeBlock)] } }) &&
  !selectionEdgeLocked(editor);

// the selection's text, a block per line: what an annotation records it was made on
export const selectionQuote = (editor: SlateEditor): string => {
  const { selection } = editor;
  if (selection === null) {
    return "";
  }
  const lines: string[] = [];
  for (const [, path] of editor.api.blocks({ at: selection, mode: "lowest" })) {
    const block = editor.api.range(path);
    const within = block === undefined ? null : RangeApi.intersection(selection, block);
    if (within !== null) {
      lines.push(editor.api.string(within));
    }
  }
  return lines.join("\n").trim();
};

const markersOf = (editor: SlateEditor, id: string): number =>
  [
    ...editor.api.nodes({
      at: [],
      match: (node) => isAnnotationMarker(node) && annotationMarkerIds(node).includes(id),
    }),
  ].length;

// The new annotation's id, its markers around the selection; null when there is nothing to anchor.
// The touch kit's lock refuses a marker inside a locked block, so a pair missing one is taken back
// rather than left as an orphan; the one that landed sits outside any locked block.
export const anchorNewAnnotation = (editor: SlateEditor): string | null => {
  const id = mintAnnotationId((length) => crypto.getRandomValues(new Uint8Array(length)));
  if (!insertAnnotationMarkers(editor, id)) {
    return null;
  }
  if (markersOf(editor, id) < 2) {
    removeAnnotationMarkers(editor, [id]);
    return null;
  }
  return id;
};

// A Save made with its highlight: the highlight's entry first, then its note. A refused highlight
// answers false, and the caller strips the markers it minted; a refused note keeps the bare
// highlight, the host having said why.
export const saveNewAnnotation = async (
  id: string,
  quote: string,
  text: string,
): Promise<boolean> => {
  const actions = getEditorHostActions().annotations;
  if (!(await actions.create(id, quote).catch(() => false))) {
    return false;
  }
  if (text !== "") {
    await actions.edit(id, text).catch(() => false);
  }
  return true;
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
  const quote = selectionQuote(editor);
  const id = anchorNewAnnotation(editor);
  if (id === null) {
    return false;
  }
  setPendingCreate({
    id,
    path,
    quote,
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

const AnnotationCreateHost = () => {
  const editor = useEditorRef();
  const notePath = useOpenNotePath();
  const armed = useAnnotationSurface((state) => state.pendingCreate);
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
    removeAnnotationMarkers(editor, [pending.id]);
    clearPendingCreate(pending.id);
  };

  const save = (): void => {
    const trimmed = text.trim();
    if (trimmed === "" || saving) {
      return;
    }
    const { id, quote } = pending;
    setSavingId(id);
    void (async () => {
      const ok = await saveNewAnnotation(id, quote, trimmed);
      setSavingId((current) => (current === id ? null : current));
      if (!ok) {
        removeAnnotationMarkers(editor, [id]);
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

export const scrollToAnnotationMarker = (editor: SlateEditor, rootId: string): boolean => {
  const entry = findAnnotationMarker(editor, rootId);
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

export const AnnotationKit = [
  createPlatePlugin({
    // Returned for the root alone: Slate splits a root range across every block it crosses and
    // re-renders only a block whose share moved, so a range minted over three paragraphs tints
    // the untouched middle one. Returned per node, a block that did not change keeps the
    // decorations it last rendered with.
    decorate: ({ editor, entry }) => {
      if (entry[1].length > 0) {
        return;
      }
      const decorations = annotationSpans(editor).flatMap(
        ({ extent, ids, orphan }): AnnotationDecoration[] => {
          if (extent === null) {
            return [];
          }
          // the ids ride as the joined string: a decoration is compared shallowly per render
          const decorated: AnnotationDecoration = {
            ...extent,
            annotationIds: ids.join(","),
            annotationRange: true,
          };
          if (orphan) {
            decorated.annotationOrphan = true;
          }
          return [decorated];
        },
      );
      return decorations.length > 0 ? decorations : undefined;
    },
    key: "annotationRange",
    node: { isLeaf: true },
  }).withComponent(AnnotationRangeLeaf),

  createPlatePlugin({
    key: "annotationCreate",
    render: { afterEditable: () => <AnnotationCreateHost /> },
  }).extend(() => ({
    handlers: {
      onKeyDown: ({ editor, event }) => {
        if (editorShortcutFor(ANNOTATION_SHORTCUTS, event)?.action !== "add-annotation") {
          return;
        }
        if (selectionTakesAnnotation(editor) && beginCreate(editor)) {
          event.preventDefault();
        }
      },
    },
  })),
];
