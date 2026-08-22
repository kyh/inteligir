// react-day-picker v9 restyled with the app's tokens (no rdp stylesheet —
// fully classNames-driven, in the shadcn calendar idiom on the v9 API:
// `components.Chevron` replaces IconLeft/IconRight).
// Loaded lazily by date-node.tsx so rdp stays out of the initial chunk.

import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { DayPicker, type DayPickerProps } from "react-day-picker";

import { cn } from "@repo/ui/lib/utils";
import { buttonVariants } from "@repo/ui/components/button";

// DayPicker renders its own <button>s, so the stock Button styling arrives as
// buttonVariants class strings rather than the component.
const NAV_BUTTON = cn(
  buttonVariants({ variant: "outline", size: "icon-sm" }),
  "rounded-md bg-transparent opacity-60 hover:opacity-100 disabled:opacity-30",
);

export function Calendar({ className, classNames, ...props }: DayPickerProps) {
  return (
    <DayPicker
      showOutsideDays
      className={cn("p-3", className)}
      classNames={{
        button_next: NAV_BUTTON,
        button_previous: NAV_BUTTON,
        caption_label: "text-sm font-medium",
        chevron: "size-4 fill-current",
        day: "p-0 text-center text-sm",
        day_button: cn(
          buttonVariants({ variant: "ghost", size: "icon" }),
          // size-8 pins the fluid 36px icon button back to the w-8 weekday
          // column so day cells stay aligned with their headers.
          "size-8 rounded-md font-normal hover:bg-hover dark:hover:bg-hover",
        ),
        disabled: "text-muted-foreground opacity-50",
        hidden: "invisible",
        month: "space-y-4",
        month_caption: "relative flex h-7 items-center justify-center",
        month_grid: "w-full border-collapse",
        months: "relative flex flex-col gap-4",
        nav: "absolute inset-x-3 top-3 z-10 flex items-center justify-between",
        outside: "[&_button]:text-muted-foreground [&_button]:opacity-50",
        root: "relative",
        // Selected day is the filled primary pill; today gets a ring so the
        // two states stay distinct when they coincide (ring under the fill).
        selected:
          "[&_button]:bg-primary [&_button]:text-primary-foreground [&_button]:hover:bg-primary [&_button]:hover:text-primary-foreground",
        today: "[&_button]:font-medium [&_button]:ring-1 [&_button]:ring-ring/50",
        week: "mt-1 flex w-full",
        weekday: "w-8 text-[0.8rem] font-normal text-muted-foreground",
        weekdays: "flex",
        ...classNames,
      }}
      components={{
        Chevron: ({ orientation, className: chevronClass }) =>
          orientation === "left" ? (
            <ChevronLeftIcon className={cn("size-4", chevronClass)} />
          ) : (
            <ChevronRightIcon className={cn("size-4", chevronClass)} />
          ),
      }}
      {...props}
    />
  );
}
