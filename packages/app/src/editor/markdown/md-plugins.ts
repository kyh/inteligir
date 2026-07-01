// The remark stack + stringify conventions shared by BOTH pipeline directions
// (parse in parse.ts, serialize via @platejs/markdown's serializeMd) and BOTH
// editors (headless mirror + live editor, through kits/markdown-kit.ts).
//
// Plugin order is probe-proven (scratchpad rt/probe4-6 lineage, pinned by the
// fixture matrix): frontmatter must precede everything so `---` is claimed
// before thematic-break; math before gfm/mdx; the agnostic MDX and wiki-link
// extensions are ours.

import type { Plugin, Processor } from "unified";
import remarkFrontmatter from "remark-frontmatter";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";

import { remarkMdxAgnostic } from "@repo/app/editor/markdown/remark-mdx-agnostic";
import { remarkWikiLink } from "@repo/app/editor/markdown/remark-wiki-link";

// Single-dollar math is OFF (locked decision): "$5 and $6" in meeting notes
// must never render as math. Inline math is `$$x$$` (remark-math still treats
// a double-dollar run in text position as inline math); display math is `$$`
// blocks. Plate's MarkdownPlugin types remarkPlugins as Plugin[] (no
// [plugin, options] tuples), so the option is bound via this named wrapper.
function remarkMathNoSingleDollar(this: Processor): undefined {
  return remarkMath.call(this, { singleDollarTextMath: false });
}

export const MD_REMARK_PLUGINS: Plugin[] = [
  remarkFrontmatter, // ['yaml'] default — MUST pair with md-rules' yaml/frontmatter rules
  remarkMathNoSingleDollar,
  remarkGfm,
  remarkMdxAgnostic, // ours — NOT Plate's remarkMdx (acorn)
  remarkWikiLink, // ours — [[target]] / [[target|alias]] / ![[embed]]
];

// Shared serialize conventions so the editor and the gate agree on what
// "canonical" means. `-` bullets match Obsidian/common markdown (remark's
// default is `*`); `rule: "-"` keeps a hand-written `---` canonical. Typed
// structurally (literal types) so it assigns to remark-stringify's Options
// without a direct dependency on that transitive package.
export const MD_STRINGIFY: { bullet: "-"; listItemIndent: "one"; rule: "-" } = {
  bullet: "-",
  listItemIndent: "one",
  rule: "-",
};
