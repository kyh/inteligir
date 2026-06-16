"use client";

import { Menu as MenuPrimitive } from "@base-ui/react/menu";

import { cn } from "@repo/ui/lib/utils";
import { GLASS_TIER } from "@repo/ui/lib/surface-classes";
import { GlassProvider, SurfaceProvider, useSurface } from "@repo/ui/lib/surface-context";

// A popup floats two elevation steps above whatever surface it opens over.
const POPUP_OFFSET = 2;

function DropdownMenu({ ...props }: MenuPrimitive.Root.Props) {
  return <MenuPrimitive.Root data-slot="dropdown-menu" {...props} />;
}

function DropdownMenuTrigger({ ...props }: MenuPrimitive.Trigger.Props) {
  return <MenuPrimitive.Trigger data-slot="dropdown-menu-trigger" {...props} />;
}

function DropdownMenuContent({
  align = "start",
  alignOffset = 0,
  side = "bottom",
  sideOffset = 4,
  className,
  children,
  ...props
}: MenuPrimitive.Popup.Props &
  Pick<MenuPrimitive.Positioner.Props, "align" | "alignOffset" | "side" | "sideOffset">) {
  const substrate = useSurface();
  const popupLevel = Math.min(substrate + POPUP_OFFSET, 8);
  return (
    <MenuPrimitive.Portal>
      <MenuPrimitive.Positioner
        className="isolate z-50 outline-none"
        align={align}
        alignOffset={alignOffset}
        side={side}
        sideOffset={sideOffset}
      >
        <MenuPrimitive.Popup
          data-slot="dropdown-menu-content"
          className={cn(
            "z-50 max-h-(--available-height) w-(--anchor-width) min-w-32 origin-(--transform-origin) overflow-x-hidden overflow-y-auto rounded-[var(--radius-menu)] p-1.5 text-glass-fg duration-100 outline-none data-[side=bottom]:slide-in-from-top-2 data-[side=inline-end]:slide-in-from-left-2 data-[side=inline-start]:slide-in-from-right-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:overflow-hidden data-closed:fade-out-0 data-closed:zoom-out-95",
            // Menus are smoked glass in both themes (refs' "Isolate View" menu).
            GLASS_TIER.deep,
            className,
          )}
          {...props}
        >
          <SurfaceProvider value={popupLevel}>
            <GlassProvider value={true}>{children}</GlassProvider>
          </SurfaceProvider>
        </MenuPrimitive.Popup>
      </MenuPrimitive.Positioner>
    </MenuPrimitive.Portal>
  );
}

function DropdownMenuItem({
  className,
  inset,
  variant = "default",
  ...props
}: MenuPrimitive.Item.Props & {
  inset?: boolean;
  variant?: "default" | "destructive";
}) {
  return (
    <MenuPrimitive.Item
      data-slot="dropdown-menu-item"
      data-inset={inset}
      data-variant={variant}
      className={cn(
        // Inside-glass row recipe: 10px-radius lighter-white pill on highlight,
        // 13px white text. Destructive reads #ffb4ab for contrast on the dark
        // glass (the destructive token is tuned for opaque surfaces).
        "group/dropdown-menu-item relative flex cursor-default items-center gap-2 rounded-[10px] px-2.5 py-1.5 text-[13px] text-glass-fg outline-hidden select-none focus:bg-glass-row-hover focus:text-glass-fg not-data-[variant=destructive]:focus:**:text-glass-fg data-inset:pl-8 data-[variant=destructive]:text-[#ffb4ab] data-[variant=destructive]:focus:bg-white/10 data-[variant=destructive]:focus:text-[#ffb4ab] data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 data-[variant=destructive]:*:[svg]:text-[#ffb4ab]",
        className,
      )}
      {...props}
    />
  );
}

export { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem };
