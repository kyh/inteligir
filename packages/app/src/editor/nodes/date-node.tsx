// Inline date chip: renders the node's ISO `date` value with Today/Yesterday/
// Tomorrow shortcuts (display-only — the stored bytes never localize); click
// opens a Base UI popover with the react-day-picker calendar (lazy chunk).
//
// ISO discipline (locked): the node stores `date: "YYYY-MM-DD"` built from
// the picked LOCAL date — never toDateString() (en-US locale bytes) and never
// toISOString() (UTC-shifts across midnight). `rawDate` is never set — its
// presence flips Plate's serializer to the `<date>text</date>` children form.

import { Suspense, lazy, useState } from "react";
import { PlateElement, useEditorRef, useElement, useReadOnly, type PlateElementProps } from "platejs/react";

import { cn } from "@repo/ui/lib/utils";

import {
  NodePopover,
  NodePopoverContent,
  NodePopoverTrigger,
} from "@repo/app/editor/nodes/node-popover";

const Calendar = lazy(() =>
  import("@repo/app/editor/nodes/calendar").then((mod) => ({ default: mod.Calendar })),
);

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

const pad = (n: number) => String(n).padStart(2, "0");

function toIso(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

// Parse ISO as a LOCAL date — `new Date("YYYY-MM-DD")` is UTC midnight and
// renders a day early west of Greenwich.
function fromIso(value: string): Date | null {
  const match = ISO_RE.exec(value);
  if (!match) return null;
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

function label(value: string): string {
  const date = fromIso(value);
  if (!date) return value || "Pick a date";
  const today = new Date();
  const dayDiff = Math.round((startOfDay(date) - startOfDay(today)) / 86_400_000);
  if (dayDiff === 0) return "Today";
  if (dayDiff === -1) return "Yesterday";
  if (dayDiff === 1) return "Tomorrow";
  return date.toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" });
}

export function DateElement(props: PlateElementProps) {
  const editor = useEditorRef();
  const element = useElement();
  const readOnly = useReadOnly();
  const [open, setOpen] = useState(false);

  const value = typeof element.date === "string" ? element.date : "";

  return (
    <PlateElement {...props} className="inline-block">
      <NodePopover open={open} onOpenChange={(next) => !readOnly && setOpen(next)}>
        <NodePopoverTrigger
          className={cn(
            "w-fit cursor-pointer rounded-sm px-0.5 text-primary/65 transition-colors hover:bg-primary/10",
            open && "bg-primary/10",
          )}
          contentEditable={false}
          draggable={false}
        >
          <span className="font-semibold text-primary/45">@</span>
          {label(value)}
        </NodePopoverTrigger>
        <NodePopoverContent className="w-auto p-0">
          <Suspense fallback={<div className="size-64 animate-pulse rounded-lg bg-muted" />}>
            <Calendar
              autoFocus
              mode="single"
              selected={fromIso(value) ?? undefined}
              onSelect={(date) => {
                const at = editor.api.findPath(element);
                if (date && at) editor.tf.setNodes({ date: toIso(date) }, { at });
                setOpen(false);
              }}
            />
          </Suspense>
        </NodePopoverContent>
      </NodePopover>
      {props.children}
    </PlateElement>
  );
}
