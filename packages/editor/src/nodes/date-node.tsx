// Never toDateString() (en-US locale bytes) or toISOString() (UTC-shifts across midnight), and
// never set rawDate: its presence flips Plate's serializer to the `<date>text</date>` form.

import { Suspense, lazy, useState } from "react";
import { PlateElement, useEditorRef, useElement, useReadOnly } from "platejs/react";
import type { PlateElementProps } from "platejs/react";

import { formatIsoDate } from "@repo/notes/iso-date";

import { stringProp } from "@repo/editor/node-props";

import { cn } from "cn";

import { Popover, PopoverContent, PopoverTrigger } from "@repo/ui/components/popover";

const Calendar = lazy(
  async () =>
    await import("@repo/editor/nodes/calendar").then((mod) => ({ default: mod.Calendar })),
);

const ISO_RE = /^(?<year>\d{4})-(?<month>\d{2})-(?<day>\d{2})$/u;

// `new Date("YYYY-MM-DD")` is UTC midnight and renders a day early west of Greenwich.
const fromIso = (value: string): Date | null => {
  const groups = ISO_RE.exec(value)?.groups;
  if (!groups) {
    return null;
  }
  return new Date(Number(groups.year), Number(groups.month) - 1, Number(groups.day));
};

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

const label = (value: string): string => {
  const date = fromIso(value);
  if (!date) {
    return value || "Pick a date";
  }
  const today = new Date();
  const dayDiff = Math.round((startOfDay(date) - startOfDay(today)) / 86_400_000);
  if (dayDiff === 0) {
    return "Today";
  }
  if (dayDiff === -1) {
    return "Yesterday";
  }
  if (dayDiff === 1) {
    return "Tomorrow";
  }
  return date.toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" });
};

export const DateElement = (props: PlateElementProps) => {
  const editor = useEditorRef();
  const element = useElement();
  const readOnly = useReadOnly();
  const [open, setOpen] = useState(false);

  const value = stringProp(element, "date") ?? "";

  return (
    <PlateElement {...props} as="span" className="inline-block">
      <Popover
        open={open}
        onOpenChange={(next) => {
          if (!readOnly) {
            setOpen(next);
          }
        }}
      >
        <PopoverTrigger
          className={cn(
            "w-fit cursor-pointer rounded-sm px-0.5 text-primary/65 transition-colors hover:bg-primary/10",
            open && "bg-primary/10",
          )}
          contentEditable={false}
          draggable={false}
        >
          <span className="font-semibold text-primary/45">@</span>
          {label(value)}
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0">
          <Suspense fallback={<div className="size-64 animate-pulse rounded-lg bg-muted" />}>
            <Calendar
              autoFocus
              mode="single"
              selected={fromIso(value) ?? undefined}
              onSelect={(date) => {
                const at = editor.api.findPath(element);
                if (date && at) {
                  editor.tf.setNodes({ date: formatIsoDate(date) }, { at });
                }
                setOpen(false);
              }}
            />
          </Suspense>
        </PopoverContent>
      </Popover>
      {props.children}
    </PlateElement>
  );
};
