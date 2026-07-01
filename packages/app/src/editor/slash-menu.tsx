// Slash command menu — adapted from Potion's slash-node.tsx, trimmed to the
// blocks that round-trip cleanly through our markdown serializer. Anything
// without a native markdown form (tables, media, callout, toggle, columns,
// equations, colors) is deliberately omitted: it would render broken or be
// dropped/mangled on the next save, which also kicks the file out of canonical
// (rich) mode. See markdown-doc.ts.

import { HorizontalRulePlugin } from "@platejs/basic-nodes/react";
import { insertCodeBlock } from "@platejs/code-block";
import { SlashInputPlugin, SlashPlugin } from "@platejs/slash-command/react";
import { insertTable } from "@platejs/table";
import {
  Code2Icon,
  Heading1Icon,
  Heading2Icon,
  Heading3Icon,
  InfoIcon,
  ListIcon,
  ListOrderedIcon,
  MinusIcon,
  PenLineIcon,
  PilcrowIcon,
  QuoteIcon,
  SquareCheckIcon,
  Table2Icon,
  WandSparklesIcon,
} from "lucide-react";
import { KEYS } from "platejs";
import type { PlateEditor, PlateElementProps } from "platejs/react";
import { PlateElement } from "platejs/react";

import {
  InlineCombobox,
  InlineComboboxContent,
  InlineComboboxEmpty,
  InlineComboboxGroup,
  InlineComboboxGroupLabel,
  InlineComboboxInput,
  InlineComboboxItem,
} from "@repo/app/editor/inline-combobox";
import { triggerInlineAi } from "@repo/app/editor/selection-toolbar";

// Turn the current block(s) into a plain block type (heading/paragraph/quote),
// clearing any list formatting first.
function turnInto(editor: PlateEditor, type: string) {
  editor.tf.withoutNormalizing(() => {
    for (const [, path] of editor.api.blocks({ mode: "lowest" })) {
      editor.tf.unsetNodes(["listStyleType", "listStart", "indent"], { at: path });
      editor.tf.setNodes({ type }, { at: path });
    }
  });
}

// Lists are indent-based (a paragraph with `indent` + `listStyleType`), matching
// block-list.tsx. "disc" / "decimal" / "todo" are the values it renders. Todo
// items also need `checked` so the markdown serializer emits `- [ ]` (without
// it the item round-trips to a plain bullet).
function turnIntoList(editor: PlateEditor, listStyleType: string, checked?: boolean) {
  const type = editor.getType(KEYS.p);
  editor.tf.withoutNormalizing(() => {
    for (const [, path] of editor.api.blocks({ mode: "lowest" })) {
      editor.tf.setNodes(
        checked === undefined
          ? { type, indent: 1, listStyleType }
          : { type, indent: 1, listStyleType, checked },
        { at: path },
      );
    }
  });
}

// A callout is a GitHub alert blockquote: the leading `[!NOTE]` marker is what
// the editor styles into a colored callout (see markdown-editor's
// BlockquoteElement) and it round-trips as plain markdown.
function insertCallout(editor: PlateEditor) {
  turnInto(editor, editor.getType(KEYS.blockquote));
  editor.tf.insertText("[!NOTE] ");
}

function insertHorizontalRule(editor: PlateEditor) {
  editor.tf.insertNodes(
    { type: HorizontalRulePlugin.key, children: [{ text: "" }] },
    { select: true },
  );
  editor.tf.insertNodes({ type: editor.getType(KEYS.p), children: [{ text: "" }] });
}

type SlashItem = {
  icon: React.ReactNode;
  label: string;
  value: string;
  description: string;
  keywords?: string[];
  onSelect: (editor: PlateEditor) => void;
};

const GROUPS: { group: string; items: SlashItem[] }[] = [
  {
    group: "Ask AI",
    items: [
      {
        icon: <PenLineIcon />,
        label: "Continue writing",
        value: "ai-continue",
        description: "Let AI continue from here.",
        keywords: ["ai", "continue", "write", "autocomplete"],
        onSelect: () => triggerInlineAi("continue"),
      },
      {
        icon: <WandSparklesIcon />,
        label: "Summarize",
        value: "ai-summarize",
        description: "Summarize the selection or note.",
        keywords: ["ai", "summary", "tldr", "recap"],
        onSelect: () => triggerInlineAi("summarize"),
      },
    ],
  },
  {
    group: "Basic blocks",
    items: [
      {
        icon: <PilcrowIcon />,
        label: "Text",
        value: "p",
        description: "Plain paragraph.",
        keywords: ["paragraph", "text"],
        onSelect: (editor) => turnInto(editor, editor.getType(KEYS.p)),
      },
      {
        icon: <Heading1Icon />,
        label: "Heading 1",
        value: "h1",
        description: "Large section heading.",
        keywords: ["title", "h1", "#"],
        onSelect: (editor) => turnInto(editor, editor.getType(KEYS.h1)),
      },
      {
        icon: <Heading2Icon />,
        label: "Heading 2",
        value: "h2",
        description: "Medium section heading.",
        keywords: ["subtitle", "h2", "##"],
        onSelect: (editor) => turnInto(editor, editor.getType(KEYS.h2)),
      },
      {
        icon: <Heading3Icon />,
        label: "Heading 3",
        value: "h3",
        description: "Small section heading.",
        keywords: ["subtitle", "h3", "###"],
        onSelect: (editor) => turnInto(editor, editor.getType(KEYS.h3)),
      },
      {
        icon: <ListIcon />,
        label: "Bulleted list",
        value: "ul",
        description: "Create a bulleted list.",
        keywords: ["unordered", "ul", "-"],
        onSelect: (editor) => turnIntoList(editor, "disc"),
      },
      {
        icon: <ListOrderedIcon />,
        label: "Numbered list",
        value: "ol",
        description: "Create a numbered list.",
        keywords: ["ordered", "ol", "1."],
        onSelect: (editor) => turnIntoList(editor, "decimal"),
      },
      {
        icon: <SquareCheckIcon />,
        label: "To-do list",
        value: "todo",
        description: "Track tasks with checkboxes.",
        keywords: ["checklist", "task", "checkbox", "[]"],
        onSelect: (editor) => turnIntoList(editor, "todo", false),
      },
      {
        icon: <QuoteIcon />,
        label: "Blockquote",
        value: "blockquote",
        description: "Capture a quote.",
        keywords: ["citation", "quote", ">"],
        onSelect: (editor) => turnInto(editor, editor.getType(KEYS.blockquote)),
      },
      {
        icon: <InfoIcon />,
        label: "Callout",
        value: "callout",
        description: "Highlighted note (GitHub alert).",
        keywords: ["callout", "alert", "note", "warning", "tip", "admonition"],
        onSelect: (editor) => insertCallout(editor),
      },
      {
        icon: <Code2Icon />,
        label: "Code block",
        value: "code",
        description: "Capture a code snippet.",
        keywords: ["```", "fenced"],
        onSelect: (editor) => insertCodeBlock(editor),
      },
      {
        icon: <Table2Icon />,
        label: "Table",
        value: "table",
        description: "Add a table with a header row.",
        keywords: ["grid", "rows", "columns"],
        onSelect: (editor) =>
          insertTable(editor, { colCount: 3, rowCount: 3, header: true }, { select: true }),
      },
    ],
  },
  {
    group: "Insert",
    items: [
      {
        icon: <MinusIcon />,
        label: "Divider",
        value: "hr",
        description: "Visually divide blocks.",
        keywords: ["horizontal", "rule", "---"],
        onSelect: (editor) => insertHorizontalRule(editor),
      },
    ],
  },
];

function SlashInputElement(props: PlateElementProps) {
  const { children, editor, element } = props;
  return (
    <PlateElement {...props} as="span">
      <InlineCombobox element={element} trigger="/">
        <InlineComboboxInput />
        <InlineComboboxContent variant="slash">
          <InlineComboboxEmpty>No results</InlineComboboxEmpty>
          {GROUPS.map(({ group, items }) => (
            <InlineComboboxGroup key={group}>
              <InlineComboboxGroupLabel>{group}</InlineComboboxGroupLabel>
              {items.map((item) => (
                <InlineComboboxItem
                  key={item.value}
                  group={group}
                  value={item.value}
                  label={item.label}
                  keywords={item.keywords}
                  onClick={() => item.onSelect(editor)}
                >
                  <div className="flex size-9 items-center justify-center rounded-md border border-foreground/15 bg-background [&_svg]:size-5 [&_svg]:text-muted-foreground">
                    {item.icon}
                  </div>
                  <div className="ml-2.5 flex flex-1 flex-col truncate">
                    <span>{item.label}</span>
                    <span className="truncate text-xs text-muted-foreground">
                      {item.description}
                    </span>
                  </div>
                </InlineComboboxItem>
              ))}
            </InlineComboboxGroup>
          ))}
        </InlineComboboxContent>
      </InlineCombobox>
      {children}
    </PlateElement>
  );
}

export const SlashKit = [
  SlashPlugin.configure({
    options: {
      triggerQuery: (editor) =>
        !editor.api.some({ match: { type: editor.getType(KEYS.codeBlock) } }),
    },
  }),
  SlashInputPlugin.withComponent(SlashInputElement),
];
