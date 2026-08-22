// Slash command menu covering the full locked vocabulary: basic
// blocks, toggle, columns, date, equations, mermaid, embeds — every insert
// routes through the shared kit transforms so the bytes each item produces
// are the canonical fixture forms. Grouping + keywords follow potion's
// slash-node (reference-only). Block conversions route through
// block-transforms.ts (one turn-into source for slash, menus, and toolbar).
//
// The `[[` wiki-link picker (wiki-autocomplete.tsx) is another inline-combobox
// consumer following the emoji-input pattern.

import { SlashInputPlugin, SlashPlugin } from "@platejs/slash-command/react";
import { insertTable } from "@platejs/table";
import {
  PencilRulerIcon,
  BarChart3Icon,
  AppWindowIcon,
  CalendarIcon,
  ChevronRightIcon,
  Code2Icon,
  Columns2Icon,
  Columns3Icon,
  FilmIcon,
  Heading1Icon,
  Heading2Icon,
  Heading3Icon,
  InfoIcon,
  ListIcon,
  ListOrderedIcon,
  MinusIcon,
  PilcrowIcon,
  QuoteIcon,
  RadicalIcon,
  SigmaIcon,
  SquareCheckIcon,
  Table2Icon,
  WorkflowIcon,
  PanelsTopLeftIcon,
} from "lucide-react";
import { KEYS } from "platejs";
import type { PlateEditor, PlateElementProps } from "platejs/react";
import { PlateElement, createPlatePlugin } from "platejs/react";

import { TURN_INTO, turnIntoSelection } from "@repo/editor/block-transforms";
import {
  insertCanvasBlock,
  insertChartBlock,
  insertHtmlBlock,
} from "@repo/editor/kits/moss-blocks-kit";
import { insertTabGroup } from "@repo/editor/kits/tabs-kit";
import { EmbedUrlDialogHost, openEmbedUrlDialog } from "@repo/editor/embed-url-dialog";
import {
  InlineCombobox,
  InlineComboboxContent,
  InlineComboboxEmpty,
  InlineComboboxGroup,
  InlineComboboxGroupLabel,
  InlineComboboxInput,
  InlineComboboxItem,
} from "@repo/editor/inline-combobox";
import { insertHorizontalRule } from "@repo/editor/kits/basic-blocks-kit";
import { insertMermaid } from "@repo/editor/kits/code-block-kit";
import { insertColumnGroup } from "@repo/editor/kits/column-kit";
import { insertDate } from "@repo/editor/kits/date-kit";
import { insertEquation, insertInlineEquation } from "@repo/editor/kits/math-kit";
import { insertToggle } from "@repo/editor/kits/toggle-kit";

function turnInto(editor: PlateEditor, label: string): void {
  const opt = TURN_INTO.find((o) => o.label === label);
  if (opt) turnIntoSelection(editor, opt);
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
    group: "Basic blocks",
    items: [
      {
        icon: <PilcrowIcon />,
        label: "Text",
        value: "p",
        description: "Plain paragraph.",
        keywords: ["paragraph", "text"],
        onSelect: (editor) => turnInto(editor, "Text"),
      },
      {
        icon: <Heading1Icon />,
        label: "Heading 1",
        value: "h1",
        description: "Large section heading.",
        keywords: ["title", "h1", "#"],
        onSelect: (editor) => turnInto(editor, "Heading 1"),
      },
      {
        icon: <Heading2Icon />,
        label: "Heading 2",
        value: "h2",
        description: "Medium section heading.",
        keywords: ["subtitle", "h2", "##"],
        onSelect: (editor) => turnInto(editor, "Heading 2"),
      },
      {
        icon: <Heading3Icon />,
        label: "Heading 3",
        value: "h3",
        description: "Small section heading.",
        keywords: ["subtitle", "h3", "###"],
        onSelect: (editor) => turnInto(editor, "Heading 3"),
      },
      {
        icon: <ListIcon />,
        label: "Bulleted list",
        value: "ul",
        description: "Create a bulleted list.",
        keywords: ["unordered", "ul", "-"],
        onSelect: (editor) => turnInto(editor, "Bulleted list"),
      },
      {
        icon: <ListOrderedIcon />,
        label: "Numbered list",
        value: "ol",
        description: "Create a numbered list.",
        keywords: ["ordered", "ol", "1."],
        onSelect: (editor) => turnInto(editor, "Numbered list"),
      },
      {
        icon: <SquareCheckIcon />,
        label: "To-do list",
        value: "todo",
        description: "Track tasks with checkboxes.",
        keywords: ["checklist", "task", "checkbox", "[]"],
        onSelect: (editor) => turnInto(editor, "To-do list"),
      },
      {
        icon: <ChevronRightIcon />,
        label: "Toggle",
        value: "toggle",
        description: "Collapsible block.",
        keywords: ["toggle", "collapsible", "details", "expandable", "+"],
        onSelect: (editor) => insertToggle(editor),
      },
      {
        icon: <QuoteIcon />,
        label: "Blockquote",
        value: "blockquote",
        description: "Capture a quote.",
        keywords: ["citation", "quote", ">"],
        onSelect: (editor) => turnInto(editor, "Quote"),
      },
      {
        icon: <InfoIcon />,
        label: "Callout",
        value: "callout",
        description: "Highlighted note (info, warning, priority).",
        keywords: ["callout", "alert", "note", "warning", "tip", "admonition"],
        onSelect: (editor) => turnInto(editor, "Callout"),
      },
      {
        icon: <Code2Icon />,
        label: "Code block",
        value: "code",
        description: "Capture a code snippet.",
        keywords: ["```", "fenced"],
        onSelect: (editor) => turnInto(editor, "Code block"),
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
      {
        icon: <RadicalIcon />,
        label: "Equation",
        value: "equation",
        description: "Display math block (KaTeX).",
        keywords: ["math", "katex", "tex", "latex", "$$"],
        onSelect: (editor) => insertEquation(editor),
      },
    ],
  },
  {
    group: "Advanced",
    items: [
      {
        icon: <PanelsTopLeftIcon />,
        label: "Tabs",
        value: "tabs",
        description: "Peer views inspected one at a time.",
        keywords: ["tabs", "tab", "panels", "switch"],
        onSelect: (editor) => {
          insertTabGroup(editor);
        },
      },
      {
        icon: <BarChart3Icon />,
        label: "Chart",
        value: "chart",
        description: "Bar, line, area or stacked-bar over labeled values.",
        keywords: ["chart", "graph", "bar", "line", "area", "plot", "data"],
        onSelect: (editor) => {
          insertChartBlock(editor);
        },
      },
      {
        icon: <PencilRulerIcon />,
        label: "Canvas",
        value: "canvas",
        description: "A rough spatial sketch with labels.",
        keywords: ["canvas", "sketch", "draw", "wireframe", "spatial"],
        onSelect: (editor) => {
          insertCanvasBlock(editor);
        },
      },
      {
        icon: <AppWindowIcon />,
        label: "HTML",
        value: "html",
        description: "A sandboxed interactive HTML artifact.",
        keywords: ["html", "prototype", "interactive", "embed", "artifact"],
        onSelect: (editor) => {
          insertHtmlBlock(editor);
        },
      },
      {
        icon: <Columns2Icon />,
        label: "2 columns",
        value: "columns-2",
        description: "Two side-by-side columns.",
        keywords: ["columns", "layout", "side", "split"],
        onSelect: (editor) => insertColumnGroup(editor, 2),
      },
      {
        icon: <Columns3Icon />,
        label: "3 columns",
        value: "columns-3",
        description: "Three side-by-side columns.",
        keywords: ["columns", "layout", "grid"],
        onSelect: (editor) => insertColumnGroup(editor, 3),
      },
      {
        icon: <WorkflowIcon />,
        label: "Mermaid diagram",
        value: "mermaid",
        description: "Diagram-as-code with live preview.",
        keywords: ["diagram", "chart", "flowchart", "graph", "mermaid"],
        onSelect: (editor) => insertMermaid(editor),
      },
    ],
  },
  {
    group: "Inline",
    items: [
      {
        icon: <CalendarIcon />,
        label: "Date",
        value: "date",
        description: "Inline date chip (today).",
        keywords: ["date", "today", "calendar", "@"],
        onSelect: (editor) => insertDate(editor),
      },
      {
        icon: <SigmaIcon />,
        label: "Inline equation",
        value: "inline-equation",
        description: "Math within a sentence.",
        keywords: ["math", "inline", "formula", "tex"],
        onSelect: (editor) => insertInlineEquation(editor),
      },
    ],
  },
  {
    group: "Media",
    items: [
      {
        icon: <FilmIcon />,
        label: "Embed",
        value: "embed",
        description: "YouTube, tweet, PDF, or iframe by URL.",
        keywords: ["youtube", "tweet", "twitter", "pdf", "iframe", "embed", "video"],
        onSelect: () => openEmbedUrlDialog(),
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
  // The Embed item's URL prompt lives outside the (self-unmounting) combobox.
  createPlatePlugin({
    key: "embed-url-dialog",
    render: { afterEditable: () => <EmbedUrlDialogHost /> },
  }),
];
