// The bottom chat dock, pinned under the editor column and living BESIDE the
// note (its state never wraps the editor, so nothing here can remount it).
// One surface for both mechanisms: plain chat sends into the held chat thread
// (minted lazily, single-flight, on the first send), and a delegation draft —
// armed by the editor's selection affordance — turns the same composer into
// that delegation's prompt input. Collapsed shows the last exchange; expanded
// is a scrollable timeline with approvals answerable inline.

import type { TimelineRow } from "@repo/server-contract/thread-timeline";
import { Button } from "@repo/ui/components/button";
import { Textarea } from "@repo/ui/components/textarea";
import { toast } from "@repo/ui/components/sonner";
import { cn } from "@repo/ui/lib/utils";
import { useQueryClient } from "@tanstack/react-query";
import { ArchiveIcon, ArrowUpIcon, ChevronDownIcon, PenLineIcon, XIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { queryKeys, unwrap } from "../api";
import { ProposalSummary } from "../proposals/proposal-summary";
import { useProposalActions, useThreadProposals } from "../proposals/proposal-hooks";
import { useWorkspace } from "../workspace-context";
import { ApprovalCard } from "./approval-card";
import {
  initialChatThread,
  threadActivity,
  THREAD_ACTIVITY_DOT_CLASSES,
  type DelegationDraft,
} from "./chat-model";
import { createChatThreadResolver, sendToThread } from "./chat-service";
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

  // The chat target is HELD, not derived. The initial list picks it once; from
  // then on only the user moves it (a chip, the palette, "New chat"). See
  // `initialChatThread` for why re-deriving would swap the visible
  // conversation whenever an unrelated thread's updatedAt moved.
  const [chatThreadId, setChatThreadId] = useState<string | null>(null);
  const listedThreads = threadsQuery.data?.threads;
  useEffect(() => {
    if (chatThreadId !== null || listedThreads === undefined) {
      return;
    }
    const initial = initialChatThread(listedThreads);
    if (initial !== null) {
      setChatThreadId(initial.id);
    }
  }, [chatThreadId, listedThreads]);

  // ONE resolver per mounted dock, so concurrent sends into an empty state
  // await one create instead of racing two.
  const [resolveChatThread] = useState(() => createChatThreadResolver(api));

  const viewingId = viewThreadId ?? chatThreadId;
  const detailQuery = useThreadDetail(viewingId);
  const timeline = useThreadTimeline(viewingId);
  // A delegation's suggestions belong in the thread that made them, not only
  // in the doc — a thread whose turn "finished" while its edits sit unapplied
  // is the state this dock has to be able to explain.
  const proposals = useThreadProposals(viewingId).data ?? [];

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
  // Suggestions are counted alongside the rows because they land at the BOTTOM
  // of the same scroller, after the turn's last message — a card that arrives
  // without moving the scroll is a card nobody sees.
  useEffect(() => {
    const scroller = scrollRef.current;
    if (scroller !== null) {
      scroller.scrollTop = scroller.scrollHeight;
    }
  }, [rowCount, proposals.length, expanded]);

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
        let threadId = viewingId;
        if (threadId === null) {
          threadId = (await resolveChatThread()).id;
          setChatThreadId(threadId);
        }
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
        // Archiving IS how a chat ends: clear the held target so the next send
        // mints a fresh one. Nothing else may move it.
        if (threadId === chatThreadId) {
          setChatThreadId(null);
        }
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
  const proposalActions = useProposalActions((message) => {
    toast.error(message);
  });
  const dotClass =
    thread === null
      ? null
      : THREAD_ACTIVITY_DOT_CLASSES[
          threadActivity(thread, {
            openInteractionCount: pending.length,
            queuedCount: queued.length,
            pendingProposalCount: proposals.length,
          })
        ];
  const exchange = timeline === null ? null : lastExchange(timeline.rows);
  const viewingChat = thread !== null && thread.originDocPath === null;
  const title =
    thread === null
      ? "Chat"
      : (thread.title ?? (thread.originDocPath === null ? "Chat" : "Delegation"));

  return (
    <div className="shrink-0 border-t border-line bg-surface-inset">
      <div className="mx-auto w-full max-w-[var(--editor-width)] px-7">
        {expanded && viewingId !== null ? (
          <div className="flex flex-col">
            <div className="flex items-center gap-2 py-2 text-xs text-muted-foreground">
              {dotClass === null ? null : (
                <span className={cn("size-1.5 shrink-0 rounded-full", dotClass)} />
              )}
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
              {viewingChat ? (
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
              {proposals.map((proposal) => (
                <ProposalSummary
                  key={proposal.id}
                  proposal={proposal}
                  actions={proposalActions}
                  onOpenDoc={onOpenDoc}
                />
              ))}
              {queued.map((message) => (
                <div key={message.id} className="flex justify-end">
                  <div className="max-w-[85%] rounded-2xl bg-surface-raised/60 px-3 py-1.5 text-sm whitespace-pre-wrap text-ink-3 shadow-surface-1">
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
            {dotClass === null ? null : (
              <span className={cn("size-1.5 shrink-0 rounded-full", dotClass)} />
            )}
            <span className="truncate">
              {needsApproval
                ? "The agent needs an approval"
                : proposals.length > 0
                  ? `The agent suggested edits to ${proposals.length} file(s)`
                  : (exchange?.text ?? "No messages yet")}
            </span>
          </button>
        ) : null}

        {draft !== null ? (
          <div className="mb-2 flex items-start gap-2 rounded-lg border border-line bg-surface-raised px-3 py-2 text-xs shadow-surface-1">
            <div className="min-w-0 flex-1">
              <div className="font-medium">
                {draft.intent === "ask"
                  ? "Ask about this"
                  : draft.writeMode === "propose"
                    ? "Propose an edit"
                    : "Delegate to the agent"}
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
