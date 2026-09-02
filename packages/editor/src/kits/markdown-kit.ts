// The stock paste parser runs deserializeMd, whose regex htmlToJsx pre-pass is fence-unaware:
// HTML inside a fence gets class→className and <!-- -->→{/* */} rewritten, and the autosave
// writes those bytes to the vault.

import { KEYS } from "platejs";
import { MarkdownPlugin, getMergedOptionsDeserialize, mdastToSlate } from "@platejs/markdown";

import { MD_REMARK_PLUGINS } from "@repo/notes/markdown/md-plugins";
import { parseMdast } from "@repo/notes/markdown/parse";
import { MD_RULES } from "@repo/editor/markdown/md-rules";
import { FORMULA_INPUT_KEY } from "@repo/editor/formula-input-key";
import { WIKI_INPUT_KEY } from "@repo/editor/wiki-input-key";

export const MarkdownKit = [
  MarkdownPlugin.configure({
    options: {
      // combobox trigger elements are UI state; an autosave mid-combobox must skip them rather
      // than hit the serializer's "Unreachable code" fallback.
      disallowedNodes: [KEYS.slashInput, KEYS.emojiInput, WIKI_INPUT_KEY, FORMULA_INPUT_KEY],
      remarkPlugins: MD_REMARK_PLUGINS,
      rules: MD_RULES,
    },
  })
    // `parser` is a top-level plugin field the stock plugin installs via a deferred `.extend`,
    // so only another deferred extension overrides it (a plain object merges early and is
    // clobbered). Merging only `deserialize` keeps the stock format/query trigger. Not imported
    // from markdown-doc.ts: it eagerly imports BASE_KIT (an import cycle), and `deserialize`
    // is synchronous so it cannot `await import()`.
    .extend(() => ({
      parser: {
        deserialize: ({ data, editor }) => {
          const parsed = parseMdast(data);
          if (!parsed.ok) return undefined;
          try {
            return mdastToSlate(parsed.root, getMergedOptionsDeserialize(editor));
          } catch {
            // mdastToSlate overflows the stack on pathological nesting; fall through to plain text.
            return undefined;
          }
        },
      },
    })),
];
