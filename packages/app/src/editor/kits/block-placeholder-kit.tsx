// Per-block-type placeholders (empty focused block shows a hint via
// before:content). Replaces PlateContent's single whole-editor placeholder.
// Top-level blocks only; frontmatter is excluded (read-only in Rich, never a
// writing surface).

import { KEYS } from "platejs";
import { BlockPlaceholderPlugin } from "platejs/react";

export const BlockPlaceholderKit = [
  BlockPlaceholderPlugin.configure({
    options: {
      className:
        "before:absolute before:cursor-text before:text-muted-foreground/60 before:content-[attr(placeholder)]",
      placeholders: {
        [KEYS.p]: "Write, or press '/' for commands",
        [KEYS.h1]: "Heading 1",
        [KEYS.h2]: "Heading 2",
        [KEYS.h3]: "Heading 3",
        [KEYS.blockquote]: "Quote",
        [KEYS.toggle]: "Toggle",
      },
      query: ({ node, path }) => path.length === 1 && node.type !== "frontmatter",
    },
  }),
];
