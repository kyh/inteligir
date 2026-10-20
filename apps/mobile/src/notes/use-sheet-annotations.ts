import { useEffect, useState } from "react";
import type { EditorPorts } from "@/editor/editor-ports";
import { readNote, readNoteAnnotations } from "@/lib/app-runtime";
import { NOTE_GONE } from "./annotation-ops";
import type { AnnotationOutcome } from "./annotation-ops";
import type { AnnotationEdits } from "./annotations-view";
import type { AnnotationsRead } from "./notes-store";

// the sheet is open on every thread of the note, or on the ones a tap in the page named
export interface SheetRequest {
  readonly ids: readonly string[] | null;
}

interface SheetAnnotations {
  // null until the read for this opening answers
  readonly annotations: AnnotationsRead | null;
  readonly edits: AnnotationEdits;
}

// the note's annotations, folded against the markers its text holds now
const loadAnnotations = async (path: string): Promise<AnnotationsRead> => {
  const read = await readNote(path);
  return read.ok ? await readNoteAnnotations(read) : { message: read.message, ok: false };
};

// The annotations sheet's threads, read each time it opens, and its edits. The request stays the
// screen's state: the editor's ports are made with the callback that opens the sheet, and these
// edits go through those same ports.
export const useSheetAnnotations = (
  sheet: SheetRequest | null,
  opened: string | null,
  verbs: EditorPorts["annotations"],
): SheetAnnotations => {
  const [annotations, setAnnotations] = useState<AnnotationsRead | null>(null);

  useEffect(() => {
    if (sheet === null || opened === null) {
      return;
    }
    let live = true;
    void (async () => {
      const threads = await loadAnnotations(opened);
      if (live) {
        setAnnotations(threads);
      }
    })();
    return () => {
      live = false;
      setAnnotations(null);
    };
  }, [sheet, opened]);

  // an edit is on the phone once it answers, so the sheet reads the store again in place rather
  // than going back to Loading under the field being typed in
  const editAnnotations = async (
    change: (path: string) => Promise<AnnotationOutcome>,
  ): Promise<AnnotationOutcome> => {
    if (opened === null) {
      return { kind: "refused", message: NOTE_GONE };
    }
    const outcome = await change(opened);
    if (outcome.kind === "done") {
      setAnnotations(await loadAnnotations(opened));
    }
    return outcome;
  };
  const edits: AnnotationEdits = {
    note: async (rootId, text) =>
      await editAnnotations(async (notePath) => await verbs.edit(notePath, rootId, text)),
    reply: async (rootId, text) =>
      await editAnnotations(async (notePath) => await verbs.reply(notePath, rootId, text)),
    remove: async (rootId) =>
      await editAnnotations(async (notePath) => {
        const removed = await verbs.remove(notePath, rootId);
        return removed.kind === "done" ? { kind: "done" } : removed;
      }),
  };

  return { annotations, edits };
};
