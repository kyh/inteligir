'use client';

import { cva, type VariantProps } from 'class-variance-authority';
import { CheckIcon, ChevronRightIcon } from 'lucide-react';
import { DropdownMenu as DropdownMenuPrimitive } from 'radix-ui';
import * as React from 'react';

import { cn } from '@/lib/utils';

export const dropdownMenuItemVariants = cva(
  cn(
    'no-focus-ring relative flex cursor-pointer select-none items-center gap-2 rounded-md align-middle text-sm transition-bg-ease data-disabled:pointer-events-none data-disabled:opacity-50',
    '[&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-subtle-foreground',
    'text-accent-foreground hover:bg-accent focus:bg-accent focus:text-accent-foreground'
  ),
  {
    defaultVariants: {
      size: 'default',
      variant: 'default',
    },
    variants: {
      size: {
        default: 'mx-1 h-[28px] w-[calc(100%-8px)] px-2.5',
        none: '',
      },
      variant: {
        default: 'focus:bg-accent focus:text-accent-foreground',
        none: '',
      },
    },
  }
);

const dropdownMenuLabelVariants = cva(
  cn(
    'mt-1.5 mb-2 cursor-default select-none px-[14px] font-medium text-muted-foreground text-xs'
  ),
  {
    variants: {
      inset: {
        true: 'pl-8',
      },
    },
  }
);

export type DropdownMenuProps = DropdownMenuPrimitive.DropdownMenuProps;

export function DropdownMenu(props: DropdownMenuProps) {
  return <DropdownMenuPrimitive.Root {...props} />;
}

export function DropdownMenuTrigger(
  props: DropdownMenuPrimitive.DropdownMenuTriggerProps
) {
  return <DropdownMenuPrimitive.Trigger {...props} />;
}

export function DropdownMenuGroup(
  props: DropdownMenuPrimitive.DropdownMenuGroupProps
) {
  return <DropdownMenuPrimitive.Group className="py-1.5" {...props} />;
}

export function DropdownMenuPortal(
  props: DropdownMenuPrimitive.DropdownMenuPortalProps
) {
  return <DropdownMenuPrimitive.Portal {...props} />;
}

export function DropdownMenuSub(
  props: DropdownMenuPrimitive.DropdownMenuSubProps
) {
  return <DropdownMenuPrimitive.Sub {...props} />;
}

export function DropdownMenuRadioGroup(
  props: DropdownMenuPrimitive.DropdownMenuRadioGroupProps
) {
  return <DropdownMenuPrimitive.RadioGroup {...props} />;
}

export function DropdownMenuSubTrigger({
  children,
  className,
  inset,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.SubTrigger> & {
  inset?: boolean;
}) {
  return (
    <DropdownMenuPrimitive.SubTrigger
      className={cn(
        'mx-1 flex cursor-default select-none items-center gap-2 rounded-md px-2 py-1.5 text-sm outline-hidden focus:bg-accent data-[state=open]:bg-accent',
        'no-focus-ring',
        'data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0',
        inset && 'pl-8',
        className
      )}
      {...props}
    >
      {children}
      <ChevronRightIcon className="ml-auto" />
    </DropdownMenuPrimitive.SubTrigger>
  );
}

export function DropdownMenuSubContent({
  className,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.SubContent>) {
  return (
    <DropdownMenuPrimitive.SubContent
      className={cn(
        'data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 z-50 min-w-32 overflow-hidden rounded-lg bg-popover p-1 text-popover-foreground shadow-floating data-[state=closed]:animate-out data-[state=open]:animate-in',
        className
      )}
      {...props}
    />
  );
}

export function DropdownMenuContent({
  className,
  portal,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Content> & {
  portal?: boolean;
}) {
  const content = (
    <DropdownMenuPrimitive.Content
      className={cn(
        'no-focus-ring z-50 min-w-32 max-w-[100vw] overflow-hidden rounded-lg bg-popover p-0 text-popover-foreground text-sm shadow-floating',
        'data-[state=closed]:hidden data-[side=bottom]:origin-top data-[side=left]:origin-right data-[side=right]:origin-left data-[side=top]:origin-bottom data-[state=open]:animate-zoom',
        className
      )}
      sideOffset={4}
      {...props}
    />
  );

  if (portal) {
    return (
      <DropdownMenuPrimitive.Portal>{content}</DropdownMenuPrimitive.Portal>
    );
  }

  return content;
}

export function DropdownMenuItem({
  className,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Item> &
  VariantProps<typeof dropdownMenuItemVariants>) {
  return (
    <DropdownMenuPrimitive.Item
      className={cn(dropdownMenuItemVariants(), className)}
      {...props}
    />
  );
}

export function DropdownMenuCheckboxItem({
  children,
  className,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.CheckboxItem>) {
  return (
    <DropdownMenuPrimitive.CheckboxItem
      className={cn(
        'no-focus-ring relative flex select-none items-center gap-2 rounded-sm py-1.5 pr-8 pl-2 transition-bg-ease focus:bg-accent focus:text-accent-foreground data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:size-4',
        'mx-1 h-[28px] cursor-pointer px-2.5 data-[state=highlighted]:bg-accent data-[state=highlighted]:text-accent-foreground',
        className
      )}
      {...props}
    >
      <span className="absolute right-2 flex size-3.5 items-center justify-center">
        <DropdownMenuPrimitive.ItemIndicator>
          <CheckIcon />
        </DropdownMenuPrimitive.ItemIndicator>
      </span>
      {children}
    </DropdownMenuPrimitive.CheckboxItem>
  );
}

export function DropdownMenuRadioItem({
  children,
  className,
  hideIcon,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.RadioItem> & {
  hideIcon?: boolean;
}) {
  return (
    <DropdownMenuPrimitive.RadioItem
      className={cn(
        'no-focus-ring relative flex select-none items-center rounded-sm pr-2 pl-8 transition-bg-ease focus:bg-accent focus:text-accent-foreground data-disabled:pointer-events-none data-disabled:opacity-50',
        'mx-1 h-[28px] cursor-pointer gap-2 px-2.5 data-[state=highlighted]:bg-accent data-[state=highlighted]:text-accent-foreground [&_svg]:size-4',
        className
      )}
      {...props}
    >
      {!hideIcon && (
        <span className="absolute right-2 flex size-3.5 items-center justify-center">
          <DropdownMenuPrimitive.ItemIndicator>
            <CheckIcon />
          </DropdownMenuPrimitive.ItemIndicator>
        </span>
      )}
      {children}
    </DropdownMenuPrimitive.RadioItem>
  );
}

export function DropdownMenuLabel({
  className,
  inset,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Label> & {
  inset?: boolean;
}) {
  return (
    <DropdownMenuPrimitive.Label
      className={cn(dropdownMenuLabelVariants({ inset }), className)}
      {...props}
    />
  );
}

export function DropdownMenuSeparator({
  className,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Separator>) {
  return (
    <DropdownMenuPrimitive.Separator
      className={cn('-mx-1 my-1 h-px bg-muted', className)}
      {...props}
    />
  );
}

export function DropdownMenuShortcut({
  className,
  ...props
}: React.ComponentProps<'span'>) {
  return (
    <span
      className={cn('ml-auto text-xs tracking-widest opacity-60', className)}
      {...props}
    />
  );
}

export function useOpenState() {
  const [open, setOpen] = React.useState(false);

  const onOpenChange = React.useCallback(
    (_value = !open) => {
      setOpen(_value);
    },
    [open]
  );

  return {
    open,
    onOpenChange,
  };
}
