// Plate's stock paste parser runs its MDX pre-pass, which rewrites html inside a fence; the paste
// reads through the codec's own read instead, and a refused read lands as plain text.

import { MarkdownPlugin } from "@platejs/markdown";

import { MD_REMARK_PLUGINS, MD_STRINGIFY } from "@repo/editor/markdown/md-plugins";
import { lfOnly, readMarkdown } from "@repo/editor/markdown/md-read";
import { MD_RULES } from "@repo/editor/markdown/md-rules";

export const MarkdownKit = [
  MarkdownPlugin.configure({
    options: {
      // markdown has no underline, so it writes as the words it marks
      plainMarks: ["underline"],
      remarkPlugins: MD_REMARK_PLUGINS,
      remarkStringifyOptions: MD_STRINGIFY,
      rules: MD_RULES,
    },
  })
    // `parser` is a top-level plugin field the stock plugin installs via a deferred `.extend`,
    // so only another deferred extension overrides it. An empty fragment is what Plate skips for
    // plain text; a throw would drop the paste, since slate has already prevented the default.
    .extend(() => ({
      parser: {
        deserialize: ({ data, editor }) => {
          const read = readMarkdown(editor, lfOnly(data));
          return read.ok ? read.value : [];
        },
      },
    })),
];
