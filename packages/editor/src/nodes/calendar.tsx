// No rdp stylesheet: every class is supplied here.

import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { DayPicker, type DayPickerProps } from "react-day-picker";

import { cn } from "@repo/ui/lib/utils";
import { buttonVariants } from "@repo/ui/components/button";

// DayPicker renders its own <button>s, so Button styling arrives as class strings.
const NAV_BUTTON = cn(
  buttonVariants({ variant: "tertiary", size: "icon-compact" }),
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
