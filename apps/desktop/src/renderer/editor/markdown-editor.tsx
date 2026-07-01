// Notion-style rich markdown editor built on Plate (platejs), used by the editor
// pane for `.md` documents. Round-trips markdown: deserialize the file text to
// Plate's value on mount, serialize back to markdown on every change so the
// editor's autosave persists it.
//
// Scope is a focused subset of Potion's editor — marks, headings, blockquote,
// code blocks, links, and lists (incl. todo checkboxes) — rendered with small
// Tailwind components (Plate plugins ship headless). The editor pane only mounts
// this for documents that are already canonical (see markdown-doc.ts), so
// serialization reshapes nothing the user didn't edit.

import { useEffect, useRef, useState, type ComponentType } from "react";
import {
  EllipsisIcon,
  InfoIcon,
  LightbulbIcon,
  OctagonAlertIcon,
  PlusIcon,
  ShieldAlertIcon,
  Trash2Icon,
  TriangleAlertIcon,
} from "lucide-react";
import { KEYS, NodeApi } from "platejs";
import {
  Plate,
  PlateContent,
  PlateElement,
  PlateLeaf,
  usePlateEditor,
  useEditorRef,
  type PlateElementProps,
  type PlateLeafProps,
} from "platejs/react";
import {
  BlockquotePlugin,
  BoldPlugin,
  CodePlugin,
  H1Plugin,
  H2Plugin,
  H3Plugin,
  HorizontalRulePlugin,
  ItalicPlugin,
  StrikethroughPlugin,
  UnderlinePlugin,
} from "@platejs/basic-nodes/react";
import { CodeBlockPlugin, CodeLinePlugin, CodeSyntaxPlugin } from "@platejs/code-block/react";
import { IndentPlugin } from "@platejs/indent/react";
import { LinkPlugin } from "@platejs/link/react";
import { ListPlugin } from "@platejs/list/react";
import { deleteColumn, deleteRow, insertTableColumn, insertTableRow } from "@platejs/table";
import {
  TableCellHeaderPlugin,
  TableCellPlugin,
  TablePlugin,
  TableRowPlugin,
} from "@platejs/table/react";
import { MarkdownPlugin, deserializeMd, serializeMd } from "@platejs/markdown";
import remarkGfm from "remark-gfm";
import { common, createLowlight } from "lowlight";

import { cn } from "@repo/ui/lib/utils";
import { Menu, MenuContent, MenuItem, MenuSeparator } from "@repo/ui/components/menu";

import { BlockList } from "@/renderer/editor/block-list";
import { DragKit } from "@/renderer/editor/block-draggable";
import { AI_MARK, AiMarkKit } from "@/renderer/editor/inline-ai";
import { InlineAiToolbar } from "@/renderer/editor/inline-ai-toolbar";
import { MD_STRINGIFY } from "@/renderer/editor/markdown-doc";
import { SlashKit } from "@/renderer/editor/slash-menu";
import { TableOfContents } from "@/renderer/editor/toc";

// Block plugins lists/indentation attach to. Lists are modeled as indented
// blocks (not a dedicated node), so the indent + list plugins inject into these.
const INDENTABLE = [...KEYS.heading, KEYS.p, KEYS.blockquote, KEYS.codeBlock];

// lowlight powers code-block syntax highlighting (`common` = ~35 popular
// languages; the token classes are styled by the `.hljs-*` theme in styles.css).
const lowlight = createLowlight(common);

// Small styled renderers — Plate plugins are headless, so each node/mark needs
// a component. className-only keeps them trivial and on-theme.
function leaf(className: string) {
  return function Leaf(props: PlateLeafProps) {
    return <PlateLeaf {...props} className={className} />;
  };
}
function element(as: keyof HTMLElementTagNameMap, className: string) {
  return function Element(props: PlateElementProps) {
    return <PlateElement {...props} as={as} className={className} />;
  };
}

// CodeSyntaxPlugin tags each highlighted token with an `.hljs-*` className on the
// leaf; render it so the theme in styles.css colors it.
function CodeSyntaxLeaf(props: PlateLeafProps) {
  const { className } = props.leaf;
  return <PlateLeaf {...props} className={typeof className === "string" ? className : ""} />;
}

// GitHub-style alert blockquotes (`> [!NOTE] …`) render as colored callouts.
// They stay plain blockquotes in the model, so they round-trip byte-for-byte —
// the callout is purely presentational (the `[!TYPE]` marker stays in the text).
const ALERTS: Record<
  string,
  { Icon: ComponentType<{ className?: string }>; accent: string; icon: string }
> = {
  NOTE: {
    Icon: InfoIcon,
    accent: "border-blue-500/60 bg-blue-500/[0.05]",
    icon: "text-blue-600 dark:text-blue-400",
  },
  TIP: {
    Icon: LightbulbIcon,
    accent: "border-emerald-500/60 bg-emerald-500/[0.05]",
    icon: "text-emerald-600 dark:text-emerald-400",
  },
  IMPORTANT: {
    Icon: ShieldAlertIcon,
    accent: "border-violet-500/60 bg-violet-500/[0.05]",
    icon: "text-violet-600 dark:text-violet-400",
  },
  WARNING: {
    Icon: TriangleAlertIcon,
    accent: "border-amber-500/60 bg-amber-500/[0.05]",
    icon: "text-amber-600 dark:text-amber-400",
  },
  CAUTION: {
    Icon: OctagonAlertIcon,
    accent: "border-red-500/60 bg-red-500/[0.05]",
    icon: "text-red-600 dark:text-red-400",
  },
};

function BlockquoteElement(props: PlateElementProps) {
  const marker = /^\s*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]/i.exec(
    NodeApi.string(props.element),
  );
  const variant = marker?.[1]?.toUpperCase();
  const alert = variant ? ALERTS[variant] : undefined;
  if (alert) {
    const { Icon, accent, icon } = alert;
    return (
      <PlateElement
        {...props}
        as="blockquote"
        className={cn("relative my-1 rounded-md border-l-[3px] py-2 pr-3 pl-9 [&>*]:my-0", accent)}
      >
        <span contentEditable={false} className={cn("absolute top-[9px] left-3", icon)}>
          <Icon className="size-4" />
        </span>
        {props.children}
      </PlateElement>
    );
  }
  return (
    <PlateElement
      {...props}
      as="blockquote"
      className="my-1 border-l-[3px] border-foreground px-4 py-[3px]"
    />
  );
}

// Horizontal rule is a void node, so the visual <hr> lives in a non-editable
// sibling and Plate's children (the void's empty text) still render for Slate.
function HrElement(props: PlateElementProps) {
  return (
    <PlateElement {...props} className="mb-1 py-2">
      <div contentEditable={false}>
        <hr className="h-0.5 rounded-sm border-none bg-muted bg-clip-content" />
      </div>
      {props.children}
    </PlateElement>
  );
}

// Plate models a table as table > tr > (td|th); the rows need a <tbody> wrapper
// for valid HTML (mirrors Potion's table renderer). GFM tables round-trip.
// The non-editable hover affordances add a row at the bottom / column at the
// right (Tab/Shift-Tab cell navigation is handled natively by the table plugin).
function TableElement(props: PlateElementProps) {
  const editor = useEditorRef();
  const { element } = props;
  const [menuOpen, setMenuOpen] = useState(false);
  const menuBtnRef = useRef<HTMLButtonElement | null>(null);

  // deleteRow/deleteColumn act on the cell holding the cursor; the trigger
  // preventDefaults mousedown so opening the menu doesn't drop that selection.
  const removeTable = () => {
    const at = editor.api.findPath(element);
    if (at) editor.tf.removeNodes({ at });
  };

  const addRow = () => {
    const at = editor.api.findPath(element);
    if (at) insertTableRow(editor, { at });
  };
  const addColumn = () => {
    const at = editor.api.findPath(element);
    if (!at) return;
    const firstRow = element.children[0];
    const cols =
      firstRow && "children" in firstRow && Array.isArray(firstRow.children)
        ? firstRow.children.length
        : 1;
    insertTableColumn(editor, { fromCell: [...at, 0, cols - 1] });
  };

  return (
    <div className="group/table relative my-3 w-fit">
      <button
        type="button"
        contentEditable={false}
        ref={menuBtnRef}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => setMenuOpen(true)}
        title="Table options"
        className="absolute -top-2.5 -left-2.5 z-10 flex size-5 items-center justify-center rounded-md border border-border bg-background text-muted-foreground opacity-0 transition-opacity group-hover/table:opacity-100 hover:bg-accent hover:text-foreground"
      >
        <EllipsisIcon className="size-3.5" />
      </button>
      <Menu open={menuOpen} onOpenChange={setMenuOpen}>
        <MenuContent anchor={menuBtnRef} side="bottom" align="start">
          <MenuItem onClick={() => deleteRow(editor)}>Delete row</MenuItem>
          <MenuItem onClick={() => deleteColumn(editor)}>Delete column</MenuItem>
          <MenuSeparator />
          <MenuItem
            onClick={removeTable}
            className="text-destructive data-[highlighted]:bg-destructive/10 data-[highlighted]:text-destructive"
          >
            <Trash2Icon />
            Delete table
          </MenuItem>
        </MenuContent>
      </Menu>
      <PlateElement {...props} as="table" className="w-auto border-collapse text-sm">
        <tbody>{props.children}</tbody>
      </PlateElement>
      <button
        type="button"
        contentEditable={false}
        onClick={addRow}
        title="Add row"
        className="absolute inset-x-0 -bottom-2.5 flex h-2 items-center justify-center rounded-sm bg-muted text-muted-foreground opacity-0 transition-opacity group-hover/table:opacity-100 hover:bg-accent hover:text-foreground"
      >
        <PlusIcon className="size-3" />
      </button>
      <button
        type="button"
        contentEditable={false}
        onClick={addColumn}
        title="Add column"
        className="absolute inset-y-0 -right-2.5 flex w-2 items-center justify-center rounded-sm bg-muted text-muted-foreground opacity-0 transition-opacity group-hover/table:opacity-100 hover:bg-accent hover:text-foreground"
      >
        <PlusIcon className="size-3" />
      </button>
    </div>
  );
}

const EDITOR_PLUGINS = [
  BoldPlugin,
  ItalicPlugin,
  UnderlinePlugin,
  StrikethroughPlugin,
  CodePlugin,
  H1Plugin,
  H2Plugin,
  H3Plugin,
  BlockquotePlugin,
  HorizontalRulePlugin,
  CodeBlockPlugin.configure({ options: { lowlight } }),
  CodeLinePlugin,
  CodeSyntaxPlugin,
  TablePlugin,
  TableRowPlugin,
  TableCellPlugin,
  TableCellHeaderPlugin,
  IndentPlugin.configure({ inject: { targetPlugins: INDENTABLE }, options: { offset: 24 } }),
  ListPlugin.configure({
    inject: { targetPlugins: INDENTABLE },
    render: { belowNodes: BlockList },
  }),
  LinkPlugin,
  ...SlashKit,
  ...DragKit,
  ...AiMarkKit,
  // remark-gfm gives task-list checkboxes (- [ ] / - [x]) + strikethrough.
  MarkdownPlugin.configure({ options: { remarkPlugins: [remarkGfm] } }),
];

const EDITOR_COMPONENTS = {
  [BoldPlugin.key]: leaf("font-bold"),
  [ItalicPlugin.key]: leaf("italic"),
  [UnderlinePlugin.key]: leaf("underline"),
  [StrikethroughPlugin.key]: leaf("line-through"),
  [CodePlugin.key]: leaf(
    "whitespace-pre-wrap rounded-md bg-muted px-[0.3em] py-[0.2em] font-mono text-sm",
  ),
  [KEYS.p]: element("p", "px-0.5 py-[3px]"),
  [H1Plugin.key]: element(
    "h1",
    "relative mt-8 mb-1 px-0.5 py-[3px] text-[1.875em] font-semibold leading-[1.3] first:mt-0",
  ),
  [H2Plugin.key]: element(
    "h2",
    "relative mt-[1.4em] mb-1 px-0.5 py-[3px] text-[1.5em] font-semibold leading-[1.3] first:mt-0",
  ),
  [H3Plugin.key]: element(
    "h3",
    "relative mt-[1em] mb-1 px-0.5 py-[3px] text-[1.25em] font-semibold leading-[1.3] first:mt-0",
  ),
  [BlockquotePlugin.key]: BlockquoteElement,
  [HorizontalRulePlugin.key]: HrElement,
  [TablePlugin.key]: TableElement,
  [TableRowPlugin.key]: element("tr", ""),
  [TableCellPlugin.key]: element(
    "td",
    "min-w-24 border border-border px-3 py-1.5 align-top [&>*]:my-0",
  ),
  [TableCellHeaderPlugin.key]: element(
    "th",
    "min-w-24 border border-border bg-muted px-3 py-1.5 text-left align-top font-semibold [&>*]:my-0",
  ),
  [CodeBlockPlugin.key]: element(
    "pre",
    "my-1 overflow-x-auto rounded-md bg-muted px-4 py-3 font-mono text-sm leading-normal [tab-size:2]",
  ),
  [CodeLinePlugin.key]: element("div", ""),
  [CodeSyntaxPlugin.key]: CodeSyntaxLeaf,
  [LinkPlugin.key]: element(
    "a",
    "cursor-pointer border-b border-current font-medium text-foreground/70",
  ),
  [AI_MARK]: leaf(
    "rounded-sm bg-primary/15 underline decoration-primary/40 decoration-dotted underline-offset-2",
  ),
};

type Props = {
  /** Markdown to render. Seeds the editor on mount and re-seeds it when the
   * prop changes externally (a vault reload / file switch) — see the effect. */
  value: string;
  /** Called with serialized markdown on every change. */
  onChange: (markdown: string) => void;
};

export function MarkdownEditor({ value, onChange }: Props) {
  const editor = usePlateEditor({
    plugins: EDITOR_PLUGINS,
    components: EDITOR_COMPONENTS,
    // Function form: deserialize needs the constructed editor (its plugin rules).
    value: (e) => deserializeMd(e, value),
  });

  // The last raw `value` prop we've reflected into the editor — dedupes the
  // re-seed effect and our own emissions so neither re-seeds the editor.
  const lastValueProp = useRef(value);
  // The serialized markdown immediately after a (re)seed. Seeding the editor
  // makes Plate emit onChange with this normalized text; recognizing it lets us
  // drop that echo instead of treating it as a user edit (which would autosave
  // a normalized rewrite over the agent's/file's content). Initialized to the
  // mount value's normalized form so the first-render onChange is dropped too.
  const seeded = useRef<string | null>(null);
  if (seeded.current === null)
    seeded.current = serializeMd(editor, { remarkStringifyOptions: MD_STRINGIFY });

  // Re-seed when `value` changes from the outside (e.g. the agent edited the
  // file and the panel reloaded it). Without this the Plate surface keeps the
  // stale document and the next edit would serialize it back over the newer
  // file.
  useEffect(() => {
    if (value === lastValueProp.current) return;
    lastValueProp.current = value;
    editor.tf.setValue(deserializeMd(editor, value));
    seeded.current = serializeMd(editor, { remarkStringifyOptions: MD_STRINGIFY });
  }, [value, editor]);

  return (
    <Plate
      editor={editor}
      onChange={() => {
        const md = serializeMd(editor, { remarkStringifyOptions: MD_STRINGIFY });
        // Drop the echo a programmatic (re)seed produces — only real edits,
        // which diverge from the seeded text, propagate.
        if (md === seeded.current) return;
        seeded.current = null;
        lastValueProp.current = md;
        onChange(md);
      }}
    >
      <PlateContent
        className="potion-editor-typography min-h-full pt-4 text-base leading-normal caret-primary outline-none selection:bg-primary/20"
        placeholder="Write…"
        spellCheck={false}
      />
      <InlineAiToolbar />
      <TableOfContents />
    </Plate>
  );
}
