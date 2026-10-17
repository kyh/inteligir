import type { WikiTargetWire } from "@repo/contract/local/knowledge/knowledge-schema";
import { MAX_CONTEXT_PATHS } from "@repo/contract/local/threads/threads-schema";
import { ACTION_PRESET_LABELS } from "@repo/domain/action-preset";
import type { ActionPreset } from "@repo/domain/action-preset";
import type { LibraryScope } from "@repo/domain/library-scope";
import { LIBRARY_SELECTION_MAX } from "@repo/domain/view-context";
import type { ItemKind } from "@repo/notes/items/item-kind";
import { getLiveEditor } from "@repo/editor/live-editor";
import { Badge } from "@repo/ui/components/badge";
import { Button } from "@repo/ui/components/button";
import { Dialog, DialogPopup } from "@repo/ui/components/dialog";
import { InputMessage } from "@repo/ui/components/input-message";
import { cn } from "@repo/ui/lib/cn";
import { plural } from "@repo/ui/lib/plural";
import { platformShortcutModifier } from "@repo/ui/lib/hotkey-spelling";
import { isImeComposing } from "@repo/ui/lib/ime";
import { radius } from "@repo/ui/lib/radius";
import { surfaceClasses } from "@repo/ui/lib/surface-classes";
import { toast } from "@repo/ui/components/sonner";
import { LibraryIcon, SparklesIcon, XIcon } from "lucide-react";
import { useEffect, useEffectEvent, useId, useRef, useState } from "react";
import type { ReactNode, RefObject } from "react";

import { useSignInNeed } from "../agents/agent-hooks";
import { AgentSignIn } from "../agents/agent-sign-in";
import { failed } from "../api";
import { ensureOpenNoteId } from "../note/open-note-id";
import type { ViewContextSource } from "../thread-activity";
import type { ViewContext } from "@repo/domain/view-context";
import { scopeTitle } from "../library/library-header";
import { TIDY_PLACEHOLDER, TIDY_VIEW_CONTEXT } from "../library/tidy-library";
import { useWikiTargets } from "../vault-hooks";
import { createAction } from "./action-service";
import type { CreateActionArgs } from "./action-service";
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

// what the grid shows and holds selected while no item is open: the subject a message from the
// library is about. `paths` is the first selected, `total` how many (every one shown when `all`)
export interface ComposerSelection {
  scope: Exclude<LibraryScope, { kind: "deleted" }>;
  paths: readonly string[];
  total: number;
  all: boolean;
  kinds?: ItemKind[];
  q?: string;
}

// "3 items", "All in Unsorted", or the scope itself while nothing is selected
export const selectionChipLabel = (selection: ComposerSelection): string => {
  const title = scopeTitle(selection.scope);
  if (selection.total === 0) {
    return title;
  }
  if (selection.all) {
    return selection.scope.kind === "all" ? "All items" : `All in ${title}`;
  }
  return plural(selection.total, "item");
};

const OVER_SELECTION_MAX = `The first ${String(LIBRARY_SELECTION_MAX)} selected items go with your message, along with the view you're in`;

// what rides the send beside the text: a named action's fixed view of Unsorted, else what the
// attached item or the library chip stands for, read as the send leaves; nothing once detached
const sendViewContext = async (subject: {
  preset: ActionPreset | null;
  attachedPath: string | null;
  libraryAttached: boolean;
  readViewContext: ViewContextSource;
}): Promise<ViewContext | null> => {
  if (subject.preset !== null) {
    return TIDY_VIEW_CONTEXT;
  }
  if (subject.attachedPath === null && !subject.libraryAttached) {
    return null;
  }
  return await subject.readViewContext();
};

// a chip's trailing control: detach while attached, attach once detached
const AttachToggle = ({
  attached,
  label,
  onAttachedChange,
}: {
  attached: boolean;
  label: string;
  onAttachedChange: (attached: boolean) => void;
}) =>
  attached ? (
    <Button
      variant="ghost"
      size="icon-compact"
      className="size-4"
      aria-label={label}
      onClick={() => {
        onAttachedChange(false);
      }}
    >
      <XIcon className="size-3" />
    </Button>
  ) : (
    <button
      type="button"
      className="text-muted-foreground hover:text-foreground"
      onClick={() => {
        onAttachedChange(true);
      }}
    >
      attach
    </button>
  );

// The message's subject above the field: a named action's chip, else the open item's or, with
// none open, ONE chip for the library's selection or scope; then the @-mentions.
const ComposerChips = ({
  preset,
  onRemovePreset,
  doc,
  library,
  attached,
  onAttachedChange,
  mentions,
  onRemoveMention,
  mentionsFull,
}: {
  preset: ActionPreset | null;
  onRemovePreset: () => void;
  doc: string | null;
  library: ComposerSelection | null;
  attached: boolean;
  onAttachedChange: (attached: boolean) => void;
  mentions: readonly string[];
  onRemoveMention: (path: string) => void;
  mentionsFull: boolean;
}) => {
  if (preset === null && doc === null && library === null && mentions.length === 0) {
    return null;
  }
  const detached = attached ? undefined : "text-muted-foreground line-through";
  return (
    <>
      {preset === null ? null : (
        <Badge variant="outline" className="gap-1 bg-surface-raised">
          <SparklesIcon className="size-3" />
          {ACTION_PRESET_LABELS[preset]}
          <Button
            variant="ghost"
            size="icon-compact"
            className="size-4"
            aria-label={`Remove ${ACTION_PRESET_LABELS[preset]}`}
            onClick={onRemovePreset}
          >
            <XIcon className="size-3" />
          </Button>
        </Badge>
      )}
      {doc === null ? null : (
        <NoteBadge path={doc} className={detached}>
          <AttachToggle
            attached={attached}
            label="Detach item"
            onAttachedChange={onAttachedChange}
          />
        </NoteBadge>
      )}
      {library === null ? null : (
        <Badge variant="outline" className={cn("gap-1 bg-surface-raised", detached)}>
          <LibraryIcon className="size-3" />
          {selectionChipLabel(library)}
          <AttachToggle
            attached={attached}
            label="Detach the library"
            onAttachedChange={onAttachedChange}
          />
        </Badge>
      )}
      {mentions.map((path) => (
        <NoteBadge key={path} path={path}>
          <Button
            variant="ghost"
            size="icon-compact"
            className="size-4"
            aria-label={`Remove ${path}`}
            onClick={() => {
              onRemoveMention(path);
            }}
          >
            <XIcon className="size-3" />
          </Button>
        </NoteBadge>
      ))}
      {mentionsFull ? (
        <span className="self-center text-caption text-muted-foreground">
          At most {MAX_CONTEXT_PATHS} items can be attached
        </span>
      ) : null}
      {library !== null && attached && library.total > LIBRARY_SELECTION_MAX ? (
        <span className="self-center text-caption text-muted-foreground">{OVER_SELECTION_MAX}</span>
      ) : null}
    </>
  );
};

export interface ActionComposerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  seed: string | null;
  // a named action the composer was opened on (Tidy my library); its chip rides the send
  preset: ActionPreset | null;
  docPath: string | null;
  selection: ComposerSelection | null;
  readViewContext: ViewContextSource;
  onLaunched: (threadId: string) => void;
  // the note column: the composer floats over the note, never over the panel beside it
  container: RefObject<HTMLElement | null>;
}

// Mounted with the popup, so each open asks the vendors again: a sign-in can change outside the
// app. Only a default agent the vendor calls signed out stands in for the field; the text typed or
// seeded so far is the composer's, and waits for it. Nothing is drawn until the statuses answer:
// a field drawn first would be swapped out from under the typing. So the field takes focus
// whenever it appears, at an open that had to wait as after a sign-in.
const SignInFirst = ({
  children,
  onFieldShown,
}: {
  children: ReactNode;
  onFieldShown: () => void;
}) => {
  const need = useSignInNeed(null);
  const fieldShown = need.kind === "none";
  const showField = useEffectEvent(onFieldShown);
  useEffect(() => {
    if (fieldShown) {
      showField();
    }
  }, [fieldShown]);
  switch (need.kind) {
    case "unknown": {
      return null;
    }
    case "none": {
      return children;
    }
    case "sign-in": {
      return (
        <div className={cn("space-y-3 p-3", surfaceClasses(2, 2), radius.container)}>
          <p className="text-subtitle">
            Sign in to ask the agent. It works on your library with your own Claude or ChatGPT plan.
          </p>
          <AgentSignIn />
        </div>
      );
    }
    default: {
      const exhaustive: never = need;
      return exhaustive;
    }
  }
};

export const ActionComposer = ({
  open,
  onOpenChange,
  seed,
  preset,
  docPath,
  selection,
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
  const [presetOn, setPresetOn] = useState(true);
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
      setPresetOn(true);
      setMentions([]);
      setMention(null);
      if (seed !== null) {
        setText(seed);
      }
    }
  }

  const activePreset = presetOn ? preset : null;
  // a named action is about the library, never the item open under it
  const subjectDoc = activePreset === null ? docPath : null;
  const attachedPath = attached ? subjectDoc : null;
  // with no item open, the one chip is the grid's selection or its scope
  const librarySubject = activePreset === null && subjectDoc === null ? selection : null;
  const libraryAttached = librarySubject !== null && attached;

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
    if ((trimmed === "" && activePreset === null) || sending) {
      return;
    }
    setSending(true);
    void (async () => {
      try {
        if (attachedPath !== null) {
          ensureOpenNoteId(attachedPath);
        }
        const args: CreateActionArgs = {
          contextPaths: mentions,
          docPath: attachedPath,
          prompt: trimmed,
          threadId: pending !== null && pending.docPath === attachedPath ? pending.threadId : null,
          viewContext: await sendViewContext({
            attachedPath,
            libraryAttached,
            preset: activePreset,
            readViewContext,
          }),
        };
        if (activePreset !== null) {
          args.preset = activePreset;
        }
        const created = await createAction(args);
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
          onFieldShown={() => {
            focusField()?.focus();
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
                <ComposerChips
                  preset={activePreset}
                  onRemovePreset={() => {
                    setPresetOn(false);
                  }}
                  doc={subjectDoc}
                  library={librarySubject}
                  attached={attached}
                  onAttachedChange={setAttached}
                  mentions={mentions}
                  onRemoveMention={(path) => {
                    setMentions((prior) => prior.filter((kept) => kept !== path));
                  }}
                  mentionsFull={mentionsFull}
                />
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
              placeholder={
                activePreset === null ? "Ask the agent… @ mentions an item" : TIDY_PLACEHOLDER
              }
              sendsEmpty={activePreset !== null}
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
