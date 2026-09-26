// A soft keyboard carries no chord and a finger makes no hover, so every mark, turn-into and
// indent a hardware keyboard reaches is a button here. Each row is named by the table its desktop
// twin reads (the mark chords, the editor's shortcuts, the slash menu), so a rename lands on both
// surfaces at once; only what no table holds is spelled in TOUCH_ACTIONS. In-flow chrome, not a
// popup: pinned to the bottom of a viewport the host sizes above the keyboard and holds at scale
// 1, since iOS zooms into a field whose text is under 16px and the chrome speaks the type roles.

import { useState } from "react";
import type { PointerEvent as ReactPointerEvent, ReactNode } from "react";
import { upsertLink } from "@platejs/link";
import { KEYS } from "platejs";
import type { TRange } from "platejs";
import {
  createPlatePlugin,
  useEditorRef,
  useMarkToolbarButtonState,
  useSelectionExpanded,
} from "platejs/react";
import type { PlateEditor } from "platejs/react";
import {
  BoldIcon,
  CodeIcon,
  ImageIcon,
  ItalicIcon,
  KeyboardOffIcon,
  Link2Icon,
  ListIndentDecreaseIcon,
  ListIndentIncreaseIcon,
  Redo2Icon,
  SparklesIcon,
  UnderlineIcon,
  Undo2Icon,
} from "lucide-react";

import { Button } from "@repo/ui/components/button";
import { toast } from "@repo/ui/components/sonner";
import type { IconComponent } from "@repo/ui/lib/icon";

import { useAgentRequestActions } from "@repo/editor/agent-request";
import { EDITOR_SHORTCUTS, runEditorShortcut } from "@repo/editor/editor-shortcuts";
import type { EditorShortcut } from "@repo/editor/editor-shortcuts";
import { getEditorHostIo } from "@repo/editor/host-io";
import type { PickImageResult } from "@repo/editor/host-io";
import { insertVaultImage } from "@repo/editor/kits/image-kit";
import { indentBlocks, outdentBlocks } from "@repo/editor/kits/list-kit";
import { MARK_SHORTCUTS } from "@repo/editor/mark-shortcuts";
import type { MarkShortcut, MarkShortcutAction } from "@repo/editor/mark-shortcuts";
import { GROUPS } from "@repo/editor/slash-menu";
import type { SlashItem } from "@repo/editor/slash-menu";

type TouchAction =
  | "ask-agent"
  | "outdent"
  | "indent"
  | "link"
  | "image"
  | "undo"
  | "redo"
  | "hide-keyboard";

export const TOUCH_ACTIONS = {
  "ask-agent": { icon: SparklesIcon, label: "Ask agent" },
  "hide-keyboard": { icon: KeyboardOffIcon, label: "Hide keyboard" },
  image: { icon: ImageIcon, label: "Add image" },
  indent: { icon: ListIndentIncreaseIcon, label: "Indent" },
  link: { icon: Link2Icon, label: "Link" },
  outdent: { icon: ListIndentDecreaseIcon, label: "Outdent" },
  redo: { icon: Redo2Icon, label: "Redo" },
  undo: { icon: Undo2Icon, label: "Undo" },
} satisfies Record<TouchAction, { icon: IconComponent; label: string }>;

const MARK_ICONS = {
  "toggle-bold": BoldIcon,
  "toggle-italic": ItalicIcon,
  "toggle-underline": UnderlineIcon,
} satisfies Record<MarkShortcutAction, IconComponent>;

// A row the toolbar names that its table lacks is a wiring error, not a button to drop quietly:
// thrown while the module loads, as the marks kit does for a mark with no chord.
const codeMarkRow = (): EditorShortcut => {
  const row = EDITOR_SHORTCUTS.find((candidate) => candidate.action === "toggle-code-mark");
  if (row === undefined) {
    throw new Error("EDITOR_SHORTCUTS has no toggle-code-mark row");
  }
  return row;
};

const slashRow = (value: string): SlashItem => {
  const item = GROUPS.flatMap((group) => group.items).find(
    (candidate) => candidate.value === value,
  );
  if (item === undefined) {
    throw new Error(`the slash menu has no ${value} row`);
  }
  return item;
};

const CODE_MARK_ROW = codeMarkRow();

const TOUCH_TURN_INTO_ROWS: readonly SlashItem[] = [
  "h1",
  "h2",
  "h3",
  "ul",
  "ol",
  "todo",
  "blockquote",
].map(slashRow);

// the press must not take focus from the editor, or the keyboard drops and the caret with it
const keepEditorFocus = (event: ReactPointerEvent<HTMLElement>): void => {
  event.preventDefault();
};

const ToolbarButton = ({
  children,
  disabled = false,
  label,
  onPress,
  pressed,
}: {
  children: ReactNode;
  disabled?: boolean;
  label: string;
  onPress: () => void;
  // only a toggle says whether it is on; a command stays out of the pressed/unpressed pair
  pressed?: boolean;
}) => (
  <Button
    variant="ghost"
    size="icon"
    aria-label={label}
    aria-pressed={pressed}
    active={pressed === true}
    disabled={disabled}
    onPointerDown={keepEditorFocus}
    onClick={onPress}
    className="size-11 rounded-md [&_svg:not([class*='size-'])]:size-5"
  >
    {children}
  </Button>
);

const Sep = () => <div className="mx-1 h-6 w-px shrink-0 bg-border" />;

const MarkButton = ({ row }: { row: MarkShortcut }) => {
  const editor = useEditorRef();
  const { pressed } = useMarkToolbarButtonState({ nodeType: row.mark });
  const Icon = MARK_ICONS[row.action];
  return (
    <ToolbarButton
      label={row.label}
      pressed={pressed}
      onPress={() => {
        editor.tf.toggleMark(row.mark);
      }}
    >
      <Icon />
    </ToolbarButton>
  );
};

const CodeMarkButton = () => {
  const editor = useEditorRef();
  const { pressed } = useMarkToolbarButtonState({ nodeType: KEYS.code });
  return (
    <ToolbarButton
      label={CODE_MARK_ROW.label}
      pressed={pressed}
      onPress={() => {
        runEditorShortcut(editor, CODE_MARK_ROW.action);
      }}
    >
      <CodeIcon />
    </ToolbarButton>
  );
};

const ActionButton = ({
  action,
  disabled = false,
  onPress,
}: {
  action: TouchAction;
  disabled?: boolean;
  onPress: () => void;
}) => {
  const { icon: Icon, label } = TOUCH_ACTIONS[action];
  return (
    <ToolbarButton label={label} disabled={disabled} onPress={onPress}>
      <Icon />
    </ToolbarButton>
  );
};

const AskAgentButton = ({ editor }: { editor: PlateEditor }) => {
  const actions = useAgentRequestActions((state) => state.actions);
  const expanded = useSelectionExpanded();
  if (actions === null) {
    return null;
  }
  return (
    <>
      <ActionButton
        action="ask-agent"
        disabled={!expanded}
        onPress={() => {
          const { selection } = editor;
          const text = selection ? editor.api.string(selection) : "";
          if (text.trim() !== "") {
            actions.askAboutSelection(text);
          }
        }}
      />
      <Sep />
    </>
  );
};

// Never rejects: the press has already happened, so a rejection would reach nobody.
const pickImageInto = async (
  editor: PlateEditor,
  pickImage: () => Promise<PickImageResult>,
): Promise<void> => {
  let picked: PickImageResult;
  try {
    picked = await pickImage();
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    toast.error(`Couldn't add the image — ${detail}`);
    return;
  }
  if (picked.kind === "picked") {
    insertVaultImage(editor, picked.path);
  } else if (picked.kind === "refused") {
    toast.error(picked.message);
  }
};

const LinkPrompt = ({
  onCancel,
  onSubmit,
}: {
  onCancel: () => void;
  onSubmit: (url: string) => void;
}) => {
  const [url, setUrl] = useState("");
  return (
    <form
      className="flex min-w-0 flex-1 items-center gap-1 px-2"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit(url.trim());
      }}
    >
      <Link2Icon className="size-5 shrink-0 text-muted-foreground" />
      <input
        autoFocus
        type="url"
        inputMode="url"
        autoCapitalize="none"
        autoCorrect="off"
        enterKeyHint="done"
        aria-label="Link address"
        placeholder="Paste or type a link…"
        value={url}
        onChange={(event) => {
          setUrl(event.target.value);
        }}
        className="h-11 min-w-0 flex-1 bg-transparent px-1 text-title outline-none placeholder:text-muted-foreground"
      />
      <Button variant="ghost" size="compact" className="h-11" onClick={onCancel}>
        Cancel
      </Button>
      <Button variant="ghost" size="compact" type="submit" className="h-11 text-primary">
        Apply
      </Button>
    </form>
  );
};

export const TouchToolbar = () => {
  const editor = useEditorRef();
  // where the link lands, held while the prompt has the focus; null is the row of buttons
  const [linkAt, setLinkAt] = useState<TRange | null>(null);
  const { pickImage } = getEditorHostIo();

  return (
    <div
      role="toolbar"
      aria-label="Formatting"
      className="fixed inset-x-0 bottom-0 z-40 flex items-center border-t border-border bg-background pb-[env(safe-area-inset-bottom)] print:hidden"
    >
      {linkAt === null ? (
        <>
          <div className="flex min-w-0 flex-1 items-center overflow-x-auto px-1">
            <AskAgentButton editor={editor} />
            {MARK_SHORTCUTS.map((row) => (
              <MarkButton key={row.action} row={row} />
            ))}
            <CodeMarkButton />
            <Sep />
            {TOUCH_TURN_INTO_ROWS.map((item) => (
              <ToolbarButton
                key={item.value}
                label={item.label}
                onPress={() => {
                  item.onSelect(editor);
                }}
              >
                {item.icon}
              </ToolbarButton>
            ))}
            <ActionButton
              action="outdent"
              onPress={() => {
                outdentBlocks(editor);
              }}
            />
            <ActionButton
              action="indent"
              onPress={() => {
                indentBlocks(editor);
              }}
            />
            <Sep />
            <ActionButton
              action="link"
              onPress={() => {
                setLinkAt(editor.selection);
              }}
            />
            {pickImage === null ? null : (
              <ActionButton
                action="image"
                onPress={() => {
                  void pickImageInto(editor, pickImage);
                }}
              />
            )}
            <Sep />
            <ActionButton
              action="undo"
              onPress={() => {
                editor.tf.undo();
              }}
            />
            <ActionButton
              action="redo"
              onPress={() => {
                editor.tf.redo();
              }}
            />
          </div>
          <ActionButton
            action="hide-keyboard"
            onPress={() => {
              editor.tf.blur();
            }}
          />
        </>
      ) : (
        <LinkPrompt
          onCancel={() => {
            setLinkAt(null);
            editor.tf.focus();
          }}
          onSubmit={(url) => {
            setLinkAt(null);
            if (url !== "") {
              editor.tf.select(linkAt);
              upsertLink(editor, { skipValidation: true, url });
            }
            editor.tf.focus();
          }}
        />
      )}
    </div>
  );
};

export const TouchToolbarKit = [
  createPlatePlugin({
    key: "touch-toolbar",
    render: { afterEditable: () => <TouchToolbar /> },
  }),
];
