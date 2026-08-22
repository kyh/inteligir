// The ⌘K Action Composer — a floating card over the note (Moss's model): a
// prompt field with the open note attached as a removable context chip, the
// mic riding along, send starting the action. The action ATTACHES to the note
// (threads.originDocPath); its transcript lives in the Actions panel.

import { Button } from "@repo/ui/components/button";
import { Textarea } from "@repo/ui/components/textarea";
import { cn } from "@repo/ui/lib/utils";
import { toast } from "@repo/ui/components/sonner";
import { FileTextIcon, XIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { useWorkspace } from "../workspace-context";
import type { ViewContextSource } from "../chat/chat-model";
import { spliceIntoComposer } from "../chat/dictation";
import { MicButton } from "../chat/mic-button";
import { useVoiceStatus } from "../voice-hooks";
import { createAction } from "./action-service";

export interface ActionComposerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The note under the composer, offered as the action's attachment. */
  docPath: string | null;
  /** What the user is looking at, pulled at submit. */
  readViewContext: ViewContextSource;
  /** The action started; the panel shows it. */
  onLaunched: (threadId: string) => void;
}

export function ActionComposer({
  open,
  onOpenChange,
  docPath,
  readViewContext,
  onLaunched,
}: ActionComposerProps) {
  const { api } = useWorkspace();
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  // The chip is armed per OPEN: dismissing it composes an unattached action;
  // the next open re-offers the note.
  const [attached, setAttached] = useState(true);
  const [dictationPartial, setDictationPartial] = useState<string | null>(null);
  const fieldRef = useRef<HTMLTextAreaElement | null>(null);
  const voiceStatus = useVoiceStatus().data;

  useEffect(() => {
    if (open) {
      setAttached(true);
      requestAnimationFrame(() => fieldRef.current?.focus());
    } else {
      setDictationPartial(null);
    }
  }, [open]);

  if (!open) {
    return null;
  }

  const attachedPath = attached ? docPath : null;

  const acceptTranscript = (transcript: string): void => {
    const next = spliceIntoComposer(fieldRef.current, text, transcript);
    setText(next.text);
    fieldRef.current?.focus();
    requestAnimationFrame(() => {
      fieldRef.current?.setSelectionRange(next.caret, next.caret);
    });
  };

  const submit = (): void => {
    const trimmed = text.trim();
    if (trimmed === "" || sending) {
      return;
    }
    setSending(true);
    void (async () => {
      try {
        // The context describes the screen the action LEFT FROM; an action
        // detached from its note carries none.
        const viewContext = attachedPath === null ? null : await readViewContext();
        const created = await createAction(api, {
          docPath: attachedPath,
          prompt: trimmed,
          viewContext,
        });
        if (created.send.kind === "refused") {
          toast.error(created.send.message);
        }
        setText("");
        onOpenChange(false);
        onLaunched(created.threadId);
      } catch {
        toast.error("Could not start the action.");
      } finally {
        setSending(false);
      }
    })();
  };

  return (
    <div
      className="absolute inset-x-0 bottom-10 z-40 flex justify-center px-6"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          onOpenChange(false);
        }
      }}
    >
      <div
        role="dialog"
        aria-label="Action composer"
        className="w-full max-w-xl rounded-xl border border-line bg-surface-raised p-3 shadow-surface-2"
      >
        {docPath !== null ? (
          <div className="mb-2 flex flex-wrap gap-1.5">
            <span
              className={cn(
                "inline-flex items-center gap-1 rounded-md border border-line px-1.5 py-0.5 text-xs",
                attached ? "text-foreground" : "text-muted-foreground line-through",
              )}
            >
              <FileTextIcon className="size-3" />
              {docPath}
              {attached ? (
                <button
                  type="button"
                  aria-label="Detach note"
                  className="text-muted-foreground hover:text-foreground"
                  onClick={() => {
                    setAttached(false);
                  }}
                >
                  <XIcon className="size-3" />
                </button>
              ) : (
                <button
                  type="button"
                  className="text-muted-foreground hover:text-foreground"
                  onClick={() => {
                    setAttached(true);
                  }}
                >
                  attach
                </button>
              )}
            </span>
          </div>
        ) : null}

        {dictationPartial !== null ? (
          <div
            data-dictation-preview=""
            aria-live="polite"
            className="mb-2 rounded-lg border border-line bg-surface px-3 py-2 text-xs text-muted-foreground"
          >
            {dictationPartial === "" ? "Listening…" : dictationPartial}
          </div>
        ) : null}

        <div className="flex items-end gap-2">
          <Textarea
            ref={fieldRef}
            aria-label="Ask the agent"
            placeholder="Ask the agent…"
            value={text}
            rows={2}
            className="max-h-48 min-h-14 flex-1 resize-none"
            onChange={(event) => {
              setText(event.target.value);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                event.preventDefault();
                submit();
              }
            }}
          />
          <MicButton
            status={voiceStatus}
            onTranscript={acceptTranscript}
            onPartial={setDictationPartial}
            disabled={sending}
          />
          <Button
            size="sm"
            aria-label="Send"
            disabled={sending || text.trim() === ""}
            onClick={submit}
          >
            Send ⌘⏎
          </Button>
        </div>
      </div>
    </div>
  );
}
