import type { WikiTargetWire } from "@repo/api/local/knowledge/knowledge-schema";
import { MAX_CONTEXT_PATHS } from "@repo/api/local/threads/threads-schema";
import { getLiveEditor } from "@repo/editor/live-editor";
import { Button } from "@repo/ui/components/button";
import { Dialog, DialogPopup } from "@repo/ui/components/dialog";
import { InputMessage } from "@repo/ui/components/input-message";
import { cn } from "@repo/ui/lib/cn";
import { platformShortcutModifier } from "@repo/ui/lib/hotkey-spelling";
import { isImeComposing } from "@repo/ui/lib/ime";
import { useRadius } from "@repo/ui/lib/radius-context";
import { surfaceClasses } from "@repo/ui/lib/surface-classes";
import { toast } from "@repo/ui/components/sonner";
import { XIcon } from "lucide-react";
import { useId, useRef, useState } from "react";
import type { ReactNode, RefObject } from "react";

import { useSignedOutHarness } from "../agents/agent-hooks";
import { AgentSignIn } from "../agents/agent-sign-in";
import { failed } from "../api";
import { ensureOpenNoteId } from "../note/open-note-id";
import type { ViewContextSource } from "../thread-activity";
import { useWikiTargets } from "../vault-hooks";
import { createAction } from "./action-service";
import {
  activeMentionAt,
  filterMentionTargets,
  MentionCombobox,
  mentionOptionId,
} from "./mention-combobox";
import type { MentionSpan } from "./mention-combobox";
import { NoteBadge } from "./note-badge";

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

// Mounted with the popup, so each open asks the vendors again: a sign-in can change outside the
// app. Only a default agent the vendor calls signed out stands in for the field; the text typed or
// seeded so far is the composer's, and waits for it.
const SignInFirst = ({ children, onSignedIn }: { children: ReactNode; onSignedIn: () => void }) => {
  const radius = useRadius();
  const signedOut = useSignedOutHarness(null);
  if (signedOut === null) {
    return children;
  }
  return (
    <div className={cn("space-y-3 p-3", surfaceClasses(2, 2), radius.container)}>
      <p className="text-subtitle">
        Sign in to ask the agent. It works on your notes with your own Claude or ChatGPT plan.
      </p>
      <AgentSignIn onSignedIn={onSignedIn} />
    </div>
  );
};

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
  const fieldRef = useRef<HTMLTextAreaElement | null>(null);
  const popupRef = useRef<HTMLDivElement | null>(null);
  const listId = useId();
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
    }
  }

  const attachedPath = attached ? docPath : null;

  const chipPaths = new Set(mentions);
  if (attachedPath !== null) {
    chipPaths.add(attachedPath);
  }
  // the wire's own cap: past it the list stays shut rather than offer a note the send would refuse
  const mentionsFull = mentions.length >= MAX_CONTEXT_PATHS;
  const mentionOptions =
    mention === null || mentionsFull
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
        if (attachedPath !== null) {
          ensureOpenNoteId(attachedPath);
        }
        const viewContext = attachedPath === null ? null : await readViewContext();
        const created = await createAction({
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
        <SignInFirst
          onSignedIn={() => {
            requestAnimationFrame(() => {
              focusField()?.focus();
            });
          }}
        >
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
                      <NoteBadge
                        path={docPath}
                        className={attached ? undefined : "text-muted-foreground line-through"}
                      >
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
                      </NoteBadge>
                    )}
                    {mentions.map((path) => (
                      <NoteBadge key={path} path={path}>
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
                      </NoteBadge>
                    ))}
                    {mentionsFull ? (
                      <span className="self-center text-caption text-muted-foreground">
                        At most {MAX_CONTEXT_PATHS} notes can be attached
                      </span>
                    ) : null}
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
              rightSlot={
                platformShortcutModifier() === "meta" ? (
                  <span className="text-caption text-muted-foreground">fn fn to dictate</span>
                ) : null
              }
              placeholder="Ask the agent… @ mentions a note"
              minRows={2}
              maxRows={8}
              sendLabel="Send"
              disabled={sending}
              textareaRef={fieldRef}
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
                  if (isImeComposing(event)) {
                    return;
                  }
                  if (listShown) {
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
                    }
                  }
                },
                onSelect: (event) => {
                  syncMention(event.currentTarget.value, event.currentTarget.selectionStart);
                },
                role: "combobox",
              }}
            />
          </div>
        </SignInFirst>
      </DialogPopup>
    </Dialog>
  );
};
