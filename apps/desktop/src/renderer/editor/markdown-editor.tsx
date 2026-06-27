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
  ItalicPlugin,
  StrikethroughPlugin,
  UnderlinePlugin,
} from "@platejs/basic-nodes/react";
import { CodeBlockPlugin, CodeLinePlugin, CodeSyntaxPlugin } from "@platejs/code-block/react";
import { IndentPlugin } from "@platejs/indent/react";
import { LinkPlugin } from "@platejs/link/react";
import { ListPlugin } from "@platejs/list/react";
import { MarkdownPlugin, deserializeMd, serializeMd } from "@platejs/markdown";
import remarkGfm from "remark-gfm";

import { BlockList } from "@/renderer/editor/block-list";
import { MD_STRINGIFY } from "@/renderer/editor/markdown-doc";

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
  CodeBlockPlugin,
  CodeLinePlugin,
  CodeSyntaxPlugin,
  IndentPlugin.configure({ inject: { targetPlugins: INDENTABLE }, options: { offset: 24 } }),
  ListPlugin.configure({
    inject: { targetPlugins: INDENTABLE },
    render: { belowNodes: BlockList },
  }),
  LinkPlugin,
  // remark-gfm gives task-list checkboxes (- [ ] / - [x]) + strikethrough.
  MarkdownPlugin.configure({ options: { remarkPlugins: [remarkGfm] } }),
];

const EDITOR_COMPONENTS = {
  [BoldPlugin.key]: leaf("font-semibold"),
  [ItalicPlugin.key]: leaf("italic"),
  [UnderlinePlugin.key]: leaf("underline"),
  [StrikethroughPlugin.key]: leaf("line-through"),
  [CodePlugin.key]: leaf("rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]"),
  [H1Plugin.key]: element("h1", "mt-4 mb-2 text-2xl font-bold"),
  [H2Plugin.key]: element("h2", "mt-3 mb-1.5 text-xl font-semibold"),
  [H3Plugin.key]: element("h3", "mt-2 mb-1 text-lg font-semibold"),
  [BlockquotePlugin.key]: element(
    "blockquote",
    "border-l-2 border-border pl-3 text-muted-foreground",
  ),
  [CodeBlockPlugin.key]: element(
    "pre",
    "my-2 overflow-auto rounded bg-muted p-3 font-mono text-[0.85em]",
  ),
  [CodeLinePlugin.key]: element("div", ""),
  [LinkPlugin.key]: element("a", "text-primary underline underline-offset-2"),
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
        className="min-h-full px-3 py-2 text-sm leading-relaxed outline-none [&_p]:my-1"
        placeholder="Write…"
        spellCheck={false}
      />
    </Plate>
  );
}
