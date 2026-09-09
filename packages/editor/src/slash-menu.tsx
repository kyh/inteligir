// every item inserts through a kit transform so its bytes are the canonical fixture form.

import { SlashInputPlugin, SlashPlugin } from "@platejs/slash-command/react";
import { insertTable } from "@platejs/table";
import {
  FileTextIcon,
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
import { useEffect, useState } from "react";

import type { WikiTarget } from "@repo/notes/knowledge/link-graph-index";
import { isTemplatePath } from "@repo/notes/templates/placeholders";

import { turnIntoOption, turnIntoSelection } from "@repo/editor/block-transforms";
import type { TurnIntoId } from "@repo/editor/block-transforms";
import { getEditorHostIo } from "@repo/editor/host-io";
import { insertTemplate } from "@repo/editor/insert-template";
import {
  insertCanvasBlock,
  insertChartBlock,
  insertHtmlBlock,
} from "@repo/editor/kits/rich-blocks-kit";
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
import { insertDate, insertMonthDate } from "@repo/editor/kits/date-kit";
import { insertEquation, insertInlineEquation } from "@repo/editor/kits/math-kit";
import { insertToggle } from "@repo/editor/kits/toggle-kit";

const turnInto = (editor: PlateEditor, id: TurnIntoId): void => {
  turnIntoSelection(editor, turnIntoOption(id));
};

interface SlashItem {
  icon: React.ReactNode;
  label: string;
  value: string;
  description: string;
  keywords?: string[];
  onSelect: (editor: PlateEditor) => void;
}

const GROUPS: { group: string; items: SlashItem[] }[] = [
  {
    group: "Basic blocks",
    items: [
      {
        description: "Plain paragraph.",
        icon: <PilcrowIcon />,
        keywords: ["paragraph", "text"],
        label: "Text",
        onSelect: (editor) => {
          turnInto(editor, "text");
        },
        value: "p",
      },
      {
        description: "Large section heading.",
        icon: <Heading1Icon />,
        keywords: ["title", "h1", "#"],
        label: "Heading 1",
        onSelect: (editor) => {
          turnInto(editor, "heading-1");
        },
        value: "h1",
      },
      {
        description: "Medium section heading.",
        icon: <Heading2Icon />,
        keywords: ["subtitle", "h2", "##"],
        label: "Heading 2",
        onSelect: (editor) => {
          turnInto(editor, "heading-2");
        },
        value: "h2",
      },
      {
        description: "Small section heading.",
        icon: <Heading3Icon />,
        keywords: ["subtitle", "h3", "###"],
        label: "Heading 3",
        onSelect: (editor) => {
          turnInto(editor, "heading-3");
        },
        value: "h3",
      },
      {
        description: "Create a bulleted list.",
        icon: <ListIcon />,
        keywords: ["unordered", "ul", "-"],
        label: "Bulleted list",
        onSelect: (editor) => {
          turnInto(editor, "bulleted-list");
        },
        value: "ul",
      },
      {
        description: "Create a numbered list.",
        icon: <ListOrderedIcon />,
        keywords: ["ordered", "ol", "1."],
        label: "Numbered list",
        onSelect: (editor) => {
          turnInto(editor, "numbered-list");
        },
        value: "ol",
      },
      {
        description: "Track tasks with checkboxes.",
        icon: <SquareCheckIcon />,
        keywords: ["checklist", "task", "checkbox", "[]"],
        label: "To-do list",
        onSelect: (editor) => {
          turnInto(editor, "todo-list");
        },
        value: "todo",
      },
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
      {
        description: "Capture a quote.",
        icon: <QuoteIcon />,
        keywords: ["citation", "quote", ">"],
        label: "Blockquote",
        onSelect: (editor) => {
          turnInto(editor, "quote");
        },
        value: "blockquote",
      },
      {
        description: "Highlighted note (info, warning, priority).",
        icon: <InfoIcon />,
        keywords: ["callout", "alert", "note", "warning", "tip", "admonition"],
        label: "Callout",
        onSelect: (editor) => {
          turnInto(editor, "callout");
        },
        value: "callout",
      },
      {
        description: "Capture a code snippet.",
        icon: <Code2Icon />,
        keywords: ["```", "fenced"],
        label: "Code block",
        onSelect: (editor) => {
          turnInto(editor, "code-block");
        },
        value: "code",
      },
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
        keywords: ["date", "today", "calendar", "@"],
        label: "Date",
        onSelect: (editor) => {
          insertDate(editor);
        },
        value: "date",
      },
      {
        description: "Today as a date chip.",
        icon: <CalendarIcon />,
        keywords: ["day", "today", "date"],
        label: "Day",
        onSelect: (editor) => {
          insertDate(editor);
        },
        value: "day",
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
        description: "YouTube, tweet, PDF, or iframe by URL.",
        icon: <FilmIcon />,
        keywords: ["youtube", "tweet", "twitter", "pdf", "iframe", "embed", "video"],
        label: "Embed",
        onSelect: () => {
          openEmbedUrlDialog();
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

const TEMPLATES_GROUP = "Templates";

// a template is a row only while it exists: the list is read when the menu opens rather than
// pinned in GROUPS, and the group is absent when the folder is.
const templateItems = (targets: readonly WikiTarget[]): SlashItem[] =>
  targets
    .filter((target) => isTemplatePath(target.path))
    .map((target) => ({
      description: target.path,
      icon: <FileTextIcon />,
      keywords: ["template"],
      label: target.title,
      onSelect: (editor) => {
        void insertTemplate(editor, target.path);
      },
      value: `template:${target.path}`,
    }));

const useTemplateItems = (): SlashItem[] => {
  const [items, setItems] = useState<SlashItem[]>([]);
  useEffect(() => {
    let live = true;
    const load = async (): Promise<void> => {
      try {
        const targets = await getEditorHostIo().listWikiTargets();
        if (live) {
          setItems(templateItems(targets));
        }
      } catch {
        // an unanswered listing is no group, not an error to show
      }
    };
    void load();
    return () => {
      live = false;
    };
  }, []);
  return items;
};

const SlashInputElement = (props: PlateElementProps) => {
  const { editor, element } = props;
  const templates = useTemplateItems();
  const groups =
    templates.length === 0 ? GROUPS : [...GROUPS, { group: TEMPLATES_GROUP, items: templates }];
  return (
    <PlateElement {...props} as="span">
      <InlineCombobox element={element} trigger="/">
        <InlineComboboxInput />
        <InlineComboboxContent variant="slash">
          <InlineComboboxEmpty>No results</InlineComboboxEmpty>
          {groups.map(({ group, items }) => (
            <InlineComboboxGroup key={group}>
              <InlineComboboxGroupLabel>{group}</InlineComboboxGroupLabel>
              {items.map((item) => (
                <InlineComboboxItem
                  key={item.value}
                  group={group}
                  value={item.value}
                  label={item.label}
                  keywords={item.keywords}
                  onClick={() => {
                    item.onSelect(editor);
                  }}
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
      {props.children}
    </PlateElement>
  );
};

export const SlashKit = [
  SlashPlugin.configure({
    options: {
      triggerQuery: (editor) =>
        !editor.api.some({ match: { type: editor.getType(KEYS.codeBlock) } }),
    },
  }),
  SlashInputPlugin.withComponent(SlashInputElement),
  // the embed item's url prompt must live outside the self-unmounting combobox.
  createPlatePlugin({
    key: "embed-url-dialog",
    render: { afterEditable: () => <EmbedUrlDialogHost /> },
  }),
];
