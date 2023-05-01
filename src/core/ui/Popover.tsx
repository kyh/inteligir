import { forwardRef } from "react";

import * as PopoverPrimitive from "@radix-ui/react-popover";
import clsx from "clsx";

const Popover = PopoverPrimitive.Root;

const PopoverTrigger = PopoverPrimitive.Trigger;

const PopoverContent = forwardRef<
  React.ElementRef<typeof PopoverPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof PopoverPrimitive.Content>
>(function PopoverContentComponent(
  { className, align = "start", sideOffset = 8, alignOffset = 0, ...props },
  ref
) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        ref={ref}
        align={align}
        sideOffset={sideOffset}
        alignOffset={alignOffset}
        className={clsx(
          `animate-in data-[side=bottom]:slide-in-from-top-2
          data-[side=top]:slide-in-from-bottom-2 z-50 rounded-md border
          border-gray-100 bg-white p-2 shadow-lg outline-none
          dark:border-black-300 dark:bg-black-400`,
          className
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
      className={clsx(
        `flex cursor-pointer items-center rounded-md bg-transparent px-4 py-2 transition duration-150 ease-in-out hover:bg-gray-50 focus:outline-none active:bg-gray-100 dark:hover:bg-black-300 dark:active:bg-black-300`,
        className
      )}
      {...props}
    >
      <span
        className={clsx(
          `truncate text-sm font-medium text-gray-700 hover:text-black-500 dark:text-gray-300 dark:hover:text-white`
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
  <div
    className={clsx(
      `my-1 border-t border-gray-100 dark:border-black-300`,
      className
    )}
  />
);

PopoverContent.displayName = PopoverPrimitive.Content.displayName;

export { Popover, PopoverTrigger, PopoverContent, PopoverItem, PopoverDivider };
