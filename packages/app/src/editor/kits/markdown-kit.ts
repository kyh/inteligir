// THE shared MarkdownPlugin instance — the single configure call both editors
// (headless mirror via base-kit, live editor) consume, so the serialization
// brain is shared by construction. The kit-parity test asserts both editors'
// getOptions(MarkdownPlugin) resolve to these same objects.

import { KEYS } from "platejs";
import { MarkdownPlugin } from "@platejs/markdown";

import { AI_MARK } from "@repo/app/editor/inline-ai";
import { MD_REMARK_PLUGINS } from "@repo/app/editor/markdown/md-plugins";
import { MD_RULES } from "@repo/app/editor/markdown/md-rules";

export const MarkdownKit = [
  MarkdownPlugin.configure({
    options: {
      // Transient marks never serialize: suggestion + the inline-AI highlight.
      disallowedNodes: [KEYS.suggestion, AI_MARK],
      remarkPlugins: MD_REMARK_PLUGINS,
      rules: MD_RULES,
    },
  }),
];
