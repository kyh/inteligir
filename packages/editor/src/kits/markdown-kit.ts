// THE shared MarkdownPlugin instance — the single configure call both editors
// (headless mirror via base-kit, live editor) consume, so the serialization
// brain is shared by construction. The kit-parity test asserts both editors'
// getOptions(MarkdownPlugin) resolve to these same objects.
//
// It also owns the PASTE parse. MarkdownPlugin ships a `parser` whose
// `deserialize` calls `deserializeMd` — the function markdown-doc.ts and
// @repo/notes/markdown/parse.ts both declare banned in app code, because its
// regex `htmlToJsx` pre-pass is fence-unaware: pasting a fenced block that
// contains HTML rewrites `class`→`className` and `<!-- -->`→`{/* */}` INSIDE
// the fence, and the autosave then writes those bytes to the vault. Leaving
// the stock parser in place would make the ban partial. See the parser
// override below for how it is replaced.

import { KEYS } from "platejs";
import { MarkdownPlugin, getMergedOptionsDeserialize, mdastToSlate } from "@platejs/markdown";

import { AI_MARK } from "@repo/editor/ai/ai-mark";
import { shouldSerializeNode } from "@repo/editor/ai/transient";
import { MD_REMARK_PLUGINS } from "@repo/notes/markdown/md-plugins";
import { parseMdast } from "@repo/notes/markdown/parse";
import { scanVocabulary } from "@repo/notes/markdown/vocabulary";
import { MD_RULES } from "@repo/editor/markdown/md-rules";
import { WIKI_INPUT_KEY } from "@repo/editor/wiki-input-key";

export const MarkdownKit = [
  MarkdownPlugin.configure({
    options: {
      // Transient nodes never serialize. Two mechanisms:
      // - disallowedNodes drops WHOLE nodes: the inline-AI streaming mark and
      //   the combobox trigger elements (`/`, `:`, and `[[` inputs are UI
      //   state — an autosave firing mid-combobox must skip them structurally,
      //   never hit the serializer's "Unreachable code" fallback).
      // - allowNode.serialize handles suggestion (track-changes) marks, which
      //   need per-TYPE treatment: pending INSERTIONS are dropped, but
      //   deletion-marked text is the user's ORIGINAL content and must stay
      //   (a blanket disallow would lose it). See ai/transient.ts.
      // - plainMarks strips the default `suggestion` mark rule's
      //   <suggestion> JSX wrapper from the kept (remove/update) text — the
      //   bytes are the plain original text.
      disallowedNodes: [AI_MARK, KEYS.slashInput, KEYS.emojiInput, WIKI_INPUT_KEY],
      allowNode: { serialize: shouldSerializeNode },
      plainMarks: [KEYS.suggestion],
      remarkPlugins: MD_REMARK_PLUGINS,
      rules: MD_RULES,
    },
  })
    // `parser` is a TOP-LEVEL SlatePlugin field, not an option, and the stock
    // one is installed by a deferred `.extend(fn)` inside @platejs/markdown —
    // so it can only be overridden by another deferred extension (a plain
    // object merges immediately and would be clobbered when the plugin
    // resolves). Merging `{ parser: { deserialize } }` keeps the stock
    // `format`/`query` (text/plain only, and only when the clipboard carries
    // no text/html and the data isn't a bare URL): this replaces the parse,
    // not the trigger.
    //
    // The replacement is the owned pipeline — the same three primitives the
    // file-open path runs (parseMdast → scanVocabulary → mdastToSlate),
    // assembled HERE rather than imported from markdown-doc.ts because that
    // module eagerly imports BASE_KIT, and a kit importing it back would close
    // exactly the eager cycle `editor-import-cycles.test.ts` forbids. The
    // usual escape hatch doesn't apply either: `parser.deserialize` is
    // synchronous, so it cannot `await import(...)`. Deserializing against the
    // LIVE editor is in any case the more correct context for a paste than
    // markdown-doc's headless mirror.
    //
    // Anything the pipeline refuses — a parse error, or content outside the
    // MDX vocabulary — returns undefined, and Plate falls through to its
    // plain-text insert. Refusing to interpret content this app cannot
    // represent is the point; it is never mangled on the way in.
    .extend(() => ({
      parser: {
        deserialize: ({ data, editor }) => {
          const parsed = parseMdast(data);
          if (!parsed.ok) return undefined;
          if (scanVocabulary(parsed.root)) return undefined;
          try {
            return mdastToSlate(parsed.root, getMergedOptionsDeserialize(editor));
          } catch {
            // mdast→Slate overflows the stack on pathological nesting (see
            // markdown-doc's DEPTH_REASON). A paste must never take the
            // editor down — fall through to plain text.
            return undefined;
          }
        },
      },
    })),
];
