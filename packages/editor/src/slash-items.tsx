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
import type { PlateEditor } from "platejs/react";

import { turnIntoOption, turnIntoSelection } from "@repo/editor/block-transforms";
import type { TurnIntoId } from "@repo/editor/block-transforms";
import {
  insertCanvasBlock,
  insertChartBlock,
  insertHtmlBlock,
} from "@repo/editor/kits/rich-blocks-kit";
import { insertTabGroup } from "@repo/editor/kits/tabs-kit";
import { EmbedPromptPlugin } from "@repo/editor/embed-url-dialog";
import { insertHorizontalRule } from "@repo/editor/kits/basic-blocks-kit";
import { insertMermaid } from "@repo/editor/kits/code-block-kit";
import { insertColumnGroup } from "@repo/editor/kits/column-kit";
import { insertDate, insertMonthDate } from "@repo/editor/kits/date-kit";
import { insertEquation, insertInlineEquation } from "@repo/editor/kits/math-kit";
import { insertToggle } from "@repo/editor/kits/toggle-kit";

export interface SlashItem {
  icon: React.ReactNode;
  label: string;
  value: string;
  description: string;
  keywords?: string[];
  richBlock?: true;
  onSelect: (editor: PlateEditor) => void;
}

const turnIntoRow = (
  id: TurnIntoId,
  row: Pick<SlashItem, "description" | "icon" | "keywords" | "value">,
) =>
  ({
    ...row,
    label: turnIntoOption(id).label,
    onSelect: (editor) => {
      turnIntoSelection(editor, turnIntoOption(id));
    },
  }) satisfies SlashItem;

export const GROUPS: { group: string; items: SlashItem[] }[] = [
  {
    group: "Basic blocks",
    items: [
      turnIntoRow("text", {
        description: "Plain paragraph.",
        icon: <PilcrowIcon />,
        keywords: ["paragraph", "text"],
        value: "p",
      }),
      turnIntoRow("heading-1", {
        description: "Large section heading.",
        icon: <Heading1Icon />,
        keywords: ["title", "h1", "#"],
        value: "h1",
      }),
      turnIntoRow("heading-2", {
        description: "Medium section heading.",
        icon: <Heading2Icon />,
        keywords: ["subtitle", "h2", "##"],
        value: "h2",
      }),
      turnIntoRow("heading-3", {
        description: "Small section heading.",
        icon: <Heading3Icon />,
        keywords: ["subtitle", "h3", "###"],
        value: "h3",
      }),
      turnIntoRow("bulleted-list", {
        description: "Create a bulleted list.",
        icon: <ListIcon />,
        keywords: ["unordered", "ul", "-"],
        value: "ul",
      }),
      turnIntoRow("numbered-list", {
        description: "Create a numbered list.",
        icon: <ListOrderedIcon />,
        keywords: ["ordered", "ol", "1."],
        value: "ol",
      }),
      turnIntoRow("todo-list", {
        description: "Track tasks with checkboxes.",
        icon: <SquareCheckIcon />,
        keywords: ["checklist", "task", "checkbox", "[]"],
        value: "todo",
      }),
      {
        description: "Collapsible block.",
        icon: <ChevronRightIcon />,
        keywords: ["toggle", "collapsible", "details", "expandable", "+"],
        label: "Toggle",
        onSelect: (editor) => {
          insertToggle(editor);
        },
        value: "toggle",
      },
      turnIntoRow("quote", {
        description: "Capture a quote.",
        icon: <QuoteIcon />,
        keywords: ["citation", "quote", ">"],
        value: "blockquote",
      }),
      turnIntoRow("callout", {
        description: "Note, tip, important, warning or caution.",
        icon: <InfoIcon />,
        keywords: ["callout", "alert", "note", "warning", "tip", "admonition"],
        value: "callout",
      }),
      turnIntoRow("code-block", {
        description: "Capture a code snippet.",
        icon: <Code2Icon />,
        keywords: ["```", "fenced"],
        value: "code",
      }),
      {
        description: "Add a table with a header row.",
        icon: <Table2Icon />,
        keywords: ["grid", "rows", "columns"],
        label: "Table",
        onSelect: (editor) => {
          insertTable(editor, { colCount: 3, header: true, rowCount: 3 }, { select: true });
        },
        value: "table",
      },
      {
        description: "Display math block (KaTeX).",
        icon: <RadicalIcon />,
        keywords: ["math", "katex", "tex", "latex", "$$"],
        label: "Equation",
        onSelect: (editor) => {
          insertEquation(editor);
        },
        value: "equation",
      },
    ],
  },
  {
    group: "Advanced",
    items: [
      {
        description: "Peer views inspected one at a time.",
        icon: <PanelsTopLeftIcon />,
        keywords: ["tabs", "tab", "panels", "switch"],
        label: "Tabs",
        onSelect: (editor) => {
          insertTabGroup(editor);
        },
        richBlock: true,
        value: "tabs",
      },
      {
        description: "Bar, line, area or stacked-bar over labeled values.",
        icon: <BarChart3Icon />,
        keywords: ["chart", "graph", "bar", "line", "area", "plot", "data"],
        label: "Chart",
        onSelect: (editor) => {
          insertChartBlock(editor);
        },
        richBlock: true,
        value: "chart",
      },
      {
        description: "A rough spatial sketch with labels.",
        icon: <PencilRulerIcon />,
        keywords: ["canvas", "sketch", "draw", "wireframe", "spatial"],
        label: "Canvas",
        onSelect: (editor) => {
          insertCanvasBlock(editor);
        },
        richBlock: true,
        value: "canvas",
      },
      {
        description: "A sandboxed interactive HTML artifact.",
        icon: <AppWindowIcon />,
        keywords: ["html", "prototype", "interactive", "embed", "artifact"],
        label: "HTML",
        onSelect: (editor) => {
          insertHtmlBlock(editor);
        },
        richBlock: true,
        value: "html",
      },
      {
        description: "Two side-by-side columns.",
        icon: <Columns2Icon />,
        keywords: ["columns", "layout", "side", "split"],
        label: "2 columns",
        onSelect: (editor) => {
          insertColumnGroup(editor, 2);
        },
        richBlock: true,
        value: "columns-2",
      },
      {
        description: "Three side-by-side columns.",
        icon: <Columns3Icon />,
        keywords: ["columns", "layout", "grid"],
        label: "3 columns",
        onSelect: (editor) => {
          insertColumnGroup(editor, 3);
        },
        richBlock: true,
        value: "columns-3",
      },
      {
        description: "Diagram-as-code with live preview.",
        icon: <WorkflowIcon />,
        keywords: ["diagram", "chart", "flowchart", "graph", "mermaid"],
        label: "Mermaid diagram",
        onSelect: (editor) => {
          insertMermaid(editor);
        },
        value: "mermaid",
      },
    ],
  },
  {
    group: "Inline",
    items: [
      {
        description: "Inline date chip (today).",
        icon: <CalendarIcon />,
        keywords: ["date", "day", "today", "calendar", "@"],
        label: "Date",
        onSelect: (editor) => {
          insertDate(editor);
        },
        value: "date",
      },
      {
        description: "This month as a date chip (its first day).",
        icon: <CalendarIcon />,
        keywords: ["month", "date"],
        label: "Month",
        onSelect: (editor) => {
          insertMonthDate(editor);
        },
        value: "month",
      },
      {
        description: "Math within a sentence.",
        icon: <SigmaIcon />,
        keywords: ["math", "inline", "formula", "tex"],
        label: "Inline equation",
        onSelect: (editor) => {
          insertInlineEquation(editor);
        },
        value: "inline-equation",
      },
    ],
  },
  {
    group: "Media",
    items: [
      {
        description: "A video, tweet, PDF or page by URL, opened in your browser.",
        icon: <FilmIcon />,
        keywords: ["youtube", "tweet", "twitter", "pdf", "embed", "video", "link"],
        label: "Embed",
        onSelect: (editor) => {
          editor.setOption(EmbedPromptPlugin, "open", true);
        },
        value: "embed",
      },
    ],
  },
  {
    group: "Insert",
    items: [
      {
        description: "Visually divide blocks.",
        icon: <MinusIcon />,
        keywords: ["horizontal", "rule", "---"],
        label: "Divider",
        onSelect: (editor) => {
          insertHorizontalRule(editor);
        },
        value: "hr",
      },
    ],
  },
];
