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
  LanguagesIcon,
  Loader2Icon,
  SparklesIcon,
  SquareIcon,
  XIcon,
} from "lucide-react";
import { RangeApi } from "platejs";
import { useEditorRef, usePluginOption } from "platejs/react";

import { cn } from "@repo/ui/lib/utils";
import { Button } from "@repo/ui/components/button";
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
  runTranslate,
  submitAiPrompt,
  TRANSLATE_LANGUAGES,
  type AiMenuStatus,
} from "@renderer/editor/ai/ai-session";

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
  const savedSelection = usePluginOption(AiSessionPlugin, "savedSelection");
  // Potion's command-set split: selected text offers the edit set
  // (improve/longer/shorter/…), a bare caret offers the generate set.
  const hasSelection = savedSelection !== null && RangeApi.isExpanded(savedSelection);

  const [input, setInput] = React.useState("");
  const [highlight, setHighlight] = React.useState(0);
  // Arrow keys arm item-selection; typing re-arms free-form submit.
  const [navigated, setNavigated] = React.useState(false);
  // Two-page menu: Translate opens a flat language list (Base UI nested
  // submenus misbehave here — see block-menu.tsx).
  const [page, setPage] = React.useState<"root" | "translate">("root");
  const inputRef = React.useRef<HTMLInputElement>(null);
  const open = status !== "closed";

  const resetList = () => {
    setInput("");
    setHighlight(0);
    setNavigated(false);
  };

  // Fresh prompt every time the menu opens; re-focus after busy states end.
  React.useEffect(() => {
    if (!open) {
      setInput("");
      setHighlight(0);
      setNavigated(false);
      setPage("root");
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
    if (page === "translate") {
      return TRANSLATE_LANGUAGES.filter(
        (lang) => input.length === 0 || filterWords(lang, input),
      ).map((lang) => ({
        key: `translate-${lang}`,
        label: lang,
        icon: <LanguagesIcon />,
        run: () => runTranslate(editor, lang),
      }));
    }
    const scoped = CANNED_ACTIONS.filter(
      (action) => action.scope === (hasSelection ? "selection" : "cursor"),
    );
    const items: MenuItem[] = scoped
      .filter(
        (action) =>
          input.length === 0 ||
          [action.label, ...action.keywords].some((k) => filterWords(k, input)),
      )
      .map((action) => ({
        key: action.id,
        label: action.label,
        icon: <SparklesIcon />,
        keywords: action.keywords,
        run: () => runCannedAction(editor, action.id),
      }));
    if (
      hasSelection &&
      (input.length === 0 || ["Translate", "language"].some((k) => filterWords(k, input)))
    ) {
      items.push({
        key: "translate",
        label: "Translate",
        icon: <LanguagesIcon />,
        run: () => {
          setPage("translate");
          resetList();
        },
      });
    }
    return items;
  }, [status, input, editor, page, hasSelection]);

  const clampedHighlight = Math.min(highlight, Math.max(items.length - 1, 0));
  const busyLabel = BUSY_LABEL[status];

  const submit = () => {
    const item = items[clampedHighlight];
    // The language page only runs list items — typed text just filters.
    if (page === "translate") return item?.run();
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
      else if (page === "translate") {
        setPage("root");
        resetList();
      } else closeAiMenu(editor);
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
      if (page === "translate") {
        setPage("root");
        resetList();
      } else closeAiMenu(editor);
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
              <Button
                variant="ghost"
                size="icon-xs"
                title="Stop"
                onClick={() => cancelActiveRun(editor)}
                className="rounded-md text-muted-foreground"
              >
                <SquareIcon fill="currentColor" />
              </Button>
            </>
          ) : status === "error" ? (
            <>
              <span className="grow text-sm text-destructive">{error}</span>
              <Button
                variant="ghost"
                size="icon-xs"
                title="Dismiss"
                onClick={() => dismissAiError(editor)}
                className="rounded-md text-muted-foreground"
              >
                <XIcon className="size-3.5" />
              </Button>
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
                  page === "translate"
                    ? "Translate to…"
                    : status === "review"
                      ? "Tell the AI what to change…"
                      : "Ask AI anything…"
                }
                className="h-7 grow bg-transparent text-sm outline-none placeholder:text-muted-foreground"
              />
              <Button
                size="icon-xs"
                title="Send"
                disabled={input.trim().length === 0}
                onClick={() => submitAiPrompt(editor, input)}
                className={cn(
                  "rounded-full",
                  // Empty input reads as a faint affordance, not a dimmed
                  // primary pill.
                  input.trim().length === 0 &&
                    "bg-transparent text-muted-foreground/50 disabled:opacity-100",
                )}
              >
                <ArrowUpIcon className="size-3.5" />
              </Button>
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
