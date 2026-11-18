"use client";
// @license MIT, vendored from Fluid Functionalism (github.com/mickadesign/fluid-functionalism).

import { useState } from "react";
import type { ComponentProps, ReactNode, RefAttributes } from "react";
import { Menu } from "@base-ui/react/menu";
import { CheckIcon } from "lucide-react";

import { cn } from "@repo/ui/lib/cn";
import { spring } from "@repo/ui/lib/springs";
import { composeRefs } from "@repo/ui/lib/compose-refs";
import { motionProps, motionStyle } from "@repo/ui/lib/motion-style";
import { PopupOpen, PopupPresence } from "@repo/ui/lib/popup-presence";
import { RowPills } from "@repo/ui/components/row-pills";
import { useLayoutReading } from "@repo/ui/hooks/use-layout-reading";
import { radius } from "@repo/ui/lib/radius";
import { rowBox } from "@repo/ui/lib/row-box";
import type { RowBox } from "@repo/ui/lib/row-box";
import { Elevated } from "@repo/ui/lib/elevated";

interface DropdownMenuProps {
  children: ReactNode;
  open?: boolean | undefined;
  defaultOpen?: boolean;
  onOpenChange?: ((open: boolean) => void) | undefined;
  disabled?: boolean;
  modal?: boolean;
}

const DropdownMenu = ({
  children,
  open: openProp,
  defaultOpen = false,
  onOpenChange,
  disabled = false,
  modal = false,
}: DropdownMenuProps) => {
  const [ownOpen, setOwnOpen] = useState(defaultOpen);
  const open = openProp ?? ownOpen;

  return (
    <Menu.Root
      open={open}
      onOpenChange={(next) => {
        setOwnOpen(next);
        onOpenChange?.(next);
      }}
      disabled={disabled}
      modal={modal}
    >
      <PopupOpen open={open}>{children}</PopupOpen>
    </Menu.Root>
  );
};

const DropdownMenuTrigger = Menu.Trigger;

const HIGHLIGHTED = "data-highlighted";
const MARKS = [HIGHLIGHTED];

const highlightedRow = (popup: HTMLElement, last: RowBox | null) =>
  rowBox(popup.querySelector<HTMLElement>(`[${HIGHLIGHTED}]`), last);

type MenuPositionerProps = ComponentProps<typeof Menu.Positioner>;

interface DropdownMenuContentProps {
  children: ReactNode;
  className?: string | undefined;
  side?: MenuPositionerProps["side"];
  align?: MenuPositionerProps["align"];
  sideOffset?: number | undefined;
  alignOffset?: number | undefined;
  anchor?: MenuPositionerProps["anchor"];
}

const DropdownMenuContent = ({
  className,
  children,
  side = "bottom",
  align = "start",
  sideOffset = 6,
  alignOffset = 0,
  anchor,
  ref,
}: DropdownMenuContentProps & RefAttributes<HTMLDivElement>) => {
  const [popup, setPopup] = useState<HTMLDivElement | null>(null);
  const lit = useLayoutReading(popup, null, highlightedRow, MARKS);
  const [ringed, setRinged] = useState(false);
  const [session, setSession] = useState(0);

  const hidden = { opacity: 0, scaleY: 0.96, y: side === "top" ? 4 : -4 };

  return (
    <PopupPresence>
      <Menu.Portal keepMounted>
        <Menu.Positioner
          side={side}
          align={align}
          sideOffset={sideOffset}
          alignOffset={alignOffset}
          anchor={anchor}
          className="z-50 outline-none"
        >
          <Menu.Popup
            ref={composeRefs<HTMLDivElement>(setPopup, ref)}
            render={(popupProps) => {
              const { style: baseStyle, ...rest } = motionProps(popupProps);

              return (
                <Elevated
                  {...rest}
                  offset={2}
                  shadowLevel={3}
                  style={motionStyle(baseStyle, {
                    transformOrigin: side === "top" ? "bottom center" : "top center",
                  })}
                  initial={hidden}
                  animate={{ opacity: 1, scaleY: 1, transition: spring.fast, y: 0 }}
                  exit={{ ...hidden, transition: spring.fast.exit }}
                />
              );
            }}
            onMouseEnter={() => {
              setSession((entered) => entered + 1);
              setRinged(false);
            }}
            onFocus={(e) => {
              setRinged(e.target.matches(":focus-visible"));
            }}
            className={cn(
              `relative flex flex-col gap-0.5 w-72 max-w-full min-w-[var(--anchor-width)] max-h-[min(480px,var(--available-height))] overflow-y-auto ${radius.container} p-1 select-none outline-none`,
              className,
            )}
          >
            <RowPills hover={lit} focus={ringed ? lit : null} session={session} />
            {children}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </PopupPresence>
  );
};

const DropdownMenuLabel = ({
  className,
  ref,
  ...props
}: ComponentProps<"div"> & RefAttributes<HTMLDivElement>) => (
  <div
    ref={ref}
    className={cn("px-2 py-1.5 shrink-0 text-caption text-muted-foreground", className)}
    {...props}
  />
);

const DropdownMenuSeparator = ({
  className,
  ref,
  ...props
}: ComponentProps<"div"> & RefAttributes<HTMLDivElement>) => (
  <div
    ref={ref}
    // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- <hr> cannot carry the div ref and props this slot exposes
    role="separator"
    className={cn("my-1 -mx-1 h-px shrink-0 bg-border/60", className)}
    {...props}
  />
);

type MenuRowVariant = "default" | "destructive";

const menuRowClass = (variant: MenuRowVariant) =>
  cn(
    `relative z-10 flex h-7 shrink-0 items-center gap-1 ${radius.item} px-1.5 text-body cursor-pointer outline-none select-none`,
    "before:absolute before:inset-x-0 before:-inset-y-px",
    "transition-colors duration-80",
    variant === "destructive"
      ? "text-destructive"
      : "text-muted-foreground data-highlighted:text-foreground",
    "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
    "data-disabled:pointer-events-none data-disabled:opacity-50",
  );

interface DropdownMenuItemProps extends ComponentProps<"div"> {
  disabled?: boolean | undefined;
  variant?: MenuRowVariant | undefined;
  closeOnClick?: boolean | undefined;
}

const DropdownMenuItem = ({
  className,
  variant = "default",
  disabled = false,
  closeOnClick,
  children,
  ref,
  ...props
}: DropdownMenuItemProps) => (
  <Menu.Item
    disabled={disabled}
    closeOnClick={closeOnClick ?? true}
    render={<div ref={ref} className={cn(menuRowClass(variant), className)} {...props} />}
  >
    {children}
  </Menu.Item>
);

interface DropdownMenuRadioItemProps extends ComponentProps<"div"> {
  value: string;
  disabled?: boolean | undefined;
  closeOnClick?: boolean | undefined;
}

const DropdownMenuRadioItem = ({
  className,
  value,
  disabled = false,
  closeOnClick,
  children,
  ref,
  ...props
}: DropdownMenuRadioItemProps) => (
  <Menu.RadioItem
    value={value}
    disabled={disabled}
    closeOnClick={closeOnClick ?? true}
    render={<div ref={ref} className={cn(menuRowClass("default"), className)} {...props} />}
  >
    {children}
    <Menu.RadioItemIndicator className="ml-auto flex">
      <CheckIcon />
    </Menu.RadioItemIndicator>
  </Menu.RadioItem>
);

interface DropdownMenuGroupProps extends Omit<ComponentProps<typeof Menu.Group>, "className"> {
  className?: string | undefined;
}

const DropdownMenuGroup = ({ className, ...props }: DropdownMenuGroupProps) => (
  <Menu.Group className={cn("contents", className)} {...props} />
);

interface DropdownMenuRadioGroupProps extends Omit<
  ComponentProps<typeof Menu.RadioGroup>,
  "className" | "value" | "defaultValue" | "onValueChange"
> {
  className?: string | undefined;
  value: string;
  onValueChange: (value: string) => void;
}

const DropdownMenuRadioGroup = ({ className, ...props }: DropdownMenuRadioGroupProps) => (
  <Menu.RadioGroup className={cn("contents", className)} {...props} />
);

export {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioItem,
  DropdownMenuGroup,
  DropdownMenuRadioGroup,
  DropdownMenuLabel,
  DropdownMenuSeparator,
};
