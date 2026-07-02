// Notion-style rich markdown editor built on Plate (platejs), used by the
// editor pane for `.md` documents. Round-trips markdown: deserialize the file
// text to Plate's value on mount, serialize back to markdown on every change
// so the editor's autosave persists it.
//
// Thin by design (WP2): the plugin/component composition lives in
// kits/editor-kit.ts (per-feature kit files whose Base halves compose the
// headless serialization mirror — see kits/base-kit.ts); this file owns only
// the seed/echo-dedupe lifecycle and the Plate surface.

import { useEffect, useRef } from "react";
import type { Value } from "platejs";
import { Plate, PlateContent, usePlateEditor } from "platejs/react";
import { serializeMd } from "@platejs/markdown";

import { EDITOR_KIT } from "@repo/app/editor/kits/editor-kit";
import { MD_STRINGIFY, parseMarkdown } from "@repo/app/editor/markdown/markdown-doc";
import { SelectionToolbar } from "@repo/app/editor/selection-toolbar";
import { TableOfContents } from "@repo/app/editor/toc";

// Seed markdown → Plate value through the owned pipeline. Unparseable content
// is impossible behind the richSafe gate, but never crash the surface: fall
// back to an empty paragraph and log.
function seedValue(md: string): Value {
  const parsed = parseMarkdown(md);
  if (parsed.ok) return parsed.value;
  console.error("MarkdownEditor: seed markdown failed to parse", parsed.reason);
  return [{ children: [{ text: "" }], type: "p" }];
}

type Props = {
  /** Markdown to render. Seeds the editor on mount and re-seeds it when the
   * prop changes externally (a vault reload / file switch) — see the effect. */
  value: string;
  /** Called with serialized markdown on every change. */
  onChange: (markdown: string) => void;
};

export function MarkdownEditor({ value, onChange }: Props) {
  const editor = usePlateEditor({
    plugins: EDITOR_KIT,
    value: () => seedValue(value),
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
    editor.tf.setValue(seedValue(value));
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
      <SelectionToolbar />
      <TableOfContents />
    </Plate>
  );
}
