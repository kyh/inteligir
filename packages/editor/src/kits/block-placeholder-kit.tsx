import { KEYS } from "platejs";
import { BlockPlaceholderPlugin } from "platejs/react";

// The plugin skips a pristine-empty doc, so PlateContent's placeholder covers that state with the same copy.
export const WRITE_PLACEHOLDER = "Write, or press '/' for commands";

export const BlockPlaceholderKit = [
  BlockPlaceholderPlugin.configure({
    options: {
      className:
        "before:absolute before:cursor-text before:text-muted-foreground/80 before:content-[attr(placeholder)]",
      placeholders: {
        [KEYS.p]: WRITE_PLACEHOLDER,
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
