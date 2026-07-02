// Code block kit — Base half (WP1). WP2 appends the React half (+lowlight
// syntax highlighting, +mermaid preview pane on `lang === "mermaid"` fences).

import { BaseCodeBlockPlugin, BaseCodeLinePlugin } from "@platejs/code-block";

export const CodeBlockBaseKit = [BaseCodeBlockPlugin, BaseCodeLinePlugin];
