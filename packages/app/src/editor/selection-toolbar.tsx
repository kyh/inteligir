import {
  useEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { wrapLink } from "@platejs/link";
import {
  BoldIcon,
  CheckIcon,
  ChevronDownIcon,
  CodeIcon,
  ItalicIcon,
  Link2Icon,
  Loader2Icon,
  SparklesIcon,
  StrikethroughIcon,
  XIcon,
} from "lucide-react";
import { KEYS } from "platejs";
import { useEditorRef, useMarkToolbarButton, useMarkToolbarButtonState } from "platejs/react";

import { cn } from "@repo/ui/lib/utils";
import { Menu, MenuContent, MenuGroup, MenuGroupLabel, MenuItem } from "@repo/ui/components/menu";

import { TURN_INTO, turnIntoSelection } from "./block-transforms";
import { useInlineAi, type InlineAiStatus } from "./inline-ai";

// Track the current selection's viewport rect so the floating bar can anchor to
// it. Re-reads on selection change and on any status transition (the pending
// text is programmatically selected, so its rect appears then). While `frozen`
// (a dropdown/link input is open) it stops updating so opening a popover — which
// moves DOM focus and collapses the selection — doesn't yank the bar away.
function useSelectionRect(status: InlineAiStatus, frozen: boolean): DOMRect | null {
  const [rect, setRect] = useState<DOMRect | null>(null);
  useEffect(() => {
    if (frozen) return;
    const update = () => {
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0) {
        setRect(null);
        return;
      }
      // Idle only wants a real (non-collapsed) selection to offer actions.
      if (status.kind === "idle" && sel.isCollapsed) {
        setRect(null);
        return;
      }
      const r = sel.getRangeAt(0).getBoundingClientRect();
      setRect(r.width > 0 || r.height > 0 ? r : null);
    };
    update();
    document.addEventListener("selectionchange", update);
    return () => document.removeEventListener("selectionchange", update);
  }, [status, frozen]);
  return rect;
}

function FloatingBar({ rect, children }: { rect: DOMRect; children: ReactNode }) {
  // Above the selection, horizontally centred, clamped to the viewport.
  const left = Math.min(Math.max(rect.left + rect.width / 2, 180), window.innerWidth - 180);
  const top = Math.max(rect.top - 46, 8);
  return (
    <div
      style={{ position: "fixed", top, left, transform: "translateX(-50%)" }}
      className="z-50 flex items-center gap-0.5 rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-md"
      onMouseDown={(e) => e.preventDefault()}
    >
      {children}
    </div>
  );
}

function Sep() {
  return <div className="mx-0.5 h-5 w-px shrink-0 bg-border" />;
}

// A compact icon toggle (marks). `onMouseDown` preventDefault keeps the editor
// selection alive through the click so the mark applies to it.
function IconButton({
  pressed,
  onClick,
  onMouseDown,
  title,
  children,
}: {
  pressed?: boolean;
  onClick: () => void;
  onMouseDown?: (e: ReactMouseEvent<HTMLButtonElement>) => void;
  title: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-pressed={pressed}
      onMouseDown={onMouseDown}
      onClick={onClick}
      className={cn(
        "flex size-7 items-center justify-center rounded-md text-foreground/80 transition-colors hover:bg-accent [&_svg]:size-4",
        pressed && "bg-accent text-accent-foreground",
      )}
    >
      {children}
    </button>
  );
}

function DropdownTrigger({
  triggerRef,
  onOpen,
  children,
}: {
  triggerRef: RefObject<HTMLButtonElement | null>;
  onOpen: () => void;
  children: ReactNode;
}) {
  return (
    <button
      ref={triggerRef}
      type="button"
      onMouseDown={(e) => e.preventDefault()}
      onClick={onOpen}
      className="flex h-7 items-center gap-1 rounded-md px-2 text-xs font-medium text-foreground/90 transition-colors hover:bg-accent [&_svg]:size-3.5"
    >
      {children}
      <ChevronDownIcon className="!size-3 text-muted-foreground/70" />
    </button>
  );
}

function MarkButton({
  nodeType,
  title,
  children,
}: {
  nodeType: string;
  title: string;
  children: ReactNode;
}) {
  const { props } = useMarkToolbarButton(useMarkToolbarButtonState({ nodeType }));
  return (
    <IconButton
      pressed={props.pressed}
      onMouseDown={props.onMouseDown}
      onClick={props.onClick}
      title={title}
    >
      {children}
    </IconButton>
  );
}

function BarButton({
  onClick,
  children,
  variant = "default",
}: {
  onClick: () => void;
  children: ReactNode;
  variant?: "default" | "primary" | "danger";
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition-colors",
        variant === "default" && "text-foreground hover:bg-accent",
        variant === "primary" && "text-primary hover:bg-primary/10",
        variant === "danger" && "text-muted-foreground hover:bg-muted hover:text-destructive",
        "[&_svg]:size-3.5",
      )}
    >
      {children}
    </button>
  );
}

// The five AI actions, surfaced under the "Ask AI" dropdown.
const AI_ACTIONS: {
  action: "improve" | "shorter" | "grammar" | "continue" | "summarize";
  label: string;
}[] = [
  { action: "improve", label: "Improve writing" },
  { action: "grammar", label: "Fix spelling & grammar" },
  { action: "shorter", label: "Make shorter" },
  { action: "continue", label: "Continue writing" },
  { action: "summarize", label: "Summarize" },
];

function LinkInput({
  onSubmit,
  onCancel,
}: {
  onSubmit: (url: string) => void;
  onCancel: () => void;
}) {
  const [url, setUrl] = useState("");
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(url.trim());
      }}
      className="flex items-center gap-1"
    >
      <Link2Icon className="ml-1 size-3.5 shrink-0 text-muted-foreground" />
      <input
        autoFocus
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") onCancel();
        }}
        placeholder="Paste or type a link…"
        className="h-7 w-56 bg-transparent px-1 text-xs outline-none placeholder:text-muted-foreground"
      />
      <BarButton variant="primary" onClick={() => onSubmit(url.trim())}>
        Apply
      </BarButton>
    </form>
  );
}

/**
 * The editor's selection toolbar — a potion-style floating bar over a text
 * selection: an **Ask AI** dropdown (Improve / Shorten / Fix grammar / Continue
 * / Summarize), **Turn into** (block type), the **Bold / Italic / Strikethrough
 * / Code** marks, and a **Link** input. While the isolated AI agent runs it
 * shows a "Generating…" chip, then an Accept / Discard bar over the proposed
 * text. Slash commands (Continue / Summarize) route into the same AI flow via
 * the shared runner below.
 *
 * Only GFM-round-tripping marks are offered (no underline/color — they have no
 * markdown form and would silently drop on save).
 */
export function SelectionToolbar() {
  const editor = useEditorRef();
  const controller = useInlineAi(editor);
  const { status, run, accept, discard, dismissError } = controller;

  // Let slash commands drive the same controller (they can't call the hook).
  useEffect(() => registerInlineAiRunner(run), [run]);

  const [openMenu, setOpenMenu] = useState<null | "ai" | "turn">(null);
  const [linkMode, setLinkMode] = useState(false);
  const frozen = openMenu !== null || linkMode;
  const rect = useSelectionRect(status, frozen);

  const aiRef = useRef<HTMLButtonElement | null>(null);
  const turnRef = useRef<HTMLButtonElement | null>(null);

  // Remember the live selection at the moment an action starts — opening a
  // popover or the link input moves DOM focus off the editable and collapses it.
  // Captured on the click (when editor.selection has settled), not via an effect
  // (which races Slate's throttled selection sync and grabs a stale range).
  const savedSel = useRef<typeof editor.selection>(null);
  const remember = () => {
    savedSel.current = editor.selection;
  };
  // Run an action against the remembered selection: restore the model range
  // first (so an expanded selection stays expanded — a link needs it), then
  // focus. Focusing before selecting collapses the range.
  const withSelection = (fn: () => void) => {
    if (savedSel.current) editor.tf.select(savedSel.current);
    fn();
    editor.tf.focus();
  };

  if (!rect) return null;

  if (status.kind === "loading") {
    return (
      <FloatingBar rect={rect}>
        <span className="flex items-center gap-1.5 px-1 text-xs text-muted-foreground">
          <Loader2Icon className="size-3.5 animate-spin" /> Generating…
        </span>
      </FloatingBar>
    );
  }
  if (status.kind === "pending") {
    return (
      <FloatingBar rect={rect}>
        <BarButton variant="primary" onClick={accept}>
          <CheckIcon /> Accept
        </BarButton>
        <BarButton variant="danger" onClick={discard}>
          <XIcon /> Discard
        </BarButton>
        <BarButton onClick={() => run(status.action)}>Retry</BarButton>
      </FloatingBar>
    );
  }
  if (status.kind === "error") {
    return (
      <FloatingBar rect={rect}>
        <span className="px-1 text-xs text-destructive">{status.message}</span>
        <BarButton variant="danger" onClick={dismissError}>
          <XIcon />
        </BarButton>
      </FloatingBar>
    );
  }

  if (linkMode) {
    return (
      <FloatingBar rect={rect}>
        <LinkInput
          onCancel={() => setLinkMode(false)}
          onSubmit={(url) => {
            setLinkMode(false);
            // Wrap the remembered range directly (`at`), so we don't depend on
            // restoring editor focus/selection after the input stole focus.
            const at = savedSel.current;
            if (url && at) {
              wrapLink(editor, { url, at, split: true });
              editor.tf.focus();
            }
          }}
        />
      </FloatingBar>
    );
  }

  return (
    <FloatingBar rect={rect}>
      <DropdownTrigger
        triggerRef={aiRef}
        onOpen={() => {
          remember();
          setOpenMenu("ai");
        }}
      >
        <SparklesIcon className="text-primary" />
        <span className="text-primary">Ask AI</span>
      </DropdownTrigger>
      <Menu open={openMenu === "ai"} onOpenChange={(o) => setOpenMenu(o ? "ai" : null)}>
        <MenuContent anchor={aiRef} side="bottom" align="start">
          {AI_ACTIONS.map(({ action, label }) => (
            <MenuItem key={action} onClick={() => withSelection(() => run(action))}>
              {label}
            </MenuItem>
          ))}
        </MenuContent>
      </Menu>

      <Sep />

      <DropdownTrigger
        triggerRef={turnRef}
        onOpen={() => {
          remember();
          setOpenMenu("turn");
        }}
      >
        Turn into
      </DropdownTrigger>
      <Menu open={openMenu === "turn"} onOpenChange={(o) => setOpenMenu(o ? "turn" : null)}>
        <MenuContent anchor={turnRef} side="bottom" align="start">
          <MenuGroup>
            <MenuGroupLabel>Turn into</MenuGroupLabel>
            {TURN_INTO.map((opt) => (
              <MenuItem
                key={opt.label}
                onClick={() => {
                  turnIntoSelection(editor, opt, savedSel.current ?? undefined);
                  editor.tf.focus();
                }}
              >
                {opt.label}
              </MenuItem>
            ))}
          </MenuGroup>
        </MenuContent>
      </Menu>

      <Sep />

      <MarkButton nodeType={KEYS.bold} title="Bold ⌘B">
        <BoldIcon />
      </MarkButton>
      <MarkButton nodeType={KEYS.italic} title="Italic ⌘I">
        <ItalicIcon />
      </MarkButton>
      <MarkButton nodeType={KEYS.strikethrough} title="Strikethrough">
        <StrikethroughIcon />
      </MarkButton>
      <MarkButton nodeType={KEYS.code} title="Code ⌘E">
        <CodeIcon />
      </MarkButton>

      <Sep />

      <IconButton
        onClick={() => {
          remember();
          setLinkMode(true);
        }}
        onMouseDown={(e) => e.preventDefault()}
        title="Link"
      >
        <Link2Icon />
      </IconButton>
    </FloatingBar>
  );
}

// A tiny module-level bridge so slash-menu items (which run outside React) can
// trigger the AI flow owned by the mounted toolbar.
let activeRunner: ((action: Parameters<ReturnType<typeof useInlineAi>["run"]>[0]) => void) | null =
  null;

function registerInlineAiRunner(run: typeof activeRunner): () => void {
  activeRunner = run;
  return () => {
    if (activeRunner === run) activeRunner = null;
  };
}

export function triggerInlineAi(action: "continue" | "summarize"): void {
  activeRunner?.(action);
}
