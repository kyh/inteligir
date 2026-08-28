// The ⌘K Action Composer — fluid's ask-AI input floating over the note
// a
// prompt field with the open note attached as a removable context chip, more
// notes @-mentionable into chips beside it, the mic riding along, send
// starting the action. The action ATTACHES to the note
// (threads.originDocPath); mentioned notes ride the prompt as a leading
// context line; its transcript lives in the Actions panel.

import type { WikiTargetWire } from "@repo/api/local/knowledge/knowledge-schema";
import { Badge } from "@repo/ui/components/badge";
import { InputMessage } from "@repo/ui/components/input-message";
import { cn } from "@repo/ui/lib/utils";
import { toast } from "@repo/ui/components/sonner";
import { FileTextIcon, XIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { useWorkspace } from "../workspace-context";
import type { ViewContextSource } from "../chat-model";
import { spliceIntoComposer } from "../voice/dictation";
import { MicButton } from "../voice/mic-button";
import { useVoiceStatus } from "../voice-hooks";
import { useWikiTargets } from "../vault-hooks";
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
  const wikiTargets = useWikiTargets();

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
    <>
      {/* Scrim: invisible, but a click anywhere off the composer dismisses it
          — the pre-rework wrapper's behavior, kept without dimming the note. */}
      <div
        className="absolute inset-0 z-30"
        onPointerDown={() => {
          onOpenChange(false);
        }}
      />
      <div
        className="absolute inset-x-0 bottom-10 z-40 flex justify-center px-6"
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            onOpenChange(false);
          }
        }}
      >
        <div role="dialog" aria-label="Action composer" className="w-full max-w-xl">
          {dictationPartial !== null ? (
            <div
              data-dictation-preview=""
              aria-live="polite"
              className="mb-2 rounded-lg border border-line bg-surface px-3 py-2 text-xs text-muted-foreground"
            >
              {dictationPartial === "" ? "Listening…" : dictationPartial}
            </div>
          ) : null}

          <div className="relative">
            <MentionCombobox
              options={mentionOptions}
              activeIndex={mentionIndex}
              onHover={setMentionIndex}
              onPick={pickMention}
            />
            <InputMessage
              topSlot={
                docPath !== null || mentions.length > 0 ? (
                  <>
                    {docPath !== null ? (
                      <Badge
                        variant="outline"
                        className={cn(
                          "gap-1 bg-surface-raised",
                          !attached && "text-muted-foreground line-through",
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
                      </Badge>
                    ) : null}
                    {mentions.map((path) => (
                      <Badge key={path} variant="outline" className="gap-1 bg-surface-raised">
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
                      </Badge>
                    ))}
                  </>
                ) : null
              }
              value={text}
              onValueChange={(value) => {
                setText(value);
                const field = fieldRef.current;
                if (field !== null) syncMention(value, field.selectionStart);
              }}
              onSend={() => {
                submit();
              }}
              placeholder="Ask the agent… @ mentions a note"
              minRows={2}
              maxRows={8}
              sendLabel="Send"
              disabled={sending}
              textareaRef={fieldRef}
              rightSlot={
                <MicButton
                  status={voiceStatus}
                  onTranscript={acceptTranscript}
                  onPartial={setDictationPartial}
                  disabled={sending}
                />
              }
              textareaProps={{
                "aria-label": "Ask the agent",
                onBlur: () => {
                  setMention(null);
                },
                onSelect: (event) => {
                  syncMention(event.currentTarget.value, event.currentTarget.selectionStart);
                },
                // Runs BEFORE InputMessage's own keys (submit/history), winning
                // by preventDefault — the combobox owns arrows/Enter/Escape
                // while an @-span is live.
                onKeyDown: (event) => {
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
                },
              }}
            />
          </div>
        </div>
      </div>
    </>
  );
}
