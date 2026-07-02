import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { flip, offset, shift, useFloatingToolbar, useFloatingToolbarState } from "@platejs/floating";
import { wrapLink } from "@platejs/link";
import { BlockSelectionPlugin } from "@platejs/selection/react";
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
import {
  useEditorRef,
  useEditorSelection,
  useEventEditorValue,
  useMarkToolbarButton,
  useMarkToolbarButtonState,
  usePluginOption,
} from "platejs/react";

import { cn } from "@repo/ui/lib/utils";
import { Menu, MenuContent, MenuGroup, MenuGroupLabel, MenuItem } from "@repo/ui/components/menu";

import {
  TURN_INTO,
  effectiveBlockEntry,
  turnIntoLabelFor,
  turnIntoSelection,
} from "@repo/app/editor/block-transforms";
import { useInlineAi, type InlineAiStatus } from "@repo/app/editor/inline-ai";

// Track the pending range's viewport rect for the BUSY states (loading /
// pending / error): the selection collapses during streaming and DOM focus
// may sit in a popover, so @platejs/floating's focus-driven hook is wrong
// here — a plain selectionchange listener re-reads on every status
// transition (the pending text is programmatically selected, so its rect
// appears then). The idle toolbar does NOT use this path.
function usePendingRect(status: InlineAiStatus): DOMRect | null {
  const [rect, setRect] = useState<DOMRect | null>(null);
  useEffect(() => {
    const update = () => {
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0) {
        setRect(null);
        return;
      }
      const r = sel.getRangeAt(0).getBoundingClientRect();
      setRect(r.width > 0 || r.height > 0 ? r : null);
    };
    update();
    document.addEventListener("selectionchange", update);
    return () => document.removeEventListener("selectionchange", update);
  }, [status]);
  return rect;
}

const BAR_CLASS =
  "z-50 flex items-center gap-0.5 rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-md";

// Fixed-position shell for the busy states (viewport-clamped above the rect).
function FloatingBar({ rect, children }: { rect: DOMRect; children: ReactNode }) {
  const left = Math.min(Math.max(rect.left + rect.width / 2, 180), window.innerWidth - 180);
  const top = Math.max(rect.top - 46, 8);
  return (
    <div
      style={{ position: "fixed", top, left, transform: "translateX(-50%)" }}
      className={BAR_CLASS}
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

type InlineAiController = ReturnType<typeof useInlineAi>;

/**
 * The editor's selection toolbar — a potion-style floating bar over a text
 * selection: an **Ask AI** dropdown (Improve / Shorten / Fix grammar / Continue
 * / Summarize), **Turn into** (with a current-block-type indicator), the
 * **Bold / Italic / Strikethrough / Code** marks, and a **Link** input.
 *
 * Dual-path positioning (the AI state machine survives the @platejs/floating
 * swap): the IDLE bar rides useFloatingToolbar (flip/shift/offset, hides on
 * blur/collapse); the BUSY bar (loading → "Generating…", pending →
 * Accept/Discard/Retry, error) keeps the selectionchange-rect path because
 * the hook's hide conditions are all true mid-stream. Both render the same
 * bar shell. Only GFM-round-tripping marks are offered.
 */
export function SelectionToolbar() {
  const editor = useEditorRef();
  const controller = useInlineAi(editor);

  // Let slash commands drive the same controller (they can't call the hook).
  useEffect(() => registerInlineAiRunner(controller.run), [controller.run]);

  if (controller.status.kind !== "idle") return <BusyToolbar controller={controller} />;
  return <IdleToolbar controller={controller} />;
}

function BusyToolbar({ controller }: { controller: InlineAiController }) {
  const { status, run, accept, discard, dismissError } = controller;
  const rect = usePendingRect(status);
  if (!rect || status.kind === "idle") return null;

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
  return (
    <FloatingBar rect={rect}>
      <span className="px-1 text-xs text-destructive">{status.message}</span>
      <BarButton variant="danger" onClick={dismissError}>
        <XIcon />
      </BarButton>
    </FloatingBar>
  );
}

function IdleToolbar({ controller }: { controller: InlineAiController }) {
  const editor = useEditorRef();
  const { run } = controller;

  const [openMenu, setOpenMenu] = useState<null | "ai" | "turn">(null);
  const [linkMode, setLinkMode] = useState(false);
  // While a Base UI menu or the link input holds focus the hook's hide
  // conditions fire (blur, collapsed selection) — `frozen` short-circuits
  // them and the bar keeps its last computed position. Base UI portals
  // escape clickOutsideRef, so this explicit gate is the reliable one.
  const frozen = openMenu !== null || linkMode;

  const aiRef = useRef<HTMLButtonElement | null>(null);
  const turnRef = useRef<HTMLButtonElement | null>(null);

  // Remember the live selection at the moment an action starts — opening a
  // popover or the link input moves DOM focus off the editable and collapses
  // it. Captured on the click (when editor.selection has settled), not via an
  // effect (which races Slate's throttled selection sync).
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

  const focusedEditorId = useEventEditorValue("focus");
  const isSelectingSome = usePluginOption(BlockSelectionPlugin, "isSelectingSome");

  const floatingToolbarState = useFloatingToolbarState({
    editorId: editor.id,
    focusedEditorId,
    hideToolbar: isSelectingSome,
    floatingOptions: {
      middleware: [
        offset({ crossAxis: -24, mainAxis: 12 }),
        shift({ padding: 50 }),
        flip({
          fallbackPlacements: ["top-start", "top-end", "bottom-start", "bottom-end"],
          padding: 12,
        }),
      ],
      placement: "top-start",
    },
  });
  const {
    clickOutsideRef,
    hidden,
    props: rootProps,
    ref: floatingRef,
  } = useFloatingToolbar(floatingToolbarState);

  // Current-block-type indicator on the Turn-into trigger (a toggle's
  // summary row reads as the toggle).
  const selection = useEditorSelection();
  const typeLabel = useMemo(() => {
    const at = selection ?? savedSel.current ?? undefined;
    const entry = effectiveBlockEntry(editor, at);
    return entry ? turnIntoLabelFor(entry[0]) : "Text";
  }, [selection, editor]);

  if (hidden && !frozen) return null;

  return (
    <div ref={clickOutsideRef}>
      <div
        ref={floatingRef}
        {...rootProps}
        className={cn(BAR_CLASS, "absolute whitespace-nowrap print:hidden")}
        onMouseDown={(e) => e.preventDefault()}
      >
        {linkMode ? (
          <LinkInput
            onCancel={() => setLinkMode(false)}
            onSubmit={(url) => {
              setLinkMode(false);
              // Wrap the remembered range directly (`at`), so we don't depend
              // on restoring editor focus/selection after the input stole it.
              const at = savedSel.current;
              if (url && at) {
                wrapLink(editor, { url, at, split: true });
                editor.tf.focus();
              }
            }}
          />
        ) : (
          <>
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
              {typeLabel}
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
          </>
        )}
      </div>
    </div>
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
