// Color pills: a hex or rgb(a) literal in prose gets a swatch drawn BESIDE it.
// A DECORATION over the text, never a node — the bytes stay the literal, so
// nothing here can touch serialization (the tag-chip discipline). Clicking the
// swatch opens a native color picker that rewrites the literal IN ITS OWN
// SPELLING: hex stays hex (an #rrggbbaa keeps its alpha pair), rgb()/rgba()
// keep their function form and rgba() its exact alpha text — the picker only
// ever moves the three RGB channels, so every mapping is lossless. The one
// conscious widening: #rgb shorthand re-emits as #rrggbb, because the picked
// channel values need two digits each.

import { useEffect, useRef, useState } from "react";
import {
  createSlatePlugin,
  ElementApi,
  KEYS,
  NodeApi,
  TextApi,
  type DecoratedRange,
  type SlateEditor,
} from "platejs";
import { PlateLeaf, useEditorRef, type PlateLeafProps } from "platejs/react";

// #rgb / #rrggbb / #rrggbbaa, or rgb()/rgba() with plain numeric args — the
// spellings CSS accepts AND a swatch can render without evaluation.
const COLOR_RE =
  /#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})\b|rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*(?:,\s*(?:0|1|0?\.\d+)\s*)?\)/gi;

const RGB_FN_RE =
  /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*(?:,\s*(0|1|0?\.\d+)\s*)?\)$/i;

/** Element types whose text never draws swatches (code speaks for itself). */
function isSuppressedAncestor(editor: SlateEditor, type: string): boolean {
  return (
    type === editor.getType(KEYS.codeBlock) ||
    type === editor.getType(KEYS.codeLine) ||
    type === "frontmatter"
  );
}

function pad2Hex(n: number): string {
  return n.toString(16).padStart(2, "0");
}

/** The literal's RGB as `#rrggbb` for the native picker, or null. */
export function pickerHexFor(literal: string): string | null {
  if (literal.startsWith("#")) {
    const body = literal.slice(1);
    if (body.length === 3) {
      return `#${body
        .split("")
        .map((c) => c + c)
        .join("")}`.toLowerCase();
    }
    if (body.length === 6 || body.length === 8) {
      return `#${body.slice(0, 6)}`.toLowerCase();
    }
    return null;
  }
  const match = RGB_FN_RE.exec(literal);
  if (match === null) return null;
  const [r, g, b] = [Number(match[1]), Number(match[2]), Number(match[3])];
  if (r > 255 || g > 255 || b > 255) return null;
  return `#${pad2Hex(r)}${pad2Hex(g)}${pad2Hex(b)}`;
}

/** `hex` (#rrggbb, from the picker) re-spelled in `literal`'s own form. */
export function repaintLiteral(literal: string, hex: string): string | null {
  const body = hex.slice(1);
  if (!/^[0-9a-f]{6}$/i.test(body)) return null;
  if (literal.startsWith("#")) {
    const original = literal.slice(1);
    if (original.length === 8) return `#${body}${original.slice(6)}`;
    if (original.length === 3 || original.length === 6) return `#${body}`;
    return null;
  }
  const match = RGB_FN_RE.exec(literal);
  if (match === null) return null;
  const r = parseInt(body.slice(0, 2), 16);
  const g = parseInt(body.slice(2, 4), 16);
  const b = parseInt(body.slice(4, 6), 16);
  const alphaText = match[4];
  return alphaText === undefined ? `rgb(${r}, ${g}, ${b})` : `rgba(${r}, ${g}, ${b}, ${alphaText})`;
}

function ColorPillLeaf(props: PlateLeafProps) {
  const editor = useEditorRef();
  const value = typeof props.leaf.colorPill === "string" ? props.leaf.colorPill : "";
  const start = typeof props.leaf.colorPillStart === "number" ? props.leaf.colorPillStart : null;
  const [pickerAt, setPickerAt] = useState<{ left: number; top: number } | null>(null);
  const swatchRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  const pickerHex = pickerHexFor(value);
  const editable = pickerHex !== null && start !== null;

  useEffect(() => {
    if (pickerAt === null) return;
    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (popoverRef.current?.contains(target) === true) return;
      if (swatchRef.current?.contains(target) === true) return;
      setPickerAt(null);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [pickerAt]);

  const commit = (hex: string): void => {
    if (start === null) return;
    const literal = repaintLiteral(value, hex);
    if (literal === null || literal === value) return;
    const path = editor.api.findPath(props.text);
    if (path === undefined) return;
    editor.tf.insertText(literal, {
      at: {
        anchor: { offset: start, path },
        focus: { offset: start + value.length, path },
      },
    });
  };

  return (
    <PlateLeaf {...props}>
      <button
        ref={swatchRef}
        type="button"
        contentEditable={false}
        title={value}
        aria-label={editable ? `Edit color ${value}` : value}
        onMouseDown={(event) => {
          event.preventDefault();
        }}
        onClick={() => {
          if (!editable) return;
          if (pickerAt !== null) {
            setPickerAt(null);
            return;
          }
          const rect = swatchRef.current?.getBoundingClientRect();
          if (rect !== undefined) setPickerAt({ left: rect.left, top: rect.bottom + 4 });
        }}
        className="mr-0.5 inline-block size-2.5 cursor-pointer rounded-[3px] border border-border/60 align-middle select-none"
        style={{ backgroundColor: value }}
      />
      {pickerAt !== null && editable && (
        <span
          ref={popoverRef}
          contentEditable={false}
          className="fixed z-50 flex items-center gap-2 rounded-md border border-border bg-popover p-2 shadow-md"
          style={{ left: pickerAt.left, top: pickerAt.top }}
        >
          <input
            type="color"
            aria-label="Pick color"
            value={pickerHexFor(value) ?? "#000000"}
            onChange={(event) => {
              commit(event.target.value);
            }}
            className="size-6 cursor-pointer border-0 bg-transparent p-0"
          />
          <span className="font-mono text-xs text-muted-foreground">{value}</span>
        </span>
      )}
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
      // The offset rides the range so the leaf can name the exact bytes it
      // decorates — two identical literals in one run stay distinguishable.
      const range: DecoratedRange & { colorPill: string; colorPillStart: number } = {
        anchor: { offset: match.index, path },
        colorPill: match[0],
        colorPillStart: match.index,
        focus: { offset: match.index + match[0].length, path },
      };
      ranges.push(range);
    }
    return ranges.length > 0 ? ranges : undefined;
  },
}).withComponent(ColorPillLeaf);

export const ColorPillKit = [ColorPillPlugin];
