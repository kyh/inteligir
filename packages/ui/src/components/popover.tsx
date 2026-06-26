"use client";

import { Popover as PopoverPrimitive } from "@base-ui/react/popover";

import { cn } from "@repo/ui/lib/utils";
import { GLASS_TIER } from "@repo/ui/lib/surface-classes";
import { GlassProvider, SurfaceProvider, useSurface } from "@repo/ui/lib/surface-context";

// A popup floats two elevation steps above whatever surface it opens over.
const POPUP_OFFSET = 2;

function Popover({ ...props }: PopoverPrimitive.Root.Props) {
  return <PopoverPrimitive.Root data-slot="popover" {...props} />;
}

function PopoverTrigger({ ...props }: PopoverPrimitive.Trigger.Props) {
  return <PopoverPrimitive.Trigger data-slot="popover-trigger" {...props} />;
}

function PopoverContent({
  className,
  align = "center",
  alignOffset = 0,
  side = "bottom",
  sideOffset = 4,
  children,
  ...props
}: PopoverPrimitive.Popup.Props &
  Pick<PopoverPrimitive.Positioner.Props, "align" | "alignOffset" | "side" | "sideOffset">) {
  const substrate = useSurface();
  const popupLevel = Math.min(substrate + POPUP_OFFSET, 8);
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Positioner
        align={align}
        alignOffset={alignOffset}
        side={side}
        sideOffset={sideOffset}
        className="isolate z-50"
      >
        <PopoverPrimitive.Popup
          data-slot="popover-content"
          className={cn(
            "z-50 flex w-72 origin-(--transform-origin) flex-col gap-4 rounded-[var(--radius-menu)] p-4 text-sm text-glass-fg outline-hidden duration-100 data-[side=bottom]:slide-in-from-top-2 data-[side=inline-end]:slide-in-from-left-2 data-[side=inline-start]:slide-in-from-right-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
            // Transient overlays are smoked glass in both themes.
            GLASS_TIER.deep,
            className,
          )}
          {...props}
        >
          <SurfaceProvider value={popupLevel}>
            <GlassProvider value={true}>{children}</GlassProvider>
          </SurfaceProvider>
        </PopoverPrimitive.Popup>
      </PopoverPrimitive.Positioner>
    </PopoverPrimitive.Portal>
  );
}

export { Popover, PopoverContent, PopoverTrigger };
