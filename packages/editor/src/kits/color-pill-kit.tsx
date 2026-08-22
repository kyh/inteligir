// Color pills: a hex or rgb(a) literal in prose gets a swatch drawn BESIDE it.
// A DECORATION over the text, never a node — the bytes stay the literal, so
// nothing here can touch serialization (the tag-chip discipline). The swatch
// carries the value as its title; a picker is the formulas-era follow-up.

import {
  createSlatePlugin,
  ElementApi,
  KEYS,
  NodeApi,
  TextApi,
  type DecoratedRange,
  type SlateEditor,
} from "platejs";
import { PlateLeaf, type PlateLeafProps } from "platejs/react";

// #rgb / #rrggbb / #rrggbbaa, or rgb()/rgba() with plain numeric args — the
// spellings CSS accepts AND a swatch can render without evaluation.
const COLOR_RE =
  /#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})\b|rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*(?:,\s*(?:0|1|0?\.\d+)\s*)?\)/gi;

/** Element types whose text never draws swatches (code speaks for itself). */
function isSuppressedAncestor(editor: SlateEditor, type: string): boolean {
  return (
    type === editor.getType(KEYS.codeBlock) ||
    type === editor.getType(KEYS.codeLine) ||
    type === "frontmatter"
  );
}

function ColorPillLeaf(props: PlateLeafProps) {
  const value = typeof props.leaf.colorPill === "string" ? props.leaf.colorPill : "";
  return (
    <PlateLeaf {...props}>
      <span
        contentEditable={false}
        title={value}
        className="mr-0.5 inline-block size-2.5 rounded-[3px] border border-border/60 align-middle select-none"
        style={{ backgroundColor: value }}
      />
      {props.children}
    </PlateLeaf>
  );
}

const ColorPillPlugin = createSlatePlugin({
  key: "colorPill",
  node: { isLeaf: true },
  decorate: ({ editor, entry: [node, path] }) => {
    // Fast path: most text runs carry neither `#` nor `rgb`.
    if (!TextApi.isText(node)) return undefined;
    if (!node.text.includes("#") && !node.text.toLowerCase().includes("rgb")) return undefined;
    if (node[editor.getType(KEYS.code)] === true) return undefined;
    for (let depth = 1; depth < path.length; depth += 1) {
      const ancestor = NodeApi.get(editor, path.slice(0, depth));
      if (!ElementApi.isElement(ancestor)) continue;
      if (isSuppressedAncestor(editor, ancestor.type)) return undefined;
    }
    const ranges: DecoratedRange[] = [];
    for (const match of node.text.matchAll(COLOR_RE)) {
      const range: DecoratedRange & { colorPill: string } = {
        anchor: { offset: match.index, path },
        colorPill: match[0],
        focus: { offset: match.index + match[0].length, path },
      };
      ranges.push(range);
    }
    return ranges.length > 0 ? ranges : undefined;
  },
}).withComponent(ColorPillLeaf);

export const ColorPillKit = [ColorPillPlugin];
