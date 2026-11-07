// Plate's deserializeMd is banned, and the stock paste parser runs it. Its regex htmlToJsx pre-pass
// is fence-unaware: HTML inside a fence gets class→className and <!-- -->→{/* */} rewritten, and
// the item's next write keeps those bytes. It also swallows parse errors into degraded models.

import { MarkdownPlugin } from "@platejs/markdown";

import { MD_REMARK_PLUGINS } from "@repo/notes/markdown/md-plugins";
import { MD_RULES } from "@repo/editor/markdown/md-rules";
import { mdToSlate } from "@repo/editor/markdown/md-to-slate";

export const MarkdownKit = [
  MarkdownPlugin.configure({
    options: {
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
