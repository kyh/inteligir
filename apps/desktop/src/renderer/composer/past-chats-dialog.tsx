import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeftIcon, MessageSquareTextIcon } from "lucide-react";

import { Button } from "@repo/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@repo/ui/components/dialog";
import { Spinner } from "@repo/ui/components/spinner";

import { logFromHistory } from "@repo/bridge/chat-log";
import type { ChatSessionSummary } from "@repo/bridge/chat-sessions";
import { toErrorMessage } from "@repo/bridge/wire-helpers";

import { ChatMessageView, isRenderableMessage } from "@renderer/composer/chat-message";
import { getBridge } from "@renderer/lib/bridge";
import { projectChatLog, type ChatMessage } from "@renderer/stores/chat-log-view";
import { useViewStore } from "@renderer/stores/view-store";

// ---------------------------------------------------------------------------
// The READ-ONLY past-chat browser ("Browse past chats" in the palette).
// Cmd+K's "New chat" rolls a fresh thread and strands the old session on
// disk; this dialog lists those stranded threads (newest first, active thread
// excluded host-side) and renders a selected transcript with the SAME
// components the live chat uses. Deliberately VIEW-only: no composer, no
// resume — the single-thread model stays continueRecent-only.
// ---------------------------------------------------------------------------

/** What fills the dialog: the session list, or one session's transcript. */
type BrowserView =
  | { kind: "list" }
  | {
      kind: "transcript";
      session: ChatSessionSummary;
      /** Null while the read is in flight. */
      messages: ChatMessage[] | null;
      error: string | null;
    };

function formatUpdatedAt(updatedAt: number): string {
  return new Date(updatedAt).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function PastChatsDialog() {
  const open = useViewStore((s) => s.pastChatsOpen);
  const setOpen = useViewStore((s) => s.setPastChatsOpen);

  const [sessions, setSessions] = useState<ChatSessionSummary[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [view, setView] = useState<BrowserView>({ kind: "list" });
  // Monotonic fetch token: a stale response (user backed out / reopened)
  // must not clobber the current view.
  const fetchSeq = useRef(0);

  useEffect(() => {
    if (!open) return;
    // Fresh state per open — the vault's sessions may have changed.
    setSessions(null);
    setListError(null);
    setView({ kind: "list" });
    const seq = ++fetchSeq.current;
    getBridge()
      .listChatSessions()
      .then((list) => {
        if (fetchSeq.current === seq) setSessions(list);
      })
      .catch((err: unknown) => {
        if (fetchSeq.current === seq) setListError(toErrorMessage(err));
      });
  }, [open]);

  const openSession = useCallback((session: ChatSessionSummary) => {
    const seq = ++fetchSeq.current;
    setView({ kind: "transcript", session, messages: null, error: null });
    getBridge()
      .readChatSession({ id: session.id })
      .then((result) => {
        if (fetchSeq.current !== seq) return;
        setView(
          result.ok
            ? {
                kind: "transcript",
                session,
                messages: projectChatLog(logFromHistory(result.entries), new Map()),
                error: null,
              }
            : { kind: "transcript", session, messages: null, error: result.error },
        );
      })
      .catch((err: unknown) => {
        if (fetchSeq.current !== seq) return;
        setView({ kind: "transcript", session, messages: null, error: toErrorMessage(err) });
      });
  }, []);

  const backToList = useCallback(() => {
    fetchSeq.current++;
    setView({ kind: "list" });
  }, []);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="flex max-h-[70vh] max-w-lg flex-col gap-0 p-0">
        <DialogHeader className="border-b border-border px-4 py-3">
          {view.kind === "list" ? (
            <>
              <DialogTitle className="text-sm">Past chats</DialogTitle>
              <DialogDescription className="text-xs">
                Previous conversations, read-only. New chat always starts a fresh thread.
              </DialogDescription>
            </>
          ) : (
            <>
              <DialogTitle className="flex min-w-0 items-center gap-2 text-sm">
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label="Back to past chats"
                  className="size-6 shrink-0 px-0 text-muted-foreground hover:text-foreground"
                  onClick={backToList}
                >
                  <ArrowLeftIcon className="size-4" />
                </Button>
                <span className="truncate">{view.session.title}</span>
              </DialogTitle>
              <DialogDescription className="text-xs">
                Viewing a past conversation — read-only.
              </DialogDescription>
            </>
          )}
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          {view.kind === "list" ? (
            <SessionList
              sessions={sessions}
              error={listError}
              onSelect={openSession}
            />
          ) : (
            <Transcript messages={view.messages} error={view.error} />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function CenteredNote({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-24 items-center justify-center text-xs text-muted-foreground">
      {children}
    </div>
  );
}

function SessionList({
  sessions,
  error,
  onSelect,
}: {
  sessions: ChatSessionSummary[] | null;
  error: string | null;
  onSelect: (session: ChatSessionSummary) => void;
}) {
  if (error !== null) return <CenteredNote>{error}</CenteredNote>;
  if (sessions === null) {
    return (
      <CenteredNote>
        <Spinner className="size-4" />
      </CenteredNote>
    );
  }
  if (sessions.length === 0) {
    return <CenteredNote>No past conversations yet.</CenteredNote>;
  }
  return (
    <ul className="flex flex-col gap-0.5">
      {sessions.map((session) => (
        <li key={session.id}>
          <button
            type="button"
            onClick={() => onSelect(session)}
            className="flex w-full items-start gap-2.5 rounded-md px-2.5 py-2 text-left hover:bg-accent"
          >
            <MessageSquareTextIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-sm">{session.title}</span>
              <span className="text-xs text-muted-foreground">
                {formatUpdatedAt(session.updatedAt)} · {session.messageCount}{" "}
                {session.messageCount === 1 ? "message" : "messages"}
              </span>
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function Transcript({ messages, error }: { messages: ChatMessage[] | null; error: string | null }) {
  if (error !== null) return <CenteredNote>{error}</CenteredNote>;
  if (messages === null) {
    return (
      <CenteredNote>
        <Spinner className="size-4" />
      </CenteredNote>
    );
  }
  const renderable = messages.filter(isRenderableMessage);
  if (renderable.length === 0) {
    return <CenteredNote>This conversation has no messages.</CenteredNote>;
  }
  return (
    <div className="flex flex-col gap-3">
      {renderable.map((message) => (
        <ChatMessageView key={message.id} message={message} />
      ))}
    </div>
  );
}
