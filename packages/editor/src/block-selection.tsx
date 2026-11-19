// @license MIT, vendored from plate (github.com/udecode/plate). © Plate contributors.

import { useBlockSelected } from "@platejs/selection/react";

import { cn } from "@repo/ui/lib/cn";

export const BlockSelection = ({ pluginKey }: { pluginKey: string }) => {
  const isBlockSelected = Boolean(useBlockSelected());

  if (!isBlockSelected || pluginKey === "tr" || pluginKey === "table") {
    return null;
  }

  return (
    <span
      className={cn(
        'pointer-events-none absolute inset-0 z-1 block size-full rounded-[4px] content-[""]',
        "bg-focus-ring/15 transition-opacity duration-200",
      )}
      data-slot="block-selection"
    />
  );
};
