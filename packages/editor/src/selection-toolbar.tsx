import { useState } from "react";
import type { MouseEvent as ReactMouseEvent, ReactNode } from "react";
import {
  flip,
  offset,
  shift,
  useFloatingToolbar,
  useFloatingToolbarState,
} from "@platejs/floating";
import { BlockSelectionPlugin } from "@platejs/selection/react";
import {
  Bold01 as BoldIcon,
  ChevronDown as ChevronDownIcon,
  Code01 as CodeIcon,
  FileDownload02 as FileOutputIcon,
  Italic01 as ItalicIcon,
  Link01 as Link2Icon,
  Strikethrough01 as StrikethroughIcon,
  Stars01 as SparklesIcon,
} from "@untitledui/icons";
import { HighlighterIcon } from "lucide-react";
import { KEYS, RangeApi } from "platejs";
import type { RangeRef } from "platejs";
import {
  createPlatePlugin,
  useEditorReadOnly,
  useEditorRef,
  useEditorSelection,
  useEventEditorValue,
  useMarkToolbarButton,
  useMarkToolbarButtonState,
  usePluginOption,
} from "platejs/react";
import type { PlateEditor } from "platejs/react";

import { cn } from "@repo/ui/lib/cn";
import { platformShortcutModifier, spellHotkey } from "@repo/ui/lib/hotkey-spelling";
import { surfaceClasses } from "@repo/ui/lib/surface-classes";

import { askAgentAboutSelection } from "@repo/editor/agent-request";
import { CODE_MARK_SHORTCUT } from "@repo/editor/editor-shortcuts";
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
import { Separator } from "@repo/ui/components/separator";

import {
  TURN_INTO,
  effectiveBlockEntry,
  turnIntoOptionFor,
  turnIntoSelection,
} from "@repo/editor/block-transforms";
import { extractBlocksToNote, selectedTopLevelPaths } from "@repo/editor/extract-note";
import { applyLink, holdSelection } from "@repo/editor/held-selection";

const BAR_CLASS = cn(
  "z-50 flex items-center gap-0.5 rounded-lg p-1 text-popover-foreground animate-in fade-in-0 zoom-in-95",
  surfaceClasses(3),
);

const Sep = () => <Separator orientation="vertical" className="mx-0.5 h-5" />;

const keepSelection = (event: ReactMouseEvent<HTMLElement>) => {
  event.preventDefault();
};

const PRIMARY_TEXT_BUTTON = "rounded-md text-primary hover:text-primary";

const AskAgentButton = ({ editor }: { editor: PlateEditor }) => (
  <>
    <Button
      variant="ghost"
      size="compact"
      leadingIcon={SparklesIcon}
      onClick={() => {
        askAgentAboutSelection(editor);
      }}
      className={PRIMARY_TEXT_BUTTON}
    >
      Ask agent
    </Button>
    <Sep />
  </>
);

const IconButton = ({
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
}) => (
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

const TurnIntoTrigger = ({ children }: { children: ReactNode }) => (
  <DropdownMenuTrigger className="flex h-7 items-center gap-1 rounded-md px-2 text-body font-medium text-foreground/90 transition-colors hover:bg-accent [&_svg]:size-3.5">
    {children}
    <ChevronDownIcon className="!size-3 text-muted-foreground/70" />
  </DropdownMenuTrigger>
);

const markTitle = (nodeType: string) => {
  const row = nodeType === KEYS.code ? CODE_MARK_SHORTCUT : markShortcut(nodeType);

  if (row !== null) {
    return `${row.label} ${spellHotkey(row.hotkey, platformShortcutModifier())}`;
  }

  return nodeType === KEYS.strikethrough ? "Strikethrough" : nodeType;
};

const MarkButton = ({ nodeType, children }: { nodeType: string; children: ReactNode }) => {
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
};

const LinkInput = ({
  initialValue,
  onSubmit,
  onCancel,
}: {
  initialValue: string;
  onSubmit: (url: string) => void;
  onCancel: () => void;
}) => {
  const [url, setUrl] = useState(initialValue);

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
        onChange={(e) => {
          setUrl(e.target.value);
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            onCancel();
          }
        }}
        placeholder="Paste or type a link…"
        className="h-7 w-56 bg-transparent px-1 text-body outline-none placeholder:text-muted-foreground"
      />
      <Button
        variant="ghost"
        size="compact"
        onClick={() => {
          onSubmit(url.trim());
        }}
        className={PRIMARY_TEXT_BUTTON}
      >
        Apply
      </Button>
    </form>
  );
};

type BarMode =
  | { readonly kind: "bar" }
  | { readonly kind: "turn-into"; readonly at: RangeRef }
  | { readonly kind: "link"; readonly at: RangeRef };

const BAR: BarMode = { kind: "bar" };

const SelectionToolbar = () => {
  const editor = useEditorRef();
  const readOnly = useEditorReadOnly();

  const [mode, setMode] = useState<BarMode>(BAR);
  const [draft, setDraft] = useState<string | null>(null);

  const enter = (next: BarMode) => {
    if (mode.kind !== "bar") {
      mode.at.unref();
    }

    setMode(next);
  };

  const hold = (kind: "turn-into" | "link") => {
    const at = holdSelection(editor);

    if (at !== null) {
      enter({ at, kind });
    }
  };

  const backToNote = () => {
    enter(BAR);
    editor.tf.focus();
  };

  const heldRange = () => (mode.kind === "bar" ? null : mode.at.current);

  const focusedEditorId = useEventEditorValue("focus");
  const isSelectingSome = Boolean(usePluginOption(BlockSelectionPlugin, "isSelectingSome"));

  const floatingToolbarState = useFloatingToolbarState({
    editorId: editor.id,
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
    focusedEditorId,
    hideToolbar: isSelectingSome,
  });

  const {
    clickOutsideRef,
    hidden,
    props: rootProps,
    ref: floatingRef,
  } = useFloatingToolbar(floatingToolbarState);

  const rawSelection: unknown = useEditorSelection();
  const selection = RangeApi.isRange(rawSelection) ? rawSelection : null;
  const entry = effectiveBlockEntry(editor, selection ?? heldRange() ?? undefined);
  const typeLabel = entry ? turnIntoOptionFor(entry[0]).label : "Text";

  if (readOnly) {
    if (mode.kind !== "bar") {
      enter(BAR);
    }

    return null;
  }

  if (hidden && mode.kind === "bar") {
    return null;
  }

  return (
    <div ref={clickOutsideRef}>
      <div
        ref={floatingRef}
        role="toolbar"
        tabIndex={-1}
        {...rootProps}
        className={cn(BAR_CLASS, "absolute whitespace-nowrap print:hidden")}
        onMouseDown={keepSelection}
      >
        {mode.kind === "link" ? (
          <LinkInput
            initialValue={draft ?? ""}
            onCancel={() => {
              setDraft(null);
              backToNote();
            }}
            onSubmit={(url) => {
              setDraft(url !== "" && applyLink(editor, mode.at, url) === "moved" ? url : null);
              backToNote();
            }}
          />
        ) : (
          <>
            <AskAgentButton editor={editor} />
            <DropdownMenu
              open={mode.kind === "turn-into"}
              onOpenChange={(open) => {
                if (open) {
                  hold("turn-into");
                } else {
                  enter(BAR);
                }
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
                        const at = heldRange();

                        if (at !== null) {
                          turnIntoSelection(editor, opt, at);
                        }

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
            <MarkButton nodeType={KEYS.highlight}>
              <HighlighterIcon />
            </MarkButton>

            <Sep />

            <IconButton
              onClick={() => {
                hold("link");
              }}
              title="Link"
            >
              <Link2Icon />
            </IconButton>

            <Sep />

            <IconButton
              onClick={() => {
                void extractBlocksToNote(editor, selectedTopLevelPaths(editor));
              }}
              title="Extract to new note"
            >
              <FileOutputIcon />
            </IconButton>
          </>
        )}
      </div>
    </div>
  );
};

export const SelectionToolbarKit = [
  createPlatePlugin({
    key: "selectionToolbar",
    render: { afterEditable: () => <SelectionToolbar /> },
  }),
];
