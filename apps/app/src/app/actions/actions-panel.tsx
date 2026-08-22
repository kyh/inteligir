// The right panel (Moss's three-pane IA): Actions | Properties tabs over the
// open note. Actions = the note's own threads first, then the rest, each row
// expandable into its live timeline with approvals answerable inline —
// the transcript surface the chat dock used to be. Properties = the
// frontmatter panel the editor package already carries.

import { PageDetails } from "@repo/editor/properties/page-details";
import type { Thread } from "@repo/server-contract/threads";
import { Button } from "@repo/ui/components/button";
import { Textarea } from "@repo/ui/components/textarea";
import { toast } from "@repo/ui/components/sonner";
import { cn } from "@repo/ui/lib/utils";
import { ArchiveIcon, ArrowLeftIcon, Share2Icon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { queryKeys, unwrap } from "../api";
import { ApprovalCard } from "../chat/approval-card";
import {
  THREAD_ACTIVITY_DOT_CLASSES,
  THREAD_ACTIVITY_LABELS,
  threadActivity,
} from "../chat/chat-model";
import { sendToThread } from "../chat/chat-service";
import { useThreadDetail, useThreads, useThreadTimeline } from "../chat/thread-hooks";
import { useNoteComments } from "./comment-hooks";
import { CommentsTab } from "./comments-tab";
import { shareWithAgentText } from "./share-with-agent";
import { TimelineRowView } from "../chat/timeline-rows";
import { useWorkspace } from "../workspace-context";

export interface ActionsPanelProps {
  /** The open note — its actions list first. */
  docPath: string | null;
  /** A clicked tinted range: switch to Comments and highlight these roots.
   * The nonce distinguishes two clicks on the same range. */
  commentFocus: { ids: readonly string[]; nonce: number } | null;
  /** The action a launch or a palette pick selected; null shows the list. */
  selectedThreadId: string | null;
  onSelectThread: (threadId: string | null) => void;
  onOpenDoc: (path: string) => void;
}

type PanelTab = "actions" | "comments" | "properties";

function ActionRow({ thread, onSelect }: { thread: Thread; onSelect: (threadId: string) => void }) {
  const activity = threadActivity(thread, {
    openInteractionCount: 0,
    pendingProposalCount: 0,
    queuedCount: 0,
  });
  return (
    <button
      type="button"
      className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-surface-raised"
      onClick={() => {
        onSelect(thread.id);
      }}
    >
      <span
        className={cn("size-1.5 shrink-0 rounded-full", THREAD_ACTIVITY_DOT_CLASSES[activity])}
      />
      <span className="min-w-0 flex-1 truncate">{thread.title ?? "Action"}</span>
      <span className="shrink-0 text-xs text-muted-foreground">
        {THREAD_ACTIVITY_LABELS[activity]}
      </span>
    </button>
  );
}

function ActionDetail({
  threadId,
  onBack,
  onOpenDoc,
}: {
  threadId: string;
  onBack: () => void;
  onOpenDoc: (path: string) => void;
}) {
  const { api } = useWorkspace();
  const queryClient = useQueryClient();
  const detailQuery = useThreadDetail(threadId);
  const timeline = useThreadTimeline(threadId);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const thread = detailQuery.data?.thread ?? null;
  const pending = detailQuery.data?.pendingInteractions ?? [];
  const rowCount = timeline?.rows.length ?? 0;

  useEffect(() => {
    const scroller = scrollRef.current;
    if (scroller !== null) {
      scroller.scrollTop = scroller.scrollHeight;
    }
  }, [rowCount, pending.length]);

  const invalidate = (): void => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.threadsRoot });
  };

  const submit = (): void => {
    const trimmed = text.trim();
    if (trimmed === "" || sending) {
      return;
    }
    setSending(true);
    void (async () => {
      try {
        const outcome = await sendToThread(api, {
          threadId,
          text: trimmed,
          activeTurnId: detailQuery.data?.thread.activeTurnId ?? null,
        });
        if (outcome.kind === "refused") {
          toast.error(outcome.message);
          return;
        }
        setText("");
      } catch {
        toast.error("Could not reach the agent.");
      } finally {
        setSending(false);
        invalidate();
      }
    })();
  };

  const answerInteraction = (interactionId: string, resolution: string): void => {
    void (async () => {
      try {
        await unwrap(
          await api.threads.interaction.answer.$post({
            json: { interactionId, resolution, threadId },
          }),
        );
      } catch {
        toast.error("Could not answer the approval.");
      } finally {
        invalidate();
      }
    })();
  };

  const archive = (): void => {
    void (async () => {
      try {
        await unwrap(await api.threads.archive.$post({ json: { threadId } }));
        onBack();
      } catch {
        toast.error("Could not archive the action.");
      } finally {
        invalidate();
      }
    })();
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-1 border-b border-line px-2 py-1.5 text-sm">
        <Button size="icon-xs" variant="ghost" aria-label="Back to actions" onClick={onBack}>
          <ArrowLeftIcon />
        </Button>
        <span className="min-w-0 flex-1 truncate font-medium">{thread?.title ?? "Action"}</span>
        {thread?.originDocPath !== null && thread?.originDocPath !== undefined ? (
          <button
            type="button"
            className="max-w-32 truncate text-xs text-muted-foreground underline-offset-2 hover:underline"
            onClick={() => {
              onOpenDoc(thread.originDocPath ?? "");
            }}
          >
            {thread.originDocPath}
          </button>
        ) : null}
        <Button size="icon-xs" variant="ghost" aria-label="Archive action" onClick={archive}>
          <ArchiveIcon />
        </Button>
      </div>
      <div ref={scrollRef} className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-2 py-3">
        {timeline?.rows.map((row) => (
          <TimelineRowView key={row.id} row={row} />
        ))}
        {pending.map((interaction) => (
          <ApprovalCard
            key={interaction.id}
            interaction={interaction}
            onAnswer={answerInteraction}
          />
        ))}
      </div>
      <div className="border-t border-line p-2">
        <Textarea
          aria-label="Reply to the agent"
          placeholder="Reply…"
          value={text}
          rows={1}
          className="max-h-32 min-h-9 resize-none"
          onChange={(event) => {
            setText(event.target.value);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              submit();
            }
          }}
        />
      </div>
    </div>
  );
}

export function ActionsPanel({
  docPath,
  commentFocus,
  selectedThreadId,
  onSelectThread,
  onOpenDoc,
}: ActionsPanelProps) {
  const [tab, setTab] = useState<PanelTab>("actions");
  // Mounted HERE rather than in the Comments tab: this hook is what pushes
  // the sidecar's id sets into the editor's comment store, and the range
  // tint must be true with any tab selected.
  useNoteComments(docPath);
  useEffect(() => {
    if (commentFocus !== null) {
      setTab("comments");
    }
  }, [commentFocus]);
  const threadsQuery = useThreads();
  const threads = threadsQuery.data?.threads ?? [];

  const noteActions = docPath === null ? [] : threads.filter((t) => t.originDocPath === docPath);
  const otherActions = threads.filter((t) => docPath === null || t.originDocPath !== docPath);

  return (
    <div className="flex h-full flex-col">
      <div
        role="tablist"
        aria-label="Panel tabs"
        className="flex gap-1 border-b border-line px-2 py-1.5"
      >
        {(["actions", "comments", "properties"] satisfies PanelTab[]).map((name) => (
          <button
            key={name}
            role="tab"
            type="button"
            aria-selected={tab === name}
            className={cn(
              "rounded-md px-2 py-0.5 text-xs font-medium capitalize",
              tab === name
                ? "bg-surface-raised text-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
            onClick={() => {
              setTab(name);
            }}
          >
            {name}
          </button>
        ))}
        {docPath !== null ? (
          <button
            type="button"
            aria-label="Share with agent"
            title="Copy this note's path and vault-editing instructions for an external agent"
            className="ml-auto rounded-md px-1.5 py-0.5 text-muted-foreground hover:text-foreground"
            onClick={() => {
              navigator.clipboard.writeText(shareWithAgentText(docPath)).then(
                () => toast.success("Copied for an external agent"),
                () => toast.error("Could not copy"),
              );
            }}
          >
            <Share2Icon className="size-3.5" />
          </button>
        ) : null}
      </div>

      {tab === "comments" ? (
        <CommentsTab docPath={docPath} focusIds={commentFocus?.ids ?? []} />
      ) : tab === "properties" ? (
        docPath === null ? (
          <p className="p-3 text-sm text-muted-foreground">No note open.</p>
        ) : (
          <div className="min-h-0 flex-1 overflow-y-auto">
            <PageDetails path={docPath} open onOpenChange={() => {}} />
          </div>
        )
      ) : selectedThreadId !== null ? (
        <ActionDetail
          threadId={selectedThreadId}
          onBack={() => {
            onSelectThread(null);
          }}
          onOpenDoc={onOpenDoc}
        />
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
          {noteActions.length > 0 ? (
            <>
              <p className="px-2 pt-1 pb-0.5 text-[11px] font-medium text-muted-foreground uppercase">
                This note
              </p>
              {noteActions.map((thread) => (
                <ActionRow key={thread.id} thread={thread} onSelect={onSelectThread} />
              ))}
            </>
          ) : null}
          {otherActions.length > 0 ? (
            <>
              <p className="px-2 pt-2 pb-0.5 text-[11px] font-medium text-muted-foreground uppercase">
                Recent
              </p>
              {otherActions.map((thread) => (
                <ActionRow key={thread.id} thread={thread} onSelect={onSelectThread} />
              ))}
            </>
          ) : null}
          {threads.length === 0 ? (
            <p className="p-3 text-sm text-muted-foreground">
              No actions yet. Press ⌘K to ask the agent.
            </p>
          ) : null}
        </div>
      )}
    </div>
  );
}
