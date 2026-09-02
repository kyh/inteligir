// The panel's Comments tab: every thread the open note's sidecar holds —
// open first, then resolved (collapsed behind a toggle), then the two orphan
// surfaces the model refuses to hide (markers with no entry, stray entries).
// Clicking a thread scrolls the live editor to its range.

import { scrollToCommentMarker } from "@repo/editor/comments/comment-kit";
import { removeCommentMarkers } from "@repo/editor/comments/comment-markers";
import { getLiveEditor } from "@repo/editor/live-editor";
import { flushOpenNote } from "@repo/editor/note/open-note-flush";
import type { CommentEntryWire, CommentThreadWire } from "@repo/api/local/comments/comments-schema";
import { Button } from "@repo/ui/components/button";
import { Textarea } from "@repo/ui/components/textarea";
import { toast } from "@repo/ui/components/sonner";
import { cn } from "@repo/ui/lib/utils";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CheckIcon, Trash2Icon, Undo2Icon } from "lucide-react";
import { useState } from "react";

import { orpc } from "../api";
import { relativeTimeLabel } from "../relative-time";
import { useNoteComments } from "./comment-hooks";
import { ReadRefusal } from "./read-refusal";

const SOURCE_LABELS = { agent: "Agent", external: "External", user: "Me" } as const;

function sourceLabel(entry: CommentEntryWire): string {
  return entry.source === undefined ? "—" : SOURCE_LABELS[entry.source];
}

/** The sidecar stamps unix SECONDS; the shared label speaks epoch ms. */
function entryTimeMs(entry: CommentEntryWire): number {
  return entry.createdAt * 1000;
}

function CommentRow({
  id,
  entry,
  asOfMs,
}: {
  id: string;
  entry: CommentEntryWire;
  asOfMs: number;
}) {
  return (
    <div key={id} className="px-2 py-1">
      <div className="flex items-baseline gap-2 text-[11px] text-muted-foreground">
        <span className="font-medium text-foreground/80">{sourceLabel(entry)}</span>
        <span>{relativeTimeLabel(entryTimeMs(entry), asOfMs)}</span>
      </div>
      <p className="text-sm whitespace-pre-wrap">{entry.text}</p>
    </div>
  );
}

function ThreadCard({
  docPath,
  thread,
  focused,
  onDone,
  asOfMs,
}: {
  docPath: string;
  thread: CommentThreadWire;
  focused: boolean;
  onDone: () => void;
  asOfMs: number;
}) {
  const [draft, setDraft] = useState("");

  const jump = (): void => {
    const editor = getLiveEditor(docPath);
    if (editor === null || !scrollToCommentMarker(editor, thread.rootId)) {
      toast.warning("This comment's range is not in the open note.");
    }
  };

  // Every verb re-reads the sidecar afterwards, refusal included: a failed
  // resolve leaves the card claiming a state the file never took.
  const settle = {
    onError: (): void => {
      toast.error("The comment change was refused.");
    },
    onSettled: onDone,
  };

  const reply = useMutation(orpc.comments.reply.mutationOptions({ ...settle }));
  const resolve = useMutation(orpc.comments.resolve.mutationOptions({ ...settle }));
  const remove = useMutation(
    orpc.comments.remove.mutationOptions({
      ...settle,
      // The route owns the sidecar; the markers are the editor's to strip.
      onSuccess: async (response) => {
        const editor = getLiveEditor(docPath);
        if (editor !== null && response.removedIds.length > 0) {
          removeCommentMarkers(editor, response.removedIds);
          await flushOpenNote();
        }
      },
    }),
  );
  const busy = reply.isPending || resolve.isPending || remove.isPending;

  const sendReply = (): void => {
    const text = draft.trim();
    if (text === "" || busy) return;
    reply.mutate(
      {
        id: `${thread.rootId}-r${String(Date.now() % 100_000)}`,
        parentId: thread.rootId,
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

  const setResolved = (resolved: boolean): void => {
    resolve.mutate({ id: thread.rootId, path: docPath, resolved });
  };

  return (
    <div
      className={cn(
        "mb-2 rounded-lg border border-line bg-surface-raised",
        thread.resolved && "opacity-70",
        focused && "ring-2 ring-amber-400/60",
      )}
    >
      <button type="button" className="w-full text-left" onClick={jump}>
        <CommentRow id={thread.rootId} entry={thread.root} asOfMs={asOfMs} />
      </button>
      {thread.replies.map((row) => (
        <div key={row.id} className="border-t border-line/60 pl-3">
          <CommentRow id={row.id} entry={row.entry} asOfMs={asOfMs} />
        </div>
      ))}
      {!thread.anchored ? (
        <p className="px-2 pb-1 text-[11px] text-amber-600">No marker in the note body.</p>
      ) : null}
      <div className="flex items-center gap-1 border-t border-line/60 p-1.5">
        <Textarea
          aria-label="Reply to comment"
          placeholder="Reply…"
          value={draft}
          rows={1}
          className="max-h-24 min-h-8 flex-1 resize-none text-sm"
          onChange={(event) => {
            setDraft(event.target.value);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              sendReply();
            }
          }}
        />
        {thread.resolved ? (
          <Button
            size="icon-compact"
            variant="ghost"
            aria-label="Reopen comment"
            disabled={busy}
            onClick={() => {
              setResolved(false);
            }}
          >
            <Undo2Icon />
          </Button>
        ) : (
          <Button
            size="icon-compact"
            variant="ghost"
            aria-label="Resolve comment"
            disabled={busy}
            onClick={() => {
              setResolved(true);
            }}
          >
            <CheckIcon />
          </Button>
        )}
        <Button
          size="icon-compact"
          variant="ghost"
          aria-label="Delete comment thread"
          disabled={busy}
          onClick={() => {
            remove.mutate({ id: thread.rootId, path: docPath });
          }}
        >
          <Trash2Icon />
        </Button>
      </div>
    </div>
  );
}

export function CommentsTab({
  docPath,
  focusIds,
}: {
  docPath: string | null;
  focusIds: readonly string[];
}) {
  const queryClient = useQueryClient();
  const query = useNoteComments(docPath);
  const [showResolved, setShowResolved] = useState(false);

  if (docPath === null) {
    return <p className="p-3 text-sm text-muted-foreground">No note open.</p>;
  }
  // A refused read is a FAILURE, not a slow one: without this arm a malformed
  // sidecar renders "Loading…" forever.
  if (query.isError) {
    return <ReadRefusal lead="The comments could not be read." error={query.error} />;
  }
  const data = query.data;
  if (data === undefined) {
    return <p className="p-3 text-sm text-muted-foreground">Loading…</p>;
  }

  const refresh = (): void => {
    void queryClient.invalidateQueries({ queryKey: orpc.comments.key() });
  };

  const open = data.threads.filter((thread) => !thread.resolved);
  const resolved = data.threads.filter((thread) => thread.resolved);
  // Ages as of the sidecar read on screen, not of whatever render drew it:
  // reading the clock during render is impure, and every verb below re-reads
  // the sidecar, so this stamp moves whenever a comment does.
  const asOfMs = query.dataUpdatedAt;

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-2">
      {open.length === 0 && resolved.length === 0 ? (
        <p className="p-1 text-sm text-muted-foreground">
          No comments yet. Select text and press ⌘⇧A.
        </p>
      ) : null}
      {open.map((thread) => (
        <ThreadCard
          key={thread.rootId}
          docPath={docPath}
          thread={thread}
          focused={focusIds.includes(thread.rootId)}
          onDone={refresh}
          asOfMs={asOfMs}
        />
      ))}
      {resolved.length > 0 ? (
        <button
          type="button"
          className="mb-1 px-1 text-xs text-muted-foreground hover:text-foreground"
          onClick={() => {
            setShowResolved((current) => !current);
          }}
        >
          {showResolved ? "Hide" : "Show"} resolved ({resolved.length})
        </button>
      ) : null}
      {showResolved
        ? resolved.map((thread) => (
            <ThreadCard
              key={thread.rootId}
              docPath={docPath}
              thread={thread}
              focused={focusIds.includes(thread.rootId)}
              onDone={refresh}
              asOfMs={asOfMs}
            />
          ))
        : null}
      {data.orphanMarkers.length > 0 ? (
        <p className="px-1 pt-2 text-[11px] text-amber-600">
          Markers with no comment: {data.orphanMarkers.join(", ")}
        </p>
      ) : null}
      {data.strayIds.length > 0 ? (
        <p className="px-1 pt-1 text-[11px] text-amber-600">
          Entries outside any thread: {data.strayIds.join(", ")}
        </p>
      ) : null}
    </div>
  );
}
