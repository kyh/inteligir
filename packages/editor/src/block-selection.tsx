// Vendored from plate (github.com/udecode/plate), MIT. © Plate contributors.

import { useBlockSelected } from "@platejs/selection/react";

import { cn } from "@repo/ui/lib/utils";

export function BlockSelection({ pluginKey }: { pluginKey: string }) {
  const isBlockSelected = useBlockSelected();

  // tables carry their own cell-selection UI
  if (!isBlockSelected || pluginKey === "tr" || pluginKey === "table") return null;

  // span, not div: a div inside <p> is invalid nesting
  return (
    <span
      className={cn(
        'pointer-events-none absolute inset-0 z-1 block size-full rounded-[4px] content-[""]',
        "bg-focus-ring/15 transition-opacity duration-200",
      )}
      data-slot="block-selection"
    />
  );
}
