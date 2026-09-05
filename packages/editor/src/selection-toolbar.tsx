import { useMemo, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
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
  FileOutputIcon,
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
import { EDITOR_SHORTCUTS } from "@repo/editor/editor-shortcuts";
import { platformShortcutModifier, spellHotkey } from "@repo/editor/hotkey-spelling";
import { markShortcut } from "@repo/editor/mark-shortcuts";
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
import { extractBlocksToNote, selectedTopLevelPaths } from "@repo/editor/extract-note";
import { BarButton } from "@repo/editor/toolbar-button";

const BAR_CLASS =
  "z-50 flex items-center gap-0.5 rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-surface-4 animate-in fade-in-0 zoom-in-95";

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

// mousedown preventDefault keeps the editor selection alive through the click. Button styles
// aria-expanded but not aria-pressed, so the pressed classes ride className.
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
      size="icon-compact"
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

// must be a real Menu.Trigger: a detached controlled menu anchored to a plain button closes
// with reason `trigger-hover` as the pointer moves into the popup, so mouse clicks on items die.
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

// the tooltip is the table's label and chord, so it cannot disagree with the palette's page;
// a mark with no chord still needs a name on the button
function markTitle(nodeType: string): string {
  const row =
    nodeType === KEYS.code
      ? (EDITOR_SHORTCUTS.find((candidate) => candidate.action === "toggle-code-mark") ?? null)
      : markShortcut(nodeType);
  if (row !== null) return `${row.label} ${spellHotkey(row.hotkey, platformShortcutModifier())}`;
  return nodeType === KEYS.strikethrough ? "Strikethrough" : nodeType;
}

function MarkButton({ nodeType, children }: { nodeType: string; children: ReactNode }) {
  const { props } = useMarkToolbarButton(useMarkToolbarButtonState({ nodeType }));
  return (
    <IconButton
      pressed={props.pressed}
      onMouseDown={props.onMouseDown}
      onClick={props.onClick}
      title={markTitle(nodeType)}
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

export function SelectionToolbar() {
  const editor = useEditorRef();

  const [openMenu, setOpenMenu] = useState<null | "turn">(null);
  const [linkMode, setLinkMode] = useState(false);
  // base ui portals escape clickOutsideRef, so the hook's hide conditions (blur, collapsed
  // selection) fire while a menu or the link input holds focus; `frozen` short-circuits them.
  const frozen = openMenu !== null || linkMode;

  // captured when the menu opens, not in an effect (which races Slate's throttled selection
  // sync); state rather than a ref because the type indicator reads it while rendering.
  const [savedSel, setSavedSel] = useState<typeof editor.selection>(null);
  const remember = () => setSavedSel(editor.selection);

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

  const selection = useEditorSelection();
  const typeLabel = useMemo(() => {
    const at = selection ?? savedSel ?? undefined;
    const entry = effectiveBlockEntry(editor, at);
    return entry ? turnIntoOptionFor(entry[0]).label : "Text";
  }, [selection, savedSel, editor]);

  if (hidden && !frozen) return null;

  // ignore-click-outside/toolbar: without it a mousedown on a portaled menu item flips the
  // hook's open state, hides the bar, and the popup anchored to the hidden trigger jumps away
  // before mouseup.
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
              const at = savedSel;
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
                        turnIntoSelection(editor, opt, savedSel ?? undefined);
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

            <MarkButton nodeType={KEYS.bold}>
              <BoldIcon />
            </MarkButton>
            <MarkButton nodeType={KEYS.italic}>
              <ItalicIcon />
            </MarkButton>
            <MarkButton nodeType={KEYS.strikethrough}>
              <StrikethroughIcon />
            </MarkButton>
            <MarkButton nodeType={KEYS.code}>
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

            <Sep />

            <IconButton
              onClick={() => {
                void extractBlocksToNote(editor, selectedTopLevelPaths(editor));
              }}
              onMouseDown={(e) => e.preventDefault()}
              title="Extract to new note"
            >
              <FileOutputIcon />
            </IconButton>
          </>
        )}
      </div>
    </div>
  );
}
