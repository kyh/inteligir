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

import { useEffect, useRef } from "react";
import { KEYS } from "platejs";
import {
  Plate,
  PlateContent,
  PlateElement,
  PlateLeaf,
  usePlateEditor,
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
import {
  TableCellHeaderPlugin,
  TableCellPlugin,
  TablePlugin,
  TableRowPlugin,
} from "@platejs/table/react";
import { MarkdownPlugin, deserializeMd, serializeMd } from "@platejs/markdown";
import remarkGfm from "remark-gfm";

import { BlockList } from "@/renderer/editor/block-list";
import { DragKit } from "@/renderer/editor/block-draggable";
import { MD_STRINGIFY } from "@/renderer/editor/markdown-doc";
import { SlashKit } from "@/renderer/editor/slash-menu";

// Block plugins lists/indentation attach to. Lists are modeled as indented
// blocks (not a dedicated node), so the indent + list plugins inject into these.
const INDENTABLE = [...KEYS.heading, KEYS.p, KEYS.blockquote, KEYS.codeBlock];

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
function TableElement(props: PlateElementProps) {
  return (
    <PlateElement {...props} as="table" className="my-3 w-auto border-collapse text-sm">
      <tbody>{props.children}</tbody>
    </PlateElement>
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
  CodeBlockPlugin,
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
  [BlockquotePlugin.key]: element(
    "blockquote",
    "my-1 border-l-[3px] border-foreground px-4 py-[3px]",
  ),
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
  [LinkPlugin.key]: element(
    "a",
    "cursor-pointer border-b border-current font-medium text-foreground/70",
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
        className="min-h-full pt-4 text-base leading-normal caret-primary outline-none selection:bg-primary/20"
        placeholder="Write…"
        spellCheck={false}
      />
    </Plate>
  );
}
