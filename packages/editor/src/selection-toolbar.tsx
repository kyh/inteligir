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
  StrikethroughIcon,
  SparklesIcon,
} from "lucide-react";
import { KEYS } from "platejs";
import {
  useEditorRef,
  useEditorSelection,
  useEventEditorValue,
  useMarkToolbarButton,
  useMarkToolbarButtonState,
  usePluginOption,
  type PlateEditor,
} from "platejs/react";

import { cn } from "@repo/ui/lib/utils";

import { useAgentRequestActions } from "@repo/editor/agent-request";
import { Button } from "@repo/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@repo/ui/components/dropdown-menu";

import {
  TURN_INTO,
  effectiveBlockEntry,
  turnIntoOptionFor,
  turnIntoSelection,
} from "@repo/editor/block-transforms";
import { BarButton } from "@repo/editor/toolbar-button";

// Elevation: toolbars sit on the menu tier (shadow-surface-4). animate-in
// runs once on mount.
const BAR_CLASS =
  "z-50 flex items-center gap-0.5 rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-surface-4 animate-in fade-in-0 zoom-in-95";

// "Ask agent" appears only while the app registered an agent surface — the
// module-store discipline agent-request.ts states. preventDefault keeps the
// editor selection alive through the click; the SELECTION TEXT travels, so
// the composer opens already quoting what the user was pointing at.
function AskAgentButton({ editor }: { editor: PlateEditor }) {
  const actions = useAgentRequestActions((state) => state.actions);
  if (actions === null) return null;
  return (
    <>
      <button
        type="button"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => {
          const selection = editor.selection;
          const text = selection ? editor.api.string(selection) : "";
          if (text.trim() !== "") actions.askAboutSelection(text);
        }}
        className="flex h-7 items-center gap-1 rounded-md px-2 text-xs font-medium text-primary transition-colors hover:bg-accent [&_svg]:size-3.5"
      >
        <SparklesIcon />
        Ask agent
      </button>
      <Sep />
    </>
  );
}

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
    return entry ? turnIntoOptionFor(entry[0]).label : "Text";
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
            <AskAgentButton editor={editor} />
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
                <DropdownMenuGroup>
                  <DropdownMenuLabel>Turn into</DropdownMenuLabel>
                  {TURN_INTO.map((opt) => (
                    <DropdownMenuItem
                      key={opt.id}
                      onClick={() => {
                        turnIntoSelection(editor, opt, savedSel.current ?? undefined);
                        editor.tf.focus();
                      }}
                    >
                      {opt.label}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuGroup>
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
