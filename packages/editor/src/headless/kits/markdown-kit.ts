import { MarkdownPlugin } from "@platejs/markdown";

import { MD_REMARK_PLUGINS, MD_STRINGIFY } from "@repo/editor/headless/markdown/md-plugins";
import { lfOnly, readMarkdown } from "@repo/editor/headless/markdown/md-read";
import { MD_RULES } from "@repo/editor/headless/markdown/md-rules";

export const MarkdownKit = [
  MarkdownPlugin.configure({
    options: {
      plainMarks: ["underline"],
      remarkPlugins: MD_REMARK_PLUGINS,
      remarkStringifyOptions: MD_STRINGIFY,
      rules: MD_RULES,
    },
  }).extend(() => ({
    parser: {
      deserialize: ({ data, editor }) => {
        const read = readMarkdown(editor, lfOnly(data));

        return read.ok ? read.value : [];
      },
    },
  })),
];
