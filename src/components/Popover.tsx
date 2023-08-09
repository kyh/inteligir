import { forwardRef } from "react";
import * as PopoverPrimitive from "@radix-ui/react-popover";
import { cn } from "~/lib/utils";

const Popover = PopoverPrimitive.Root;

const PopoverTrigger = PopoverPrimitive.Trigger;

const PopoverContent = forwardRef<
  React.ElementRef<typeof PopoverPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof PopoverPrimitive.Content>
>(function PopoverContentComponent(
  { className, align = "start", sideOffset = 8, alignOffset = 0, ...props },
  ref,
) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        ref={ref}
        align={align}
        sideOffset={sideOffset}
        alignOffset={alignOffset}
        className={cn(
          `z-50 rounded-md
          border border-border bg-white p-2
          shadow-lg outline-none animate-in data-[side=bottom]:slide-in-from-top-2 data-[side=top]:slide-in-from-bottom-2
        dark:bg-zinc-400`,
          className,
        )}
        {...props}
      />
    </PopoverPrimitive.Portal>
  );
});

const PopoverItem = forwardRef<
  HTMLDivElement,
  React.PropsWithChildren<React.HTMLAttributes<HTMLDivElement>>
>(function PopoverItemComponent({ children, className, ...props }, ref) {
  return (
    <div
      ref={ref}
      className={cn(
        `flex cursor-pointer items-center rounded-md bg-transparent px-4 py-2 transition duration-150 ease-in-out hover:bg-zinc-50 focus:outline-none active:bg-zinc-100 dark:hover:bg-zinc-300 dark:active:bg-zinc-300`,
        className,
      )}
      {...props}
    >
      <span
        className={cn(
          `truncate text-sm font-medium text-zinc-700 hover:text-zinc-500 dark:text-zinc-300 dark:hover:text-white`,
        )}
      >
        {children}
      </span>
    </div>
  );
});

const PopoverDivider: React.FC<{
  className?: string;
}> = ({ className }) => (
  <div className={cn(`my-1 border-t border-border`, className)} />
);

PopoverContent.displayName = PopoverPrimitive.Content.displayName;

export { Popover, PopoverTrigger, PopoverContent, PopoverItem, PopoverDivider };
