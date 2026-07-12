import {
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";
import {
  flip,
  offset,
  shift,
  useFloatingToolbar,
  useFloatingToolbarState,
} from "@platejs/floating";
import { wrapLink } from "@platejs/link";
import { BlockSelectionPlugin } from "@platejs/selection/react";
import {
  BoldIcon,
  ChevronDownIcon,
  CodeIcon,
  ItalicIcon,
  Link2Icon,
  SparklesIcon,
  StrikethroughIcon,
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
import { Button } from "@repo/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@repo/ui/components/dropdown-menu";

import { AiSessionPlugin, openAiMenu } from "@renderer/editor/ai/ai-session";
import {
  TURN_INTO,
  effectiveBlockEntry,
  turnIntoLabelFor,
  turnIntoSelection,
} from "@renderer/editor/block-transforms";

// Elevation: toolbars sit on the menu tier (shadow-surface-4). animate-in
// runs once on mount.
const BAR_CLASS =
  "z-50 flex items-center gap-0.5 rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-surface-4 animate-in fade-in-0 zoom-in-95";

function Sep() {
  return <div className="mx-0.5 h-5 w-px shrink-0 bg-border" />;
}

// A compact icon toggle (marks) on the stock ghost icon button. `onMouseDown`
// preventDefault keeps the editor selection alive through the click so the
// mark applies to it. Stock Button styles aria-expanded but not aria-pressed,
// so the pressed classes ride className.
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
    <Button
      variant="ghost"
      size="icon-sm"
      title={title}
      aria-pressed={pressed}
      onMouseDown={onMouseDown}
      onClick={onClick}
      className="rounded-md text-foreground/80 aria-pressed:bg-accent aria-pressed:text-accent-foreground"
    >
      {children}
    </Button>
  );
}

// A real Base UI Menu.Trigger (must render inside <DropdownMenu>): a detached
// controlled menu anchored to a plain button ref closes itself with reason
// `trigger-hover` as soon as the pointer travels from the button into the
// popup — every mouse click on an item died mid-flight (keyboard worked).
// The registered trigger gives Base UI the correct press/hover linkage.
// `onMouseDown` preventDefault keeps the editor selection alive through the
// opening click.
function TurnIntoTrigger({ children }: { children: ReactNode }) {
  return (
    <DropdownMenuTrigger
      onMouseDown={(e) => e.preventDefault()}
      className="flex h-7 items-center gap-1 rounded-md px-2 text-xs font-medium text-foreground/90 transition-colors hover:bg-accent [&_svg]:size-3.5"
    >
      {children}
      <ChevronDownIcon className="!size-3 text-muted-foreground/70" />
    </DropdownMenuTrigger>
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
 * selection: **Ask AI** (opens the AI menu on the selection), **Turn into**
 * (with a current-block-type indicator), the **Bold / Italic / Strikethrough
 * / Code** marks, and a **Link** input. Positioning rides
 * useFloatingToolbar (flip/shift/offset, hides on blur/collapse); the bar
 * also hides while the AI menu is open — the menu owns the selection then.
 * Only GFM-round-tripping marks are offered.
 */
export function SelectionToolbar() {
  const editor = useEditorRef();

  const [openMenu, setOpenMenu] = useState<null | "turn">(null);
  const [linkMode, setLinkMode] = useState(false);
  // While a Base UI menu or the link input holds focus the hook's hide
  // conditions fire (blur, collapsed selection) — `frozen` short-circuits
  // them and the bar keeps its last computed position. Base UI portals
  // escape clickOutsideRef, so this explicit gate is the reliable one.
  const frozen = openMenu !== null || linkMode;

  // Remember the live selection at the moment an action starts — opening a
  // popover or the link input moves DOM focus off the editable and collapses
  // it. Captured when the menu opens (editor.selection has settled), not via
  // an effect (which races Slate's throttled selection sync).
  const savedSel = useRef<typeof editor.selection>(null);
  const remember = () => {
    savedSel.current = editor.selection;
  };

  const focusedEditorId = useEventEditorValue("focus");
  const isSelectingSome = usePluginOption(BlockSelectionPlugin, "isSelectingSome");
  const aiMenuOpen = usePluginOption(AiSessionPlugin, "status") !== "closed";

  const floatingToolbarState = useFloatingToolbarState({
    editorId: editor.id,
    focusedEditorId,
    hideToolbar: isSelectingSome || aiMenuOpen,
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

  if ((hidden && !frozen) || aiMenuOpen) return null;

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
            <button
              type="button"
              // preventDefault keeps the editor selection alive through the
              // click; openAiMenu captures it as the session's target.
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => openAiMenu(editor)}
              className="flex h-7 items-center gap-1 rounded-md px-2 text-xs font-medium text-primary transition-colors hover:bg-accent [&_svg]:size-3.5"
            >
              <SparklesIcon />
              Ask AI
            </button>

            <Sep />

            <DropdownMenu
              open={openMenu === "turn"}
              onOpenChange={(o) => {
                if (o) remember();
                setOpenMenu(o ? "turn" : null);
              }}
            >
              <TurnIntoTrigger>{typeLabel}</TurnIntoTrigger>
              {/* ignore-click-outside/toolbar: the portaled popup escapes the
                  hook's clickOutsideRef; without the ignore class a mousedown
                  on a menu item flips the hook's open state, display:none-s
                  the bar, and the popup (anchored to the hidden trigger)
                  jumps away before mouseup — items become unclickable. */}
              <DropdownMenuContent
                side="bottom"
                align="start"
                className="ignore-click-outside/toolbar"
              >
                <DropdownMenuLabel>Turn into</DropdownMenuLabel>
                {TURN_INTO.map((opt) => (
                  <DropdownMenuItem
                    key={opt.label}
                    onClick={() => {
                      turnIntoSelection(editor, opt, savedSel.current ?? undefined);
                      editor.tf.focus();
                    }}
                  >
                    {opt.label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>

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
