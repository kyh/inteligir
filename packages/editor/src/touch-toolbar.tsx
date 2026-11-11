// A soft keyboard carries no chord and a finger makes no hover, so every mark, turn-into and
// indent a hardware keyboard reaches is a button here. Each row is named by the table its desktop
// twin reads (the mark chords, the editor's shortcuts, the slash menu), so a rename lands on both
// surfaces at once; only what no table holds is spelled in TOUCH_ACTIONS.
// In-flow chrome, not a popup: pinned to the bottom of a viewport the host sizes above the
// keyboard and holds at scale 1, since iOS zooms into a field whose text is under 16px and the
// chrome speaks the type roles.

import { useState } from "react";
import type { PointerEvent as ReactPointerEvent, ReactNode } from "react";
import { upsertLink } from "@platejs/link";
import { KEYS } from "platejs";
import type { RangeRef } from "platejs";
import {
  createPlatePlugin,
  useEditorReadOnly,
  useEditorRef,
  useMarkToolbarButtonState,
} from "platejs/react";
import {
  BoldIcon,
  CodeIcon,
  ItalicIcon,
  KeyboardOffIcon,
  Link2Icon,
  ListIndentDecreaseIcon,
  ListIndentIncreaseIcon,
  Redo2Icon,
  UnderlineIcon,
  Undo2Icon,
} from "lucide-react";

import { Button } from "@repo/ui/components/button";
import { Separator } from "@repo/ui/components/separator";
import { toast } from "@repo/ui/components/sonner";
import type { IconComponent } from "@repo/ui/lib/icon";

import { CODE_MARK_SHORTCUT, runEditorShortcut } from "@repo/editor/editor-shortcuts";
import { indentBlocks, outdentBlocks } from "@repo/editor/kits/list-kit";
import { MARK_SHORTCUTS } from "@repo/editor/mark-shortcuts";
import type { MarkShortcut, MarkShortcutAction } from "@repo/editor/mark-shortcuts";
import { GROUPS } from "@repo/editor/slash-items";
import type { SlashItem } from "@repo/editor/slash-items";

export const TOUCH_ACTIONS = {
  "hide-keyboard": { icon: KeyboardOffIcon, label: "Hide keyboard" },
  indent: { icon: ListIndentIncreaseIcon, label: "Indent" },
  link: { icon: Link2Icon, label: "Link" },
  outdent: { icon: ListIndentDecreaseIcon, label: "Outdent" },
  redo: { icon: Redo2Icon, label: "Redo" },
  undo: { icon: Undo2Icon, label: "Undo" },
} satisfies Record<string, { icon: IconComponent; label: string }>;

type TouchAction = keyof typeof TOUCH_ACTIONS;

const MARK_ICONS = {
  "toggle-bold": BoldIcon,
  "toggle-italic": ItalicIcon,
  "toggle-underline": UnderlineIcon,
} satisfies Record<MarkShortcutAction, IconComponent>;

// A row the toolbar names that its table lacks is a wiring error, not a button to drop quietly:
// thrown while the module loads, as the marks kit does for a mark with no chord.
const slashRow = (value: string): SlashItem => {
  const item = GROUPS.flatMap((group) => group.items).find(
    (candidate) => candidate.value === value,
  );
  if (item === undefined) {
    throw new Error(`the slash menu has no ${value} row`);
  }
  return item;
};

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

const Sep = () => <Separator orientation="vertical" className="mx-1 h-6" />;

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
      label={CODE_MARK_SHORTCUT.label}
      pressed={pressed}
      onPress={() => {
        runEditorShortcut(editor, CODE_MARK_SHORTCUT.action);
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

// the link's address takes the row
const LinkPrompt = ({
  initialValue,
  onCancel,
  onSubmit,
}: {
  initialValue: string;
  onCancel: () => void;
  onSubmit: (value: string) => void;
}) => {
  const [value, setValue] = useState(initialValue);
  return (
    <form
      className="flex min-w-0 flex-1 items-center gap-1 px-2"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit(value.trim());
      }}
    >
      <Link2Icon className="size-5 shrink-0 text-muted-foreground" />
      <input
        autoCapitalize="none"
        autoCorrect="off"
        enterKeyHint="done"
        inputMode="url"
        type="url"
        autoFocus
        aria-label="Link address"
        placeholder="Paste or type a link…"
        value={value}
        onChange={(event) => {
          setValue(event.target.value);
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

const TouchToolbar = () => {
  const editor = useEditorRef();
  const readOnly = useEditorReadOnly();
  // where the link field's address lands, held while the field has the row; null is the row of
  // buttons. A ref rather than the range: a sync can rebase or re-seed the note under the open
  // field, and a plain range would then land on whatever text took its place.
  const [prompt, setPrompt] = useState<RangeRef | null>(null);
  // what the field held when its text went away under it, offered again when it next opens
  const [draft, setDraft] = useState<string | null>(null);

  const openPrompt = (): void => {
    if (editor.selection !== null) {
      setPrompt(editor.api.rangeRef(editor.selection, { affinity: "inward" }));
    }
  };

  // `value` null is a cancel, and an empty address links nothing
  const closePrompt = (at: RangeRef, value: string | null): void => {
    const range = at.unref();
    setPrompt(null);
    setDraft(null);
    if (value === null || value === "") {
      return;
    }
    if (range === null) {
      setDraft(value);
      toast.warning("The item changed — select the text again.");
    } else {
      editor.tf.select(range);
      upsertLink(editor, { skipValidation: true, url: value });
    }
  };

  if (readOnly) {
    return null;
  }
  return (
    <div
      role="toolbar"
      aria-label="Formatting"
      className="fixed inset-x-0 bottom-0 z-40 flex items-center border-t border-border bg-background pb-[env(safe-area-inset-bottom)] print:hidden"
    >
      {prompt === null ? (
        <>
          <div className="flex min-w-0 flex-1 items-center overflow-x-auto px-1">
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
            <ActionButton action="link" onPress={openPrompt} />
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
          initialValue={draft ?? ""}
          onCancel={() => {
            closePrompt(prompt, null);
            editor.tf.focus();
          }}
          onSubmit={(value) => {
            closePrompt(prompt, value);
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
