// Vendored from Fluid Functionalism (github.com/mickadesign/fluid-functionalism), MIT.
import { createContext, useContext } from "react";
import type { ReactNode } from "react";

type SizeVariant = "default" | "compact";

interface SizeClasses {
  variant: SizeVariant;
  // one token for controls and menu rows: a popup row lines up with the trigger that opened it
  control: string;
  controlHeight: number;
  // segmentPad + segmentItem must add back up to the control height
  segmentItem: string;
  segmentPad: string;
  text: string;
  px: string;
  itemPx: string;
  gap: string;
  icon: number;
}

const sizeMap = {
  compact: {
    control: "h-7",
    controlHeight: 28,
    gap: "gap-1",
    icon: 14,
    itemPx: "px-1.5",
    px: "px-2.5",
    segmentItem: "h-6",
    segmentPad: "p-0.5",
    text: "text-[12px]",
    variant: "compact",
  },
  default: {
    control: "h-9",
    controlHeight: 36,
    gap: "gap-2",
    icon: 16,
    itemPx: "px-2",
    px: "px-3",
    segmentItem: "h-7",
    segmentPad: "p-1",
    text: "text-[13px]",
    variant: "default",
  },
} satisfies Record<SizeVariant, SizeClasses>;

// Type follows the ladder: the compact column steps each role down one notch, so a dense screen
// keeps the same hierarchy at a smaller size rather than a squeezed copy. `body` is what a sized
// control already renders (`SizeClasses.text`); `display` and `title` are the page-level roles.
// Listed alphabetically, not by size: the roles, smallest to largest, are caption, body,
// subtitle, title, display. The product draws them through the `text-*` utilities derived from
// the compact column; this is where that column is declared.
const typeScale = {
  // control labels and body copy
  body: { compact: 12, default: 13 },
  // secondary text: descriptions, meta rows, errors, group labels
  caption: { compact: 11, default: 12 },
  // page titles
  display: { compact: 24, default: 28 },
  // card titles, emphasized rows
  subtitle: { compact: 13, default: 14 },
  // section headings, dialog titles
  title: { compact: 15, default: 16 },
} satisfies Record<string, Record<SizeVariant, number>>;

const SizeContext = createContext<SizeVariant | null>(null);

const useSizeVariant = (override?: SizeVariant | null): SizeVariant => {
  const ctx = useContext(SizeContext);
  return override ?? ctx ?? "default";
};

const useSize = (override?: SizeVariant | null): SizeClasses => sizeMap[useSizeVariant(override)];

const SizeProvider = ({ children, size }: { children: ReactNode; size: SizeVariant }) => (
  <SizeContext.Provider value={size}>{children}</SizeContext.Provider>
);

export { SizeProvider, typeScale, useSize, useSizeVariant };
export type { SizeVariant };
