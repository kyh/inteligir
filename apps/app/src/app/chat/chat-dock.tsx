// The bottom chat dock, pinned under the editor column and living BESIDE the
// note (its state never wraps the editor, so nothing here can remount it).
// One surface for both mechanisms: plain chat sends into the designated
// thread (minted lazily on first send), and a delegation draft — armed by
// the editor's selection affordance — turns the same composer into the
// delegation's prompt input. Collapsed shows the last exchange; expanded is
// a scrollable timeline with approvals answerable inline.

import type { Thread } from "@repo/server-contract/threads";
import type { TimelineRow } from "@repo/server-contract/thread-timeline";
import { Button } from "@repo/ui/components/button";
import { Textarea } from "@repo/ui/components/textarea";
import { toast } from "@repo/ui/components/sonner";
import { cn } from "@repo/ui/lib/utils";
import { useQueryClient } from "@tanstack/react-query";
import { ArchiveIcon, ArrowUpIcon, ChevronDownIcon, PenLineIcon, XIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { queryKeys, unwrap } from "../api";
import { useWorkspace } from "../workspace-context";
import { ApprovalCard } from "./approval-card";
import { designatedChatThread, type DelegationDraft } from "./chat-model";
import { ensureChatThread, sendToThread } from "./chat-service";
import { TimelineRowView } from "./timeline-rows";
import { useThreadDetail, useThreads, useThreadTimeline } from "./thread-hooks";

export interface ChatDockProps {
  /** Explicitly viewed thread (chip click, palette); null = the designated chat. */
  viewThreadId: string | null;
  onViewThread: (threadId: string | null) => void;
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
  draft: DelegationDraft | null;
  onCancelDraft: () => void;
  /** Runs the delegation create for the armed draft; resolves when sent. */
  onSubmitDelegation: (prompt: string) => Promise<void>;
  onOpenDoc: (path: string) => void;
}

function statusDotClass(status: Thread["status"], needsApproval: boolean): string {
  if (needsApproval) {
    return "bg-amber-500";
  }
  switch (status) {
    case "starting":
    case "active":
    case "stopping":
      return "bg-sky-500 animate-pulse";
    case "error":
      return "bg-destructive";
    case "idle":
      return "bg-muted-foreground/40";
  }
}

function lastExchange(rows: readonly TimelineRow[]): { role: string; text: string } | null {
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const row = rows[index];
    if (row !== undefined && row.kind === "conversation" && row.text.trim() !== "") {
      return { role: row.role, text: row.text };
    }
  }
  return null;
}

export function ChatDock({
  viewThreadId,
  onViewThread,
  expanded,
  onExpandedChange,
  draft,
  onCancelDraft,
  onSubmitDelegation,
  onOpenDoc,
}: ChatDockProps) {
  const { api } = useWorkspace();
  const queryClient = useQueryClient();
  const threadsQuery = useThreads();
  const designated = designatedChatThread(threadsQuery.data?.threads ?? []);
  const viewingId = viewThreadId ?? designated?.id ?? null;
  const detailQuery = useThreadDetail(viewingId);
  const timeline = useThreadTimeline(viewingId);

  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // A freshly armed draft moves the user's next keystrokes here.
  useEffect(() => {
    if (draft !== null) {
      composerRef.current?.focus();
    }
  }, [draft]);

  const rowCount = timeline?.rows.length ?? 0;
  useEffect(() => {
    const scroller = scrollRef.current;
    if (scroller !== null) {
      scroller.scrollTop = scroller.scrollHeight;
    }
  }, [rowCount, expanded]);

  const invalidateThreads = (): void => {
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
        if (draft !== null) {
          await onSubmitDelegation(trimmed);
          setText("");
          return;
        }
        const threadId = viewingId ?? (await ensureChatThread(api)).id;
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
        onExpandedChange(true);
      } catch {
        toast.error("Could not reach the agent.");
      } finally {
        setSending(false);
        invalidateThreads();
      }
    })();
  };

  const answerInteraction = (interactionId: string, resolution: string): void => {
    if (viewingId === null) {
      return;
    }
    void (async () => {
      try {
        await unwrap(
          await api.threads.interaction.answer.$post({
            json: { threadId: viewingId, interactionId, resolution },
          }),
        );
      } catch {
        toast.error("Could not answer the approval.");
      } finally {
        invalidateThreads();
      }
    })();
  };

  const archiveThread = (threadId: string): void => {
    void (async () => {
      try {
        await unwrap(await api.threads.archive.$post({ json: { threadId } }));
        onViewThread(null);
      } catch {
        toast.error("Could not archive the thread.");
      } finally {
        invalidateThreads();
      }
    })();
  };

  const thread = detailQuery.data?.thread ?? null;
  const pending = detailQuery.data?.pendingInteractions ?? [];
  const queued = detailQuery.data?.queuedMessages ?? [];
  const needsApproval = pending.length > 0;
  const exchange = timeline === null ? null : lastExchange(timeline.rows);
  const viewingDesignated = thread !== null && designated !== null && thread.id === designated.id;
  const title =
    thread === null
      ? "Chat"
      : (thread.title ?? (thread.originDocPath === null ? "Chat" : "Delegation"));

  return (
    <div className="shrink-0 border-t border-border/60 bg-background">
      <div className="mx-auto w-full max-w-[var(--editor-width,44rem)] px-7">
        {expanded && viewingId !== null ? (
          <div className="flex flex-col">
            <div className="flex items-center gap-2 py-2 text-xs text-muted-foreground">
              {thread !== null ? (
                <span
                  className={cn(
                    "size-1.5 shrink-0 rounded-full",
                    statusDotClass(thread.status, needsApproval),
                  )}
                />
              ) : null}
              <span className="truncate font-medium text-foreground">{title}</span>
              {thread?.originDocPath !== null && thread?.originDocPath !== undefined ? (
                <button
                  type="button"
                  className="truncate underline-offset-2 hover:underline"
                  onClick={() => onOpenDoc(thread.originDocPath ?? "")}
                >
                  {thread.originDocPath}
                </button>
              ) : null}
              <span className="flex-1" />
              {viewingDesignated ? (
                <Button
                  size="xs"
                  variant="ghost"
                  onClick={() => {
                    if (thread !== null) {
                      archiveThread(thread.id);
                    }
                  }}
                >
                  <PenLineIcon /> New chat
                </Button>
              ) : thread !== null ? (
                <Button size="xs" variant="ghost" onClick={() => archiveThread(thread.id)}>
                  <ArchiveIcon /> Archive
                </Button>
              ) : null}
              <Button
                size="icon-xs"
                variant="ghost"
                aria-label="Collapse chat"
                onClick={() => onExpandedChange(false)}
              >
                <ChevronDownIcon />
              </Button>
            </div>
            <div
              ref={scrollRef}
              className="flex max-h-[45dvh] min-h-32 flex-col gap-3 overflow-y-auto pb-3"
            >
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
              {queued.map((message) => (
                <div key={message.id} className="flex justify-end">
                  <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl bg-muted/50 px-3 py-1.5 text-sm text-muted-foreground">
                    {message.text}
                    <span className="ml-2 text-xs">queued</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : viewingId !== null && (exchange !== null || thread !== null) ? (
          <button
            type="button"
            className="flex w-full items-center gap-2 py-2 text-left text-xs text-muted-foreground"
            onClick={() => onExpandedChange(true)}
          >
            {thread !== null ? (
              <span
                className={cn(
                  "size-1.5 shrink-0 rounded-full",
                  statusDotClass(thread.status, needsApproval),
                )}
              />
            ) : null}
            <span className="truncate">
              {needsApproval
                ? "The agent needs an approval"
                : (exchange?.text ?? "No messages yet")}
            </span>
          </button>
        ) : null}

        {draft !== null ? (
          <div className="mb-2 flex items-start gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs">
            <div className="min-w-0 flex-1">
              <div className="font-medium">
                {draft.intent === "do" ? "Delegate to the agent" : "Ask about this"}
                <span className="ml-2 font-normal text-muted-foreground">{draft.docPath}</span>
              </div>
              <div className="mt-0.5 truncate text-muted-foreground">
                {draft.selectionText.split("\n", 1)[0]}
              </div>
            </div>
            <Button
              size="icon-xs"
              variant="ghost"
              aria-label="Cancel delegation"
              onClick={onCancelDraft}
            >
              <XIcon />
            </Button>
          </div>
        ) : null}

        <div className="flex items-end gap-2 pb-3">
          <Textarea
            ref={composerRef}
            aria-label="Message the agent"
            placeholder={
              draft !== null
                ? draft.intent === "do"
                  ? "What should the agent do with this?"
                  : "What do you want to know?"
                : "Message the agent…"
            }
            value={text}
            rows={1}
            className="max-h-40 min-h-9 flex-1 resize-none"
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                submit();
              }
              if (event.key === "Escape" && draft !== null) {
                event.preventDefault();
                onCancelDraft();
              }
            }}
          />
          <Button
            size="icon-sm"
            aria-label="Send"
            disabled={sending || text.trim() === ""}
            onClick={submit}
          >
            <ArrowUpIcon />
          </Button>
        </div>
      </div>
    </div>
  );
}
