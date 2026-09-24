// The stock paste parser runs deserializeMd, whose regex htmlToJsx pre-pass is fence-unaware:
// HTML inside a fence gets class→className and <!-- -->→{/* */} rewritten, and the autosave
// writes those bytes to the vault.

import { KEYS } from "platejs";
import { MarkdownPlugin } from "@platejs/markdown";

import { MD_REMARK_PLUGINS } from "@repo/notes/markdown/md-plugins";
import { MD_RULES } from "@repo/editor/markdown/md-rules";
import { mdToSlate } from "@repo/editor/markdown/md-to-slate";
import { FORMULA_INPUT_KEY } from "@repo/editor/formula-input-key";
import { WIKI_INPUT_KEY } from "@repo/editor/wiki-input-key";

export const MarkdownKit = [
  MarkdownPlugin.configure({
    options: {
      // combobox trigger elements are UI state; an autosave mid-combobox must skip them rather
      // than hit the serializer's "Unreachable code" fallback.
      disallowedNodes: [KEYS.slashInput, WIKI_INPUT_KEY, FORMULA_INPUT_KEY],
      remarkPlugins: MD_REMARK_PLUGINS,
      rules: MD_RULES,
    },
  })
    // `parser` is a top-level plugin field the stock plugin installs via a deferred `.extend`,
    // so only another deferred extension overrides it (a plain object merges early and is
    // clobbered). Merging only `deserialize` keeps the stock format/query trigger. A refused or
    // failed conversion answers an empty fragment, which Plate skips for plain text; a throw
    // would drop the paste, since slate has already prevented the default.
    .extend(() => ({
      parser: {
        deserialize: ({ data, editor }) => {
          try {
            const converted = mdToSlate(editor, data);
            return converted.ok ? converted.nodes : [];
          } catch (error) {
            console.error("paste: markdown conversion failed", error);
            return [];
          }
        },
      },
    })),
];
