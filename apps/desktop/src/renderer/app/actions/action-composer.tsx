import type { WikiTargetWire } from "@repo/api/local/knowledge/knowledge-schema";
import { getLiveEditor } from "@repo/editor/live-editor";
import { Badge } from "@repo/ui/components/badge";
import { Button } from "@repo/ui/components/button";
import { Dialog, DialogPopup } from "@repo/ui/components/dialog";
import { InputMessage } from "@repo/ui/components/input-message";
import { cn } from "@repo/ui/lib/cn";
import { toast } from "@repo/ui/components/sonner";
import { FileTextIcon, XIcon } from "lucide-react";
import { useId, useRef, useState } from "react";
import type { RefObject } from "react";

import { client, failed } from "../api";
import type { ViewContextSource } from "../thread-activity";
import { spliceIntoComposer } from "../voice/dictation";
import { MicButton } from "../voice/mic-button";
import { useVoiceStatus } from "../voice-hooks";
import { useWikiTargets } from "../vault-hooks";
import { createAction } from "./action-service";
import {
  activeMentionAt,
  filterMentionTargets,
  MentionCombobox,
  mentionOptionId,
} from "./mention-combobox";
import type { MentionSpan } from "./mention-combobox";

interface PendingAction {
  threadId: string;
  docPath: string | null;
}

export interface ActionComposerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  seed: string | null;
  docPath: string | null;
  readViewContext: ViewContextSource;
  onLaunched: (threadId: string) => void;
  // the note column: the composer floats over the note, never over the panel beside it
  container: RefObject<HTMLElement | null>;
}

export const ActionComposer = ({
  open,
  onOpenChange,
  seed,
  docPath,
  readViewContext,
  onLaunched,
  container,
}: ActionComposerProps) => {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  // the thread a refused send already created; the retry reuses it only over the same note,
  // since originDocPath is fixed at creation and the composer outlives a close.
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [attached, setAttached] = useState(true);
  const [mentions, setMentions] = useState<string[]>([]);
  const [mention, setMention] = useState<MentionSpan | null>(null);
  const [mentionIndex, setMentionIndex] = useState(0);
  const [dictationPartial, setDictationPartial] = useState<string | null>(null);
  const fieldRef = useRef<HTMLTextAreaElement | null>(null);
  const popupRef = useRef<HTMLDivElement | null>(null);
  const listId = useId();
  const voiceStatus = useVoiceStatus().data;
  const wikiTargets = useWikiTargets();

  // The composer outlives a close — the thread a refused send created is retried into on the
  // next open — so an open resets the rest here rather than through a remount under a `key`. The
  // seed applies at open only: a mid-open seed change must not clobber typing.
  const [openSeen, setOpenSeen] = useState(false);
  if (open !== openSeen) {
    setOpenSeen(open);
    if (open) {
      setAttached(true);
      setMentions([]);
      setMention(null);
      if (seed !== null) {
        setText(seed);
      }
    } else {
      setDictationPartial(null);
    }
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
  const listShown = mentionOptions.length > 0;
  const activeMention = Math.min(mentionIndex, mentionOptions.length - 1);

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
    const { start } = mention;
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

  const focusField = (): HTMLElement | null => {
    const field = fieldRef.current;
    field?.setSelectionRange(field.value.length, field.value.length);
    return field;
  };

  // Back to the note, through the editor's own focus, which restores its selection: a DOM focus
  // on the editable would drop the caret at the note's start. The blur before it only clears
  // Slate's focus flag: Slate ignores a blur that lands while it writes the DOM selection, and a
  // flag left set makes this focus a no-op. A press outside already put focus where the pointer
  // went, and that is left alone.
  const returnFocus = (): boolean => {
    const active = document.activeElement;
    const movedAway =
      active !== null && active !== document.body && popupRef.current?.contains(active) !== true;
    if (movedAway) {
      return false;
    }
    const editor = docPath === null ? null : getLiveEditor(docPath);
    // a composer unmounted with the window outlives the editor's DOM, which has no focus to take
    if (editor === null || editor.api.toDOMNode(editor)?.isConnected !== true) {
      return true;
    }
    editor.tf.blur();
    editor.tf.focus();
    return false;
  };

  const submit = (): void => {
    const trimmed = text.trim();
    if (trimmed === "" || sending) {
      return;
    }
    setSending(true);
    void (async () => {
      try {
        const viewContext = attachedPath === null ? null : await readViewContext();
        const created = await createAction(client, {
          contextPaths: mentions,
          docPath: attachedPath,
          prompt: trimmed,
          threadId: pending !== null && pending.docPath === attachedPath ? pending.threadId : null,
          viewContext,
        });
        if (created.send.kind === "refused") {
          setPending({ docPath: attachedPath, threadId: created.threadId });
          toast.error(created.send.message);
        } else {
          setPending(null);
          setText("");
          setMentions([]);
          onOpenChange(false);
          onLaunched(created.threadId);
        }
      } catch (error) {
        failed(error, "Could not start the action.");
      }
      setSending(false);
    })();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange} modal={false}>
      <DialogPopup
        ref={popupRef}
        container={container}
        initialFocus={focusField}
        finalFocus={returnFocus}
        aria-label="Action composer"
        className="absolute inset-x-6 bottom-10 mx-auto max-w-xl"
      >
        {dictationPartial === null ? null : (
          <div
            data-dictation-preview=""
            aria-live="polite"
            className="mb-2 rounded-lg border border-line bg-surface px-3 py-2 text-body text-muted-foreground"
          >
            {dictationPartial === "" ? "Listening…" : dictationPartial}
          </div>
        )}

        <div className="relative">
          <MentionCombobox
            id={listId}
            options={mentionOptions}
            activeIndex={activeMention}
            onHover={setMentionIndex}
            onPick={pickMention}
          />
          <InputMessage
            topSlot={
              docPath !== null || mentions.length > 0 ? (
                <>
                  {docPath === null ? null : (
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
                        <Button
                          variant="ghost"
                          size="icon-compact"
                          className="size-4"
                          aria-label="Detach note"
                          onClick={() => {
                            setAttached(false);
                          }}
                        >
                          <XIcon className="size-3" />
                        </Button>
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
                  )}
                  {mentions.map((path) => (
                    <Badge key={path} variant="outline" className="gap-1 bg-surface-raised">
                      <FileTextIcon className="size-3" />
                      {path}
                      <Button
                        variant="ghost"
                        size="icon-compact"
                        className="size-4"
                        aria-label={`Remove ${path}`}
                        onClick={() => {
                          setMentions((prior) => prior.filter((kept) => kept !== path));
                        }}
                      >
                        <XIcon className="size-3" />
                      </Button>
                    </Badge>
                  ))}
                </>
              ) : null
            }
            value={text}
            onValueChange={(value) => {
              setText(value);
              const field = fieldRef.current;
              if (field !== null) {
                syncMention(value, field.selectionStart);
              }
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
              "aria-activedescendant": listShown
                ? mentionOptionId(listId, activeMention)
                : undefined,
              "aria-autocomplete": "list",
              "aria-controls": listShown ? listId : undefined,
              "aria-expanded": listShown,
              "aria-label": "Ask the agent",
              onBlur: () => {
                setMention(null);
              },
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
                    const active = mentionOptions[activeMention];
                    if (active !== undefined) {
                      pickMention(active);
                    }
                    return;
                  }
                  if (event.key === "Escape") {
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
              onSelect: (event) => {
                syncMention(event.currentTarget.value, event.currentTarget.selectionStart);
              },
              role: "combobox",
            }}
          />
        </div>
      </DialogPopup>
    </Dialog>
  );
};
