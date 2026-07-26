// Inline `#tag` chips — the RENDER-ONLY half.
//
// The chip is a leaf DECORATION (tag-chip-kit builds the ranges), never a
// document node: decorations live outside the value, so a `#tag` costs the
// file exactly the bytes the user typed and the round-trip fixtures are
// untouched. Raw mode, the headless BASE_KIT serializer and the transclusion
// static render never see this plugin at all.
//
// A11y note: the chip is styled TEXT inside contenteditable, not a focusable
// control — putting a tabbable element in the middle of a paragraph would
// wreck caret navigation for everyone to serve a shortcut. The keyboard route
// to the same destination is the palette (`#` → tag → notes), which the
// sidebar's Tags group also opens.

import { PlateLeaf, type PlateLeafProps } from "platejs/react";

import { browseTag } from "@renderer/command/tags";

/** True when the user is mid-selection: a drag that ends over a chip fires a
 * click, and popping the palette out from under a selection is never what they
 * meant. Reads the DOM selection rather than Slate's, which lags a click by a
 * tick. */
function hasRangeSelection(): boolean {
  const selection = document.getSelection();
  return selection !== null && !selection.isCollapsed;
}

/**
 * The chip. `props.leaf.text` is the decorated SLICE — exactly `#tag` — so the
 * tag needs no extra data riding on the range.
 */
export function TagChipLeaf(props: PlateLeafProps) {
  const text = props.leaf.text;
  const tag = text.startsWith("#") ? text.slice(1) : "";
  return (
    <PlateLeaf
      {...props}
      // Deliberately the wiki chip's palette (wiki-chip.tsx) — the editor has
      // one chip language and a tag is another navigable reference. Padding
      // stays at px-0.5 rather than the void chip's px-1: this one is
      // DECORATED TEXT the caret still walks through.
      className="cursor-pointer rounded-sm bg-primary/10 px-0.5 text-primary transition-colors hover:bg-primary/20"
      attributes={{
        ...props.attributes,
        onClick: () => {
          if (tag !== "" && !hasRangeSelection()) browseTag(tag);
        },
        title: `Browse notes tagged #${tag}`,
      }}
    />
  );
}
