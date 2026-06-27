// Byte-stability brain for the vault editor.
//
// Plate's markdown round-trip is normalizing but IDEMPOTENT: once a document is
// in Plate's canonical form, re-serializing it is stable (proven in
// markdown-roundtrip.test.ts). We exploit that:
//
//   - A file is "canonical" when serialize(parse(raw)) === raw. For a canonical
//     file, editing one block in Plate and saving the whole document produces a
//     MINIMAL diff — every untouched block re-emits byte-identically, only the
//     edited block changes. So Rich editing is byte-safe for the whole document.
//   - A non-canonical file (unusual formatting Plate would reshape) edits as Raw
//     (byte-exact) until the user explicitly Formats it, after which idempotency
//     keeps it stable.
//
// This is a headless mirror of the editor's plugin set — the Base* node plugins
// carry the markdown rules; the /react variants only add rendering, so a
// headless editor serializes identically to the on-screen one. Keep this plugin
// list in sync with markdown-editor.tsx.

import { createSlateEditor } from "platejs";
import {
  BaseBlockquotePlugin,
  BaseBoldPlugin,
  BaseCodePlugin,
  BaseH1Plugin,
  BaseH2Plugin,
  BaseH3Plugin,
  BaseHorizontalRulePlugin,
  BaseItalicPlugin,
  BaseStrikethroughPlugin,
  BaseUnderlinePlugin,
} from "@platejs/basic-nodes";
import { BaseCodeBlockPlugin, BaseCodeLinePlugin } from "@platejs/code-block";
import { BaseIndentPlugin } from "@platejs/indent";
import { BaseLinkPlugin } from "@platejs/link";
import { BaseListPlugin } from "@platejs/list";
import {
  BaseTableCellHeaderPlugin,
  BaseTableCellPlugin,
  BaseTablePlugin,
  BaseTableRowPlugin,
} from "@platejs/table";
import { MarkdownPlugin, deserializeMd, serializeMd } from "@platejs/markdown";
import remarkGfm from "remark-gfm";

// Shared serialize conventions so the editor and this util agree on what
// "canonical" means. `-` bullets match Obsidian/common markdown (remark's
// default is `*`), so typical note files are canonical without a Format pass.
// Typed structurally (literal types) so it assigns to remark-stringify's Options
// without taking a direct dependency on that transitive package.
export const MD_STRINGIFY: { bullet: "-"; listItemIndent: "one"; rule: "-" } = {
  bullet: "-",
  listItemIndent: "one",
  // Emit `---` (not the remark default `***`) for thematic breaks / dividers,
  // so a hand-written `---` round-trips unchanged and stays canonical.
  rule: "-",
};

// Fresh editor per call — Slate editors carry mutable state, and these helpers
// run at most once per file open (canonical check) or per Format action, so the
// construction cost is irrelevant and a clean editor avoids cross-call bleed.
function makeEditor() {
  return createSlateEditor({
    plugins: [
      BaseBoldPlugin,
      BaseItalicPlugin,
      BaseUnderlinePlugin,
      BaseStrikethroughPlugin,
      BaseCodePlugin,
      BaseH1Plugin,
      BaseH2Plugin,
      BaseH3Plugin,
      BaseBlockquotePlugin,
      BaseHorizontalRulePlugin,
      BaseCodeBlockPlugin,
      BaseCodeLinePlugin,
      BaseTablePlugin,
      BaseTableRowPlugin,
      BaseTableCellPlugin,
      BaseTableCellHeaderPlugin,
      BaseIndentPlugin,
      BaseListPlugin,
      BaseLinkPlugin,
      // remark-gfm gives task-list checkboxes (- [ ] / - [x]), strikethrough,
      // and autolinks on both parse and stringify.
      MarkdownPlugin.configure({ options: { remarkPlugins: [remarkGfm] } }),
    ],
  });
}

/** Serialize the parse of `md` — Plate's canonical form of the document. */
export function roundTrip(md: string): string {
  const editor = makeEditor();
  return serializeMd(editor, {
    value: deserializeMd(editor, md),
    remarkStringifyOptions: MD_STRINGIFY,
  });
}

/** Whether `md` is already in Plate's canonical form, i.e. Rich editing it and
 * saving the whole document won't reshape any untouched block. The trailing
 * newline is ignored — the editor always writes a single trailing newline. */
export function isCanonical(md: string): boolean {
  if (md.trim() === "") return true; // empty docs are trivially canonical
  return roundTrip(md).trimEnd() === md.trimEnd();
}

/** Whether Rich editing is *lossless* — the round-trip may change formatting
 * (bullet markers `*`→`-`, rule `***`→`---`, table cell padding, blank-line
 * runs) but drops no actual content. Looser than `isCanonical` (byte-identical),
 * so those formatting-only files open Rich instead of Raw. We compare the
 * alphanumeric content of the source vs its round-trip: if Plate would DROP
 * text (e.g. raw HTML it doesn't model), the words diverge and the file stays in
 * the byte-exact Raw editor. */
// The alphanumeric content of a string — markers, punctuation and whitespace
// dropped — used to tell formatting changes from real content loss.
function letters(s: string): string {
  return s.replace(/[^\p{L}\p{N}]+/gu, "").toLowerCase();
}

export function isRichSafe(md: string): boolean {
  if (md.trim() === "") return true;
  if (roundTrip(md).trimEnd() === md.trimEnd()) return true; // byte-canonical ⇒ safe
  return letters(md) === letters(roundTrip(md));
}

/** Canonicalize `md` (the one-time Format action). Idempotent thereafter. */
export function toCanonical(md: string): string {
  return roundTrip(md).trimEnd() + "\n";
}
