// The ⌘K Action Composer — a floating card over the note (Moss's model): a
// prompt field with the open note attached as a removable context chip, more
// notes @-mentionable into chips beside it, the mic riding along, send
// starting the action. The action ATTACHES to the note
// (threads.originDocPath); mentioned notes ride the prompt as a leading
// context line; its transcript lives in the Actions panel.

import type { WikiTargetWire } from "@repo/server-contract/knowledge";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@repo/ui/components/button";
import { Textarea } from "@repo/ui/components/textarea";
import { cn } from "@repo/ui/lib/utils";
import { toast } from "@repo/ui/components/sonner";
import { FileTextIcon, XIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { queryKeys, unwrap } from "../api";
import { useWorkspace } from "../workspace-context";
import type { ViewContextSource } from "../chat/chat-model";
import { spliceIntoComposer } from "../chat/dictation";
import { MicButton } from "../chat/mic-button";
import { useVoiceStatus } from "../voice-hooks";
import { createAction } from "./action-service";
import {
  activeMentionAt,
  filterMentionTargets,
  MentionCombobox,
  type MentionSpan,
} from "./mention-combobox";

export interface ActionComposerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Text the opener wants pre-filled (a quoted selection); applied per OPEN. */
  seed: string | null;
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
  seed,
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
  /** Paths picked from the @-mention combobox, each a removable chip. */
  const [mentions, setMentions] = useState<string[]>([]);
  /** The @-span the caret sits in — the combobox is open while non-null. */
  const [mention, setMention] = useState<MentionSpan | null>(null);
  const [mentionIndex, setMentionIndex] = useState(0);
  const [dictationPartial, setDictationPartial] = useState<string | null>(null);
  const fieldRef = useRef<HTMLTextAreaElement | null>(null);
  const voiceStatus = useVoiceStatus().data;
  const wikiTargets = useQuery({
    queryKey: queryKeys.wikiTargets,
    queryFn: async () => unwrap(await api.knowledge["wiki-targets"].$get()),
    enabled: open,
  });

  useEffect(() => {
    if (open) {
      setAttached(true);
      setMentions([]);
      setMention(null);
      if (seed !== null) {
        setText(seed);
      }
      requestAnimationFrame(() => {
        const field = fieldRef.current;
        field?.focus();
        field?.setSelectionRange(field.value.length, field.value.length);
      });
    } else {
      setDictationPartial(null);
    }
    // Seed applies at the moment of OPENING; a seed change mid-open must not
    // clobber typing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) {
    return null;
  }

  const attachedPath = attached ? docPath : null;

  const chipPaths = new Set(mentions);
  if (attachedPath !== null) {
    chipPaths.add(attachedPath);
  }
  const mentionOptions =
    mention === null
      ? []
      : filterMentionTargets(wikiTargets.data?.targets ?? [], mention.query, chipPaths);

  /** Re-derive the mention from where the caret actually is — typing,
   *  clicking and arrowing all land here, so the span can never go stale. */
  const syncMention = (value: string, caret: number): void => {
    const span = activeMentionAt(value, caret);
    if (span?.query !== mention?.query) {
      setMentionIndex(0);
    }
    setMention(span);
  };

  const pickMention = (target: WikiTargetWire): void => {
    if (mention === null) {
      return;
    }
    const caret = fieldRef.current?.selectionStart ?? mention.start + 1 + mention.query.length;
    setText(text.slice(0, mention.start) + text.slice(caret));
    setMentions((prior) => (prior.includes(target.path) ? prior : [...prior, target.path]));
    setMention(null);
    const start = mention.start;
    fieldRef.current?.focus();
    requestAnimationFrame(() => {
      fieldRef.current?.setSelectionRange(start, start);
    });
  };

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
          contextPaths: mentions,
          docPath: attachedPath,
          prompt: trimmed,
          viewContext,
        });
        if (created.send.kind === "refused") {
          toast.error(created.send.message);
        }
        setText("");
        setMentions([]);
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
        {docPath !== null || mentions.length > 0 ? (
          <div className="mb-2 flex flex-wrap gap-1.5">
            {docPath !== null ? (
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
            ) : null}
            {mentions.map((path) => (
              <span
                key={path}
                className="inline-flex items-center gap-1 rounded-md border border-line px-1.5 py-0.5 text-xs text-foreground"
              >
                <FileTextIcon className="size-3" />
                {path}
                <button
                  type="button"
                  aria-label={`Remove ${path}`}
                  className="text-muted-foreground hover:text-foreground"
                  onClick={() => {
                    setMentions((prior) => prior.filter((kept) => kept !== path));
                  }}
                >
                  <XIcon className="size-3" />
                </button>
              </span>
            ))}
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
          <div className="relative flex-1">
            <MentionCombobox
              options={mentionOptions}
              activeIndex={mentionIndex}
              onHover={setMentionIndex}
              onPick={pickMention}
            />
            <Textarea
              ref={fieldRef}
              aria-label="Ask the agent"
              placeholder="Ask the agent… @ mentions a note"
              value={text}
              rows={2}
              className="max-h-48 min-h-14 resize-none"
              onChange={(event) => {
                setText(event.target.value);
                syncMention(event.target.value, event.target.selectionStart);
              }}
              onSelect={(event) => {
                syncMention(event.currentTarget.value, event.currentTarget.selectionStart);
              }}
              onBlur={() => {
                setMention(null);
              }}
              onKeyDown={(event) => {
                if (mention !== null && mentionOptions.length > 0) {
                  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                    event.preventDefault();
                    const step = event.key === "ArrowDown" ? 1 : -1;
                    setMentionIndex((prior) =>
                      Math.min(Math.max(prior + step, 0), mentionOptions.length - 1),
                    );
                    return;
                  }
                  if (event.key === "Enter" && !event.metaKey && !event.ctrlKey) {
                    event.preventDefault();
                    const active =
                      mentionOptions[Math.min(mentionIndex, mentionOptions.length - 1)];
                    if (active !== undefined) {
                      pickMention(active);
                    }
                    return;
                  }
                  if (event.key === "Escape") {
                    // Only the combobox closes; the composer's own Escape
                    // handler sits on the wrapper above.
                    event.preventDefault();
                    event.stopPropagation();
                    setMention(null);
                    return;
                  }
                }
                if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                  event.preventDefault();
                  submit();
                }
              }}
            />
          </div>
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
