// The AI menu — potion's ai-menu behavior rebuilt on Base UI: a popover
// anchored under the selection's block with a free-form prompt input and a
// filtered list of canned actions. Free-form prompts are intent-classified
// host-side; canned actions carry a fixed intent. The generate flow reviews
// in-menu (Accept / Discard / Try again); the edit flow hands off to the
// suggestion review bar.

import * as React from "react";
import { filterWords } from "@platejs/combobox";
import {
  ArrowUpIcon,
  CheckIcon,
  CornerUpLeftIcon,
  Loader2Icon,
  SparklesIcon,
  SquareIcon,
  XIcon,
} from "lucide-react";
import { useEditorRef, usePluginOption } from "platejs/react";

import { cn } from "@repo/ui/lib/utils";
import { Popover, PopoverContent } from "@repo/ui/components/popover";

import {
  acceptGenerate,
  AiSessionPlugin,
  CANNED_ACTIONS,
  cancelActiveRun,
  closeAiMenu,
  discardGenerate,
  dismissAiError,
  retryLastRun,
  runCannedAction,
  submitAiPrompt,
  type AiMenuStatus,
} from "@repo/app/editor/ai/ai-session";

type MenuItem = {
  key: string;
  label: string;
  icon: React.ReactNode;
  run: () => void;
  keywords?: string[];
};

const BUSY_LABEL: Partial<Record<AiMenuStatus, string>> = {
  classifying: "Thinking…",
  generating: "Writing…",
  editing: "Editing…",
};

export function AiMenu() {
  const editor = useEditorRef();
  const status = usePluginOption(AiSessionPlugin, "status");
  const anchor = usePluginOption(AiSessionPlugin, "anchor");
  const error = usePluginOption(AiSessionPlugin, "error");

  const [input, setInput] = React.useState("");
  const [highlight, setHighlight] = React.useState(0);
  // Arrow keys arm item-selection; typing re-arms free-form submit.
  const [navigated, setNavigated] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const open = status !== "closed";

  // Fresh prompt every time the menu opens; re-focus after busy states end.
  React.useEffect(() => {
    if (!open) {
      setInput("");
      setHighlight(0);
      setNavigated(false);
    }
  }, [open]);
  React.useEffect(() => {
    // The submitted prompt was consumed — review offers a fresh follow-up.
    if (status === "review") setInput("");
    if (status === "input" || status === "review") inputRef.current?.focus();
  }, [status]);

  const items = React.useMemo<MenuItem[]>(() => {
    if (status === "review") {
      return [
        {
          key: "accept",
          label: "Accept",
          icon: <CheckIcon />,
          run: () => acceptGenerate(editor),
        },
        {
          key: "discard",
          label: "Discard",
          icon: <XIcon />,
          run: () => discardGenerate(editor),
        },
        {
          key: "retry",
          label: "Try again",
          icon: <CornerUpLeftIcon />,
          run: () => retryLastRun(editor),
        },
      ];
    }
    if (status !== "input") return [];
    return CANNED_ACTIONS.filter(
      (action) =>
        input.length === 0 || [action.label, ...action.keywords].some((k) => filterWords(k, input)),
    ).map((action) => ({
      key: action.id,
      label: action.label,
      icon: <SparklesIcon />,
      keywords: action.keywords,
      run: () => runCannedAction(editor, action.id),
    }));
  }, [status, input, editor]);

  const clampedHighlight = Math.min(highlight, Math.max(items.length - 1, 0));
  const busyLabel = BUSY_LABEL[status];

  const submit = () => {
    const item = items[clampedHighlight];
    // Arrow-navigation arms the highlighted item; otherwise typed text is a
    // free-form prompt, and a bare Enter runs the highlighted item.
    if (navigated && item) return item.run();
    if (input.trim().length > 0) return submitAiPrompt(editor, input);
    if (item) item.run();
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      if (busyLabel) cancelActiveRun(editor);
      else if (status === "review") discardGenerate(editor);
      else if (status === "error") dismissAiError(editor);
      else closeAiMenu(editor);
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (items.length === 0) return;
      const delta = event.key === "ArrowDown" ? 1 : -1;
      setNavigated(true);
      setHighlight((clampedHighlight + delta + items.length) % items.length);
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      submit();
      return;
    }
    if (event.key === "Backspace" && input.length === 0 && status === "input") {
      event.preventDefault();
      closeAiMenu(editor);
    }
  };

  if (!anchor && open) return null;

  return (
    <Popover
      open={open}
      onOpenChange={(next, eventDetails) => {
        if (next) return;
        // Escape during a busy state cancels back to the prompt (Base UI's
        // popup-level Escape fires when DOM focus sits on the popup itself —
        // the input is unmounted then, so its onKeyDown can't intercept).
        // Everything else (outside press, focus-out) closes for real.
        if (eventDetails.reason === "escape-key" && busyLabel) {
          cancelActiveRun(editor);
          return;
        }
        closeAiMenu(editor);
      }}
    >
      <PopoverContent
        anchor={anchor}
        side="bottom"
        align="start"
        sideOffset={8}
        className="w-[420px] max-w-[calc(100vw-24px)] p-0"
        onKeyDown={onKeyDown}
      >
        <div className="flex items-center gap-2 px-3 py-2">
          <SparklesIcon className="size-4 shrink-0 text-primary" />
          {busyLabel ? (
            <>
              <span className="flex grow items-center gap-2 text-sm text-muted-foreground">
                <Loader2Icon className="size-3.5 animate-spin" /> {busyLabel}
              </span>
              <button
                type="button"
                title="Stop"
                onClick={() => cancelActiveRun(editor)}
                className="flex size-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground [&_svg]:size-3"
              >
                <SquareIcon fill="currentColor" />
              </button>
            </>
          ) : status === "error" ? (
            <>
              <span className="grow text-sm text-destructive">{error}</span>
              <button
                type="button"
                title="Dismiss"
                onClick={() => dismissAiError(editor)}
                className="flex size-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground [&_svg]:size-3.5"
              >
                <XIcon />
              </button>
            </>
          ) : (
            <>
              <input
                ref={inputRef}
                autoFocus
                value={input}
                onChange={(event) => {
                  setInput(event.target.value);
                  setHighlight(0);
                  setNavigated(false);
                }}
                placeholder={
                  status === "review" ? "Tell the AI what to change…" : "Ask AI anything…"
                }
                className="h-7 grow bg-transparent text-sm outline-none placeholder:text-muted-foreground"
              />
              <button
                type="button"
                title="Send"
                disabled={input.trim().length === 0}
                onClick={() => submitAiPrompt(editor, input)}
                className={cn(
                  "flex size-6 items-center justify-center rounded-full transition-colors [&_svg]:size-3.5",
                  input.trim().length === 0
                    ? "text-muted-foreground/50"
                    : "bg-primary text-primary-foreground hover:bg-primary/90",
                )}
              >
                <ArrowUpIcon />
              </button>
            </>
          )}
        </div>

        {items.length > 0 && (
          <div className="max-h-[40vh] overflow-y-auto border-t border-border py-1">
            {items.map((item, index) => (
              <div
                key={item.key}
                role="option"
                aria-selected={index === clampedHighlight}
                onMouseEnter={() => setHighlight(index)}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => item.run()}
                className={cn(
                  "mx-1 flex cursor-pointer select-none items-center gap-2 rounded-md px-2 py-1 text-sm text-foreground transition-colors [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-primary",
                  index === clampedHighlight && "bg-accent text-accent-foreground",
                )}
              >
                {item.icon}
                {item.label}
              </div>
            ))}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
