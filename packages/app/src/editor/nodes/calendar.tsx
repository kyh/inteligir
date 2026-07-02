// react-day-picker v9 restyled with the app's tokens (no rdp stylesheet —
// fully classNames-driven, adapting potion's v8 map to the v9 API: classNames
// keys overhauled, `components.Chevron` replaces IconLeft/IconRight).
// Loaded lazily by date-node.tsx so rdp stays out of the initial chunk.

import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { DayPicker, type DayPickerProps } from "react-day-picker";

import { cn } from "@repo/ui/lib/utils";

const NAV_BUTTON =
  "inline-flex size-7 items-center justify-center rounded-md border border-border bg-transparent text-foreground opacity-60 transition-opacity hover:opacity-100 disabled:pointer-events-none disabled:opacity-30";

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
        day_button:
          "inline-flex size-8 items-center justify-center rounded-md font-normal transition-colors hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
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
