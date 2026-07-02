/* Adapted from Plate Plus Potion (https://pro.platejs.org) — used under the
 * held Plate Plus license. */
// Per-block selection overlay: BlockSelectionPlugin renders this below every
// selectable block's root node; it lights up when the block's id is in the
// selected set (right-click, grip click, or drag-lasso selection).

import { useBlockSelected } from "@platejs/selection/react";

import { cn } from "@repo/ui/lib/utils";

export function BlockSelection({ pluginKey }: { pluginKey: string }) {
  const isBlockSelected = useBlockSelected();

  // Tables carry their own cell-selection UI; the overlay would double up.
  if (!isBlockSelected || pluginKey === "tr" || pluginKey === "table") return null;

  // span, not div: paragraphs render as <p>, and a div child is invalid
  // nesting (React dev warns per block).
  return (
    <span
      className={cn(
        'pointer-events-none absolute inset-0 z-1 block size-full rounded-[4px] content-[""]',
        "bg-primary/15 transition-opacity duration-200",
      )}
      data-slot="block-selection"
    />
  );
}
