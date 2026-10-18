import { useEffect, useRef, useState } from "react";
import { KEYS, RangeApi } from "platejs";
import type { DecoratedRange, SlateEditor } from "platejs";
import { PlateLeaf, createPlatePlugin } from "platejs/react";
import type { PlateLeafProps } from "platejs/react";

import { editorShortcutFor } from "@repo/editor/editor-shortcuts";
import type { EditorShortcut } from "@repo/editor/editor-shortcuts";
import { getEditorHostActions } from "@repo/editor/host-io";
import { selectionEdgeLocked } from "@repo/editor/kits/rich-block-lock-kit";
import { liveEditorPath } from "@repo/editor/live-editor";
import { stringProp } from "@repo/editor/node-props";
import { useOpenNotePath } from "@repo/editor/note/open-note-context";
import { revealCentered } from "@repo/editor/scroll-reveal";
import { cn } from "@repo/ui/lib/cn";
import { isImeComposing } from "@repo/ui/lib/ime";
import { Popover, PopoverContent } from "@repo/ui/components/popover";
import { Textarea } from "@repo/ui/components/textarea";
import { clipQuote, mintAnnotationId } from "@repo/notes/annotations/store-schema";
import { splitMarkerIds } from "@repo/notes/markdown/remark-inline-constructs";

import { annotationMarkerIds, annotationSpans, isAnnotationMarker } from "./annotation-ranges";
import {
  findAnnotationMarker,
  insertAnnotationMarkers,
  removeAnnotationMarkers,
} from "./annotation-markers";
import {
  clearPendingNote,
  setPendingNote,
  useAnnotationMeta,
  useAnnotationSurface,
} from "./annotation-store";
import type { AnchorRect } from "./annotation-store";

// exported alone as well: the empty Annotations tab says how to make the first one
export const HIGHLIGHT_SHORTCUT: EditorShortcut<"highlight"> = {
  action: "highlight",
  hotkey: "mod+shift+h",
  label: "Highlight",
};

export const ANNOTATION_SHORTCUTS: readonly EditorShortcut<"highlight">[] = [HIGHLIGHT_SHORTCUT];

const rangeClassName = (state: { orphan: boolean; unknown: boolean }): string =>
  state.orphan || state.unknown
    ? "underline decoration-ink-3 decoration-dotted underline-offset-2"
    : "bg-highlight hover:bg-highlight-hover";

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

// the selection's text, a block per line: what a highlight records it was made on
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

// A marker inside a code block is literal text there, and one inside a locked block never lands,
// so no highlight anchors in either; a selection with no text (an image alone) has nothing to
// quote, so it offers no Highlight either.
export const selectionTakesHighlight = (editor: SlateEditor): boolean =>
  editor.selection !== null &&
  !RangeApi.isCollapsed(editor.selection) &&
  !editor.api.some({ match: { type: [editor.getType(KEYS.codeBlock)] } }) &&
  !selectionEdgeLocked(editor) &&
  selectionQuote(editor) !== "";

const markersOf = (editor: SlateEditor, id: string): number =>
  [
    ...editor.api.nodes({
      at: [],
      match: (node) => isAnnotationMarker(node) && annotationMarkerIds(node).includes(id),
    }),
  ].length;

// The new highlight's id, its markers around the selection; null when there is nothing to anchor.
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

export interface HighlightStarted {
  readonly id: string;
  readonly path: string;
  // the host's answer to the highlight's own entry; a refusal has already stripped the markers
  readonly created: Promise<boolean>;
}

// the host's answer to a highlight's bare entry; a refusal, or a host that threw, strips its markers
const askForEntry = async (editor: SlateEditor, id: string, quote: string): Promise<boolean> => {
  let ok = false;
  try {
    ok = await getEditorHostActions().annotations.create(id, quote);
  } catch {
    ok = false;
  }
  if (!ok) {
    removeAnnotationMarkers(editor, [id]);
  }
  return ok;
};

// CLAUDE.md § AN ANNOTATION IS A HIGHLIGHT FIRST AND A NOTE SECOND: the one gesture every surface
// makes (the chord, the selection toolbar, the touch toolbar). It mints the markers and at once
// asks the host for the bare entry, its quote the selection's text clipped as every writer clips
// one, so a long selection is a highlight with a clipped quote, never a refusal. A refused entry
// takes its markers back out, so no highlight is left that the store does not hold.
export const highlightSelection = (editor: SlateEditor): HighlightStarted | null => {
  const path = liveEditorPath(editor);
  if (path === null || !selectionTakesHighlight(editor)) {
    return null;
  }
  const quote = clipQuote(selectionQuote(editor));
  const id = anchorNewAnnotation(editor);
  if (id === null) {
    return null;
  }
  return { created: askForEntry(editor, id, quote), id, path };
};

// the note on a highlight just made: written once its entry is, and dropped when it was refused
export const noteHighlight = async (started: Promise<boolean>, id: string, text: string) => {
  const trimmed = text.trim();
  if (trimmed === "" || !(await started)) {
    return false;
  }
  try {
    return await getEditorHostActions().annotations.edit(id, trimmed);
  } catch {
    return false;
  }
};

const selectionRect = (): AnchorRect => {
  const domSelection = window.getSelection();
  const rect =
    domSelection !== null && domSelection.rangeCount > 0
      ? domSelection.getRangeAt(0).getBoundingClientRect()
      : null;
  return rect === null
    ? { bottom: 120, height: 20, left: 120, right: 120, top: 100, width: 0 }
    : {
        bottom: rect.bottom,
        height: rect.height,
        left: rect.left,
        right: rect.right,
        top: rect.top,
        width: rect.width,
      };
};

// a refused highlight has no entry for a note to land on, so its popover goes with its markers
const closeWhenRefused = async (started: HighlightStarted): Promise<void> => {
  if (!(await started.created)) {
    clearPendingNote(started.id);
  }
};

// slate-react reads a selection the mouse made on a throttle, so a chord pressed the moment the
// drag ends would act on the caret its mousedown left: the chord takes the page's own selection
// first, when it lies in this editor
const syncDomSelection = (editor: SlateEditor): void => {
  const dom = window.getSelection();
  if (dom === null || dom.rangeCount === 0 || dom.isCollapsed) {
    return;
  }
  const range = editor.api.toSlateRange(dom, { exactMatch: false, suppressThrow: true });
  if (range !== null && range !== undefined) {
    editor.tf.select(range);
  }
};

// the desktop's gesture: the highlight, then the note popover on its range
export const beginHighlight = (editor: SlateEditor): boolean => {
  const rect = selectionRect();
  const started = highlightSelection(editor);
  if (started === null) {
    return false;
  }
  setPendingNote({ created: started.created, id: started.id, path: started.path, rect });
  void closeWhenRefused(started);
  return true;
};

const AnnotationNoteHost = () => {
  const notePath = useOpenNotePath();
  const armed = useAnnotationSurface((state) => state.pendingNote);
  const [text, setText] = useState("");
  const fieldRef = useRef<HTMLTextAreaElement | null>(null);

  // drawn only over the item that made the highlight, so the note lands on the entry it names
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

  // Escape or a click away keeps the bare highlight: the note is what is optional
  const dismiss = (): void => {
    clearPendingNote(pending.id);
  };

  const save = (): void => {
    const { created, id } = pending;
    clearPendingNote(id);
    void noteHighlight(created, id, text);
  };

  // a virtual anchor: the selection's box is what the markers were minted around, and the
  // selection itself is gone once the field takes focus
  const anchor = { getBoundingClientRect: () => DOMRect.fromRect(pending.rect) };
  return (
    <Popover
      open
      onOpenChange={(open) => {
        if (!open) {
          dismiss();
        }
      }}
    >
      <PopoverContent anchor={anchor} side="bottom" align="start" className="w-72 gap-1.5 p-2">
        <Textarea
          ref={fieldRef}
          aria-label="Note"
          placeholder="Add a note…"
          value={text}
          rows={2}
          className="resize-none"
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
        <p className="px-1 text-caption text-muted-foreground">
          Return saves the note. The highlight stays either way.
        </p>
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
    if (dom !== undefined) {
      revealCentered(dom);
    }
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
    key: "annotationNote",
    render: { afterEditable: () => <AnnotationNoteHost /> },
  }).extend(() => ({
    handlers: {
      onKeyDown: ({ editor, event }) => {
        if (editorShortcutFor(ANNOTATION_SHORTCUTS, event)?.action !== "highlight") {
          return;
        }
        syncDomSelection(editor);
        if (beginHighlight(editor)) {
          event.preventDefault();
        }
      },
    },
  })),
];
