// The open item's highlights, as the replica holds them: each one's passage, its note and its
// replies, newest first. A note is edited in place and saved on Return or when the field lets go,
// a reply added under it, and Remove takes the highlight out, each one write through the outbox
// over the text it read, so another device's note on the same highlight is never written over.

import {
  HIGHLIGHT_SHORTCUT,
  scrollToAnnotationMarker,
} from "@repo/editor/annotations/annotation-kit";
import { getLiveEditor } from "@repo/editor/live-editor";
import type { AnnotationEntry } from "@repo/notes/annotations/store-schema";
import { mintAnnotationId } from "@repo/notes/annotations/store-schema";
import { Button } from "@repo/ui/components/button";
import { Textarea } from "@repo/ui/components/textarea";
import { spellHotkey, platformShortcutModifier } from "@repo/ui/lib/hotkey-spelling";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { useReplica, useReplicaQueries } from "../cloud/library-context";

interface Highlight {
  readonly id: string;
  readonly entry: AnnotationEntry;
  readonly replies: readonly (readonly [string, AnnotationEntry])[];
}

const highlightsOf = (store: Readonly<Record<string, AnnotationEntry>>): Highlight[] => {
  const entries = Object.entries(store);
  return entries
    .filter(([, entry]) => entry.parentId === undefined)
    .map(([id, entry]) => ({
      entry,
      id,
      replies: entries
        .filter(([, reply]) => reply.parentId === id)
        .toSorted(([, a], [, b]) => a.createdAt - b.createdAt),
    }))
    .toSorted((a, b) => b.entry.createdAt - a.entry.createdAt);
};

const nowSeconds = (): number => Math.floor(Date.now() / 1000);

const NoteField = ({
  text,
  onSave,
  label,
}: {
  text: string;
  onSave: (next: string) => void;
  label: string;
}) => {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = (): void => {
    if (draft !== null && draft.trim() !== text) {
      onSave(draft.trim());
    }
    setDraft(null);
  };
  return (
    <Textarea
      aria-label={label}
      rows={2}
      className="resize-none"
      placeholder="Add a note…"
      value={draft ?? text}
      onChange={(event) => {
        setDraft(event.target.value);
      }}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter" && !event.shiftKey) {
          event.preventDefault();
          commit();
        }
      }}
    />
  );
};

export const AnnotationsTab = ({ itemId }: { itemId: string }) => {
  const replica = useReplica();
  const store = useQuery(useReplicaQueries().annotations(itemId)).data;
  const highlights = store === undefined ? [] : highlightsOf(store);
  const write = (annotations: Parameters<typeof replica.write>[1]["annotations"]): void => {
    void replica.write(itemId, { annotations, ops: [] });
  };
  if (highlights.length === 0) {
    return (
      <p className="m-0 p-3 text-body text-muted-foreground">
        Select a passage and press{" "}
        {spellHotkey(HIGHLIGHT_SHORTCUT.hotkey, platformShortcutModifier())} to highlight it.
      </p>
    );
  }
  return (
    <ul className="m-0 flex list-none flex-col gap-3 p-3">
      {highlights.map(({ entry, id, replies }) => (
        <li
          key={id}
          data-annotation-id={id}
          className="flex flex-col gap-2 rounded-md border border-border p-2.5"
        >
          {entry.quote === undefined ? null : (
            <button
              type="button"
              className="border-l-2 border-highlight pl-2 text-left text-body text-ink-2 select-text"
              onClick={() => {
                const editor = getLiveEditor(itemId);
                if (editor !== null) {
                  scrollToAnnotationMarker(editor, id);
                }
              }}
            >
              {entry.quote}
            </button>
          )}
          <NoteField
            label="Note"
            text={entry.text}
            onSave={(text) => {
              write([{ base: entry.text, id, op: "note", text }]);
            }}
          />
          {replies.map(([replyId, reply]) => (
            <p key={replyId} className="m-0 pl-3 text-body text-ink-2 select-text">
              {reply.text}
            </p>
          ))}
          <div className="flex gap-1.5">
            <NoteField
              label="Reply"
              text=""
              onSave={(text) => {
                if (text !== "") {
                  write([
                    {
                      createdAt: nowSeconds(),
                      id: mintAnnotationId((length) =>
                        crypto.getRandomValues(new Uint8Array(length)),
                      ),
                      occurrence: null,
                      op: "add",
                      parentId: id,
                      quote: null,
                      text,
                    },
                  ]);
                }
              }}
            />
          </div>
          <Button
            size="compact"
            variant="ghost"
            className="self-start"
            onClick={() => {
              write([{ base: entry.text, id, op: "remove" }]);
            }}
          >
            Remove highlight
          </Button>
        </li>
      ))}
    </ul>
  );
};
