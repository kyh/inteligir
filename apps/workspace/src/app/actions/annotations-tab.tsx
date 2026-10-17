import {
  HIGHLIGHT_SHORTCUT,
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
import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent, ReactNode } from "react";

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

const UNANCHORED_GROUPS = [
  { label: "Waiting for the page's text", state: "waiting" },
  { label: "No longer in the text", state: "missing" },
] as const;

// Enter commits, Shift+Enter breaks the line, and an IME candidate's Enter is the candidate's
const submitsOn = (event: KeyboardEvent<HTMLTextAreaElement>, submit: () => void): void => {
  if (isImeComposing(event)) {
    return;
  }
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    submit();
  }
};

const EntryByline = ({ entry, asOfMs }: { entry: AnnotationEntryWire; asOfMs: number }) => (
  <div className="flex items-baseline gap-2 text-caption text-muted-foreground">
    <span className="font-medium text-foreground/80">{annotationSourceLabel(entry.source)}</span>
    <span>{relativeTimeLabel(entryTimeMs(entry), asOfMs)}</span>
  </div>
);

// the highlighted words themselves: the live passage between the markers, else what was quoted
const Passage = ({ text, onJump }: { text: string; onJump: (() => void) | null }) => {
  const words = (
    <span className="rounded-[2px] bg-highlight box-decoration-clone px-0.5 text-subtitle whitespace-pre-wrap text-ink">
      {text}
    </span>
  );
  return onJump === null ? (
    <p className="px-2 pt-2">{words}</p>
  ) : (
    <button
      type="button"
      aria-label="Show this highlight in the item"
      className="block w-full px-2 pt-2 text-left"
      onClick={onJump}
    >
      {words}
    </button>
  );
};

// the root's note, edited in place: a click opens the field, Return saves and Escape keeps it
const NoteField = ({
  text,
  busy,
  onSave,
}: {
  text: string;
  busy: boolean;
  onSave: (text: string) => void;
}) => {
  const [draft, setDraft] = useState<string | null>(null);
  // an Escape's unmount may still blur the field, which must not save what Escape dropped
  const settled = useRef(false);
  if (draft === null) {
    return (
      <button
        type="button"
        className={cn(
          "block w-full rounded-md px-2 py-1 text-left text-subtitle whitespace-pre-wrap hover:bg-hover",
          text === "" && "text-muted-foreground",
        )}
        aria-label={text === "" ? "Add a note" : "Edit the note"}
        disabled={busy}
        onClick={() => {
          settled.current = false;
          setDraft(text);
        }}
      >
        {text === "" ? "Add a note…" : text}
      </button>
    );
  }
  const commit = (): void => {
    if (settled.current) {
      return;
    }
    settled.current = true;
    const next = draft.trim();
    setDraft(null);
    if (next !== text) {
      onSave(next);
    }
  };
  return (
    <div className="px-1.5 py-1">
      <Textarea
        autoFocus
        aria-label="Note"
        placeholder="Add a note…"
        value={draft}
        rows={2}
        className="resize-none text-subtitle"
        onChange={(event) => {
          setDraft(event.target.value);
        }}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            settled.current = true;
            setDraft(null);
            return;
          }
          submitsOn(event, commit);
        }}
      />
    </div>
  );
};

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
  const [reply, setReply] = useState("");
  const cardRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (focusNonce !== null) {
      cardRef.current?.scrollIntoView({ block: "nearest" });
    }
  }, [focusNonce]);

  const jump = (): void => {
    const editor = getLiveEditor(docPath);
    if (editor === null || !scrollToAnnotationMarker(editor, annotation.id)) {
      toast.warning("This highlight is not in the open item's text.");
    }
  };

  // re-read after every verb, refusal included: a failed write otherwise shows a state the file never took.
  const settle = {
    onError: (cause: unknown): void => {
      failed(cause, "The highlight change was refused.");
    },
    onSettled: onDone,
  };

  const edit = useMutation(orpc.annotations.edit.mutationOptions({ ...settle }));
  const sendReply = useMutation(orpc.annotations.reply.mutationOptions({ ...settle }));
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
  const busy = edit.isPending || sendReply.isPending || remove.isPending;

  const submitReply = (): void => {
    const text = reply.trim();
    if (text === "" || busy) {
      return;
    }
    sendReply.mutate(
      {
        id: mintAnnotationId((length) => crypto.getRandomValues(new Uint8Array(length))),
        parentId: annotation.id,
        path: docPath,
        text,
      },
      {
        onSuccess: () => {
          setReply("");
        },
      },
    );
  };

  const words = annotation.passage ?? annotation.quote;
  const anchored = annotation.state === "anchored";

  return (
    <div
      ref={cardRef}
      data-annotation-id={annotation.id}
      className={cn(
        "mb-2 rounded-lg border border-line bg-surface-raised",
        focusNonce !== null && "ring-2 ring-highlight-hover",
      )}
    >
      {words === null || words === "" ? null : (
        <Passage text={words} onJump={anchored ? jump : null} />
      )}
      <div className="px-0.5 pt-1">
        <NoteField
          text={annotation.root.text}
          busy={busy}
          onSave={(text) => {
            edit.mutate({ id: annotation.id, path: docPath, text });
          }}
        />
      </div>
      <div className="px-2 pb-1">
        <EntryByline entry={annotation.root} asOfMs={asOfMs} />
      </div>
      {annotation.replies.map((row) => (
        <div key={row.id} className="border-t border-line/60 px-2 py-1 pl-4">
          <EntryByline entry={row.entry} asOfMs={asOfMs} />
          <p className="text-subtitle whitespace-pre-wrap">{row.entry.text}</p>
        </div>
      ))}
      <div className="flex items-center gap-1 border-t border-line/60 p-1.5">
        <Textarea
          aria-label="Reply"
          placeholder="Reply…"
          value={reply}
          rows={1}
          className="max-h-24 min-h-8 flex-1 resize-none text-subtitle"
          onChange={(event) => {
            setReply(event.target.value);
          }}
          onKeyDown={(event) => {
            submitsOn(event, submitReply);
          }}
        />
        <Button
          size="compact"
          variant="ghost"
          disabled={busy}
          onClick={() => {
            // the open editor strips the markers itself, under its own save; with none open (a
            // saved page shown as its copy) the server strips them under its compare-and-swap
            remove.mutate({
              id: annotation.id,
              path: docPath,
              stripMarkers: getLiveEditor(docPath) === null,
            });
          }}
        >
          {anchored ? "Remove highlight" : "Remove"}
        </Button>
      </div>
    </div>
  );
};

const Group = ({ label, children }: { label: string; children: ReactNode }) => (
  <section aria-label={label}>
    <p className="px-1 pt-3 pb-1 text-caption font-medium text-muted-foreground uppercase">
      {label}
    </p>
    {children}
  </section>
);

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
    return (
      <p className="p-3 text-subtitle text-muted-foreground">Open an item to see its highlights.</p>
    );
  }
  if (query.isError) {
    return <ReadRefusal lead="The highlights could not be read." error={query.error} />;
  }
  const { data } = query;
  if (data === undefined) {
    return <p className="p-3 text-subtitle text-muted-foreground">Loading…</p>;
  }

  const refresh = (): void => {
    void queryClient.invalidateQueries({ queryKey: orpc.annotations.key() });
  };

  const card = (annotation: AnnotationWire) => (
    <AnnotationCard
      key={annotation.id}
      docPath={docPath}
      annotation={annotation}
      focusNonce={focus !== null && focus.ids.includes(annotation.id) ? focus.nonce : null}
      onDone={refresh}
      asOfMs={asOfMs}
    />
  );

  // the server lists the anchored ones in the text's order, then the rest by when they were made
  const anchored = data.annotations.filter((annotation) => annotation.state === "anchored");

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-2">
      {data.annotations.length === 0 ? (
        <p className="p-1 text-subtitle text-muted-foreground">
          No highlights yet. Select text and press{" "}
          {spellHotkey(HIGHLIGHT_SHORTCUT.hotkey, modifier)}.
        </p>
      ) : null}
      {anchored.map(card)}
      {UNANCHORED_GROUPS.map(({ label, state }) => {
        const rows = data.annotations.filter((annotation) => annotation.state === state);
        return rows.length === 0 ? null : (
          <Group key={state} label={label}>
            {rows.map(card)}
          </Group>
        );
      })}
      {data.total > data.annotations.length ? (
        <p className="px-1 pt-2 text-caption text-muted-foreground">
          Showing the first {data.annotations.length} of {data.total} highlights.
        </p>
      ) : null}
    </div>
  );
};
