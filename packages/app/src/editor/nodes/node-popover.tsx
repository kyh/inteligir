// Minimal Base UI popover for editor node UIs (date picker, equation editor).
// Interim primitive: WP3 lands the house `@repo/ui/components/popover`; this
// file then becomes a thin re-style or is deleted in favor of it. Kept local
// to the editor so @repo/ui's public surface stays WP3-owned.

import { type ComponentProps } from "react";
import { Popover as PopoverPrimitive } from "@base-ui/react/popover";

import { cn } from "@repo/ui/lib/utils";

// Mirrors @repo/ui menu.tsx's popupClass so node popovers sit on the same
// elevation as menus until WP4's shadow-ladder pass.
const popupClass =
  "z-50 max-h-[var(--available-height)] origin-[var(--transform-origin)] rounded-lg border border-border bg-popover text-popover-foreground shadow-md outline-none transition-[transform,opacity] data-[ending-style]:opacity-0 data-[starting-style]:opacity-0";

function NodePopover(props: ComponentProps<typeof PopoverPrimitive.Root>) {
  return <PopoverPrimitive.Root {...props} />;
}

const NodePopoverTrigger = PopoverPrimitive.Trigger;

function NodePopoverContent({
  className,
  side = "bottom",
  align = "start",
  sideOffset = 4,
  anchor,
  ...props
}: ComponentProps<typeof PopoverPrimitive.Popup> & {
  side?: ComponentProps<typeof PopoverPrimitive.Positioner>["side"];
  align?: ComponentProps<typeof PopoverPrimitive.Positioner>["align"];
  sideOffset?: number;
  anchor?: ComponentProps<typeof PopoverPrimitive.Positioner>["anchor"];
}) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Positioner
        side={side}
        align={align}
        sideOffset={sideOffset}
        anchor={anchor}
        className="z-50"
      >
        <PopoverPrimitive.Popup className={cn(popupClass, className)} {...props} />
      </PopoverPrimitive.Positioner>
    </PopoverPrimitive.Portal>
  );
}

export { NodePopover, NodePopoverContent, NodePopoverTrigger };
