// The panel's Comments tab: every thread the open note's sidecar holds —
// open first, then resolved (collapsed behind a toggle), then the two orphan
// surfaces the model refuses to hide (markers with no entry, stray entries).
// Clicking a thread scrolls the live editor to its range.

import { scrollToCommentMarker } from "@repo/editor/comments/comment-kit";
import { removeCommentMarkers } from "@repo/editor/comments/comment-markers";
import { getLiveEditor } from "@repo/editor/live-editor";
import { flushOpenNote } from "@repo/editor/note/open-note-flush";
import type { CommentEntryWire, CommentThreadWire } from "@repo/server-contract/comments";
import { Button } from "@repo/ui/components/button";
import { Textarea } from "@repo/ui/components/textarea";
import { toast } from "@repo/ui/components/sonner";
import { cn } from "@repo/ui/lib/utils";
import { useQueryClient } from "@tanstack/react-query";
import { CheckIcon, Trash2Icon, Undo2Icon } from "lucide-react";
import { useState } from "react";

import { queryKeys, unwrap } from "../api";
import { useWorkspace, type WorkspaceRuntime } from "../workspace-context";
import { useNoteComments } from "./comment-hooks";

const SOURCE_LABELS = { agent: "Agent", external: "External", user: "Me" } as const;

function sourceLabel(entry: CommentEntryWire): string {
  return entry.source === undefined ? "—" : SOURCE_LABELS[entry.source];
}

function relativeTime(unixSeconds: number): string {
  const deltaSeconds = Math.max(0, Math.floor(Date.now() / 1000) - unixSeconds);
  if (deltaSeconds < 60) return "just now";
  if (deltaSeconds < 3600) return `${String(Math.floor(deltaSeconds / 60))}m ago`;
  if (deltaSeconds < 86_400) return `${String(Math.floor(deltaSeconds / 3600))}h ago`;
  return `${String(Math.floor(deltaSeconds / 86_400))}d ago`;
}

function CommentRow({ id, entry }: { id: string; entry: CommentEntryWire }) {
  return (
    <div key={id} className="px-2 py-1">
      <div className="flex items-baseline gap-2 text-[11px] text-muted-foreground">
        <span className="font-medium text-foreground/80">{sourceLabel(entry)}</span>
        <span>{relativeTime(entry.createdAt)}</span>
      </div>
      <p className="text-sm whitespace-pre-wrap">{entry.text}</p>
    </div>
  );
}

function ThreadCard({
  api,
  docPath,
  thread,
  focused,
  onDone,
}: {
  api: WorkspaceRuntime["api"];
  docPath: string;
  thread: CommentThreadWire;
  focused: boolean;
  onDone: () => void;
}) {
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState(false);

  const jump = (): void => {
    const editor = getLiveEditor(docPath);
    if (editor === null || !scrollToCommentMarker(editor, thread.rootId)) {
      toast.warning("This comment's range is not in the open note.");
    }
  };

  const act = (run: () => Promise<void>): void => {
    if (busy) return;
    setBusy(true);
    void run()
      .catch(() => {
        toast.error("The comment change was refused.");
      })
      .finally(() => {
        setBusy(false);
        onDone();
      });
  };

  const sendReply = (): void => {
    const trimmed = reply.trim();
    if (trimmed === "") return;
    act(async () => {
      const id = `${thread.rootId}-r${String(Date.now() % 100_000)}`;
      await unwrap(
        await api.comments.reply.$post({
          json: { id, parentId: thread.rootId, path: docPath, text: trimmed },
        }),
      );
      setReply("");
    });
  };

  const setResolved = (resolved: boolean): void => {
    act(async () => {
      await unwrap(
        await api.comments.resolve.$post({
          json: { id: thread.rootId, path: docPath, resolved },
        }),
      );
    });
  };

  const remove = (): void => {
    act(async () => {
      const response = await unwrap(
        await api.comments.remove.$post({ json: { id: thread.rootId, path: docPath } }),
      );
      // The route owns the sidecar; the markers are the editor's to strip.
      const editor = getLiveEditor(docPath);
      if (editor !== null && response.removedIds.length > 0) {
        removeCommentMarkers(editor, response.removedIds);
        await flushOpenNote();
      }
    });
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
        <CommentRow id={thread.rootId} entry={thread.root} />
      </button>
      {thread.replies.map((row) => (
        <div key={row.id} className="border-t border-line/60 pl-3">
          <CommentRow id={row.id} entry={row.entry} />
        </div>
      ))}
      {!thread.anchored ? (
        <p className="px-2 pb-1 text-[11px] text-amber-600">No marker in the note body.</p>
      ) : null}
      <div className="flex items-center gap-1 border-t border-line/60 p-1.5">
        <Textarea
          aria-label="Reply to comment"
          placeholder="Reply…"
          value={reply}
          rows={1}
          className="max-h-24 min-h-8 flex-1 resize-none text-sm"
          onChange={(event) => {
            setReply(event.target.value);
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
            size="icon-xs"
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
            size="icon-xs"
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
          size="icon-xs"
          variant="ghost"
          aria-label="Delete comment thread"
          disabled={busy}
          onClick={remove}
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
  const { api } = useWorkspace();
  const queryClient = useQueryClient();
  const query = useNoteComments(docPath);
  const [showResolved, setShowResolved] = useState(false);

  if (docPath === null) {
    return <p className="p-3 text-sm text-muted-foreground">No note open.</p>;
  }
  const data = query.data;
  if (data === undefined) {
    return <p className="p-3 text-sm text-muted-foreground">Loading…</p>;
  }

  const refresh = (): void => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.commentsRoot });
  };

  const open = data.threads.filter((thread) => !thread.resolved);
  const resolved = data.threads.filter((thread) => thread.resolved);

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
          api={api}
          docPath={docPath}
          thread={thread}
          focused={focusIds.includes(thread.rootId)}
          onDone={refresh}
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
              api={api}
              docPath={docPath}
              thread={thread}
              focused={focusIds.includes(thread.rootId)}
              onDone={refresh}
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
