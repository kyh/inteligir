import {
  ADD_ANNOTATION_SHORTCUT,
  scrollToAnnotationMarker,
} from "@repo/editor/annotations/annotation-kit";
import { removeAnnotationMarkers } from "@repo/editor/annotations/annotation-markers";
import { getLiveEditor } from "@repo/editor/live-editor";
import { flushOpenNote } from "@repo/editor/note/open-note-flush";
import type {
  AnnotationEntryWire,
  AnnotationWire,
} from "@repo/contract/local/annotations/annotations-schema";
import { annotationSourceLabel, mintAnnotationId } from "@repo/notes/annotations/store-schema";
import { Button } from "@repo/ui/components/button";
import { Textarea } from "@repo/ui/components/textarea";
import { toast } from "@repo/ui/components/sonner";
import { cn } from "@repo/ui/lib/cn";
import { isImeComposing } from "@repo/ui/lib/ime";
import { spellHotkey } from "@repo/ui/lib/hotkey-spelling";
import type { ShortcutModifier } from "@repo/ui/lib/hotkey-spelling";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Trash2Icon } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { failed, orpc } from "../api";
import { relativeTimeLabel, useNow } from "../relative-time";
import { useNoteAnnotations } from "./annotation-hooks";
import { ReadRefusal } from "./read-refusal";

// the nonce tells two clicks on the same range apart, so the second one scrolls again
export interface AnnotationFocus {
  ids: readonly string[];
  nonce: number;
}

// the store stamps unix seconds; the shared label takes epoch ms.
const entryTimeMs = (entry: AnnotationEntryWire): number => entry.createdAt * 1000;

const AnnotationRow = ({
  id,
  entry,
  asOfMs,
}: {
  id: string;
  entry: AnnotationEntryWire;
  asOfMs: number;
}) => (
  <div key={id} className="px-2 py-1">
    <div className="flex items-baseline gap-2 text-caption text-muted-foreground">
      <span className="font-medium text-foreground/80">{annotationSourceLabel(entry.source)}</span>
      <span>{relativeTimeLabel(entryTimeMs(entry), asOfMs)}</span>
    </div>
    {entry.quote === undefined ? null : (
      <p className="border-l-2 border-amber-400/60 pl-2 text-subtitle text-muted-foreground whitespace-pre-wrap">
        {entry.quote}
      </p>
    )}
    {entry.text === "" ? null : <p className="text-subtitle whitespace-pre-wrap">{entry.text}</p>}
  </div>
);

const AnnotationCard = ({
  docPath,
  annotation,
  focusNonce,
  onDone,
  asOfMs,
}: {
  docPath: string;
  annotation: AnnotationWire;
  // the nonce of the focus naming this card, null while none does
  focusNonce: number | null;
  onDone: () => void;
  asOfMs: number;
}) => {
  const [draft, setDraft] = useState("");
  const cardRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (focusNonce !== null) {
      cardRef.current?.scrollIntoView({ block: "nearest" });
    }
  }, [focusNonce]);

  const jump = (): void => {
    const editor = getLiveEditor(docPath);
    if (editor === null || !scrollToAnnotationMarker(editor, annotation.id)) {
      toast.warning("This comment's range is not in the open note.");
    }
  };

  // re-read after every verb, refusal included: a failed write otherwise shows a state the file never took.
  const settle = {
    onError: (cause: unknown): void => {
      failed(cause, "The comment change was refused.");
    },
    onSettled: onDone,
  };

  const reply = useMutation(orpc.annotations.reply.mutationOptions({ ...settle }));
  const remove = useMutation(
    orpc.annotations.remove.mutationOptions({
      ...settle,
      onSuccess: async (response) => {
        const editor = getLiveEditor(docPath);
        if (editor !== null && response.removedIds.length > 0) {
          removeAnnotationMarkers(editor, response.removedIds);
          await flushOpenNote();
        }
      },
    }),
  );
  const busy = reply.isPending || remove.isPending;

  const sendReply = (): void => {
    const text = draft.trim();
    if (text === "" || busy) {
      return;
    }
    reply.mutate(
      {
        id: mintAnnotationId((length) => crypto.getRandomValues(new Uint8Array(length))),
        parentId: annotation.id,
        path: docPath,
        text,
      },
      {
        onSuccess: () => {
          setDraft("");
        },
      },
    );
  };

  return (
    <div
      ref={cardRef}
      className={cn(
        "mb-2 rounded-lg border border-line bg-surface-raised",
        focusNonce !== null && "ring-2 ring-amber-400/60",
      )}
    >
      <button type="button" className="w-full text-left" onClick={jump}>
        <AnnotationRow id={annotation.id} entry={annotation.root} asOfMs={asOfMs} />
      </button>
      {annotation.replies.map((row) => (
        <div key={row.id} className="border-t border-line/60 pl-3">
          <AnnotationRow id={row.id} entry={row.entry} asOfMs={asOfMs} />
        </div>
      ))}
      {annotation.state === "anchored" ? null : (
        <p className="px-2 pb-1 text-caption text-amber-600">No marker in the note body.</p>
      )}
      <div className="flex items-center gap-1 border-t border-line/60 p-1.5">
        <Textarea
          aria-label="Reply to comment"
          placeholder="Reply…"
          value={draft}
          rows={1}
          className="max-h-24 min-h-8 flex-1 resize-none text-subtitle"
          onChange={(event) => {
            setDraft(event.target.value);
          }}
          onKeyDown={(event) => {
            if (isImeComposing(event)) {
              return;
            }
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              sendReply();
            }
          }}
        />
        <Button
          size="icon-compact"
          variant="ghost"
          aria-label="Delete comment thread"
          disabled={busy}
          onClick={() => {
            remove.mutate({ id: annotation.id, path: docPath });
          }}
        >
          <Trash2Icon />
        </Button>
      </div>
    </div>
  );
};

export const AnnotationsTab = ({
  docPath,
  focus,
  modifier,
}: {
  docPath: string | null;
  focus: AnnotationFocus | null;
  modifier: ShortcutModifier;
}) => {
  const queryClient = useQueryClient();
  const query = useNoteAnnotations(docPath);
  const asOfMs = useNow();

  if (docPath === null) {
    return <p className="p-3 text-subtitle text-muted-foreground">No note open.</p>;
  }
  if (query.isError) {
    return <ReadRefusal lead="The comments could not be read." error={query.error} />;
  }
  const { data } = query;
  if (data === undefined) {
    return <p className="p-3 text-subtitle text-muted-foreground">Loading…</p>;
  }

  const refresh = (): void => {
    void queryClient.invalidateQueries({ queryKey: orpc.annotations.key() });
  };

  const focusNonceFor = (annotation: AnnotationWire): number | null =>
    focus !== null && focus.ids.includes(annotation.id) ? focus.nonce : null;

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-2">
      {data.annotations.length === 0 ? (
        <p className="p-1 text-subtitle text-muted-foreground">
          No comments yet. Select text and press{" "}
          {spellHotkey(ADD_ANNOTATION_SHORTCUT.hotkey, modifier)}.
        </p>
      ) : null}
      {data.annotations.map((annotation) => (
        <AnnotationCard
          key={annotation.id}
          docPath={docPath}
          annotation={annotation}
          focusNonce={focusNonceFor(annotation)}
          onDone={refresh}
          asOfMs={asOfMs}
        />
      ))}
      {data.orphanMarkers.length > 0 ? (
        <p className="px-1 pt-2 text-caption text-amber-600">
          Markers with no comment: {data.orphanMarkers.join(", ")}
        </p>
      ) : null}
      {data.strayIds.length > 0 ? (
        <p className="px-1 pt-1 text-caption text-amber-600">
          Entries outside any thread: {data.strayIds.join(", ")}
        </p>
      ) : null}
    </div>
  );
};
