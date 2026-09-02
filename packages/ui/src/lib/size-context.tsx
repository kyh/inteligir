// Vendored from Fluid Functionalism (github.com/mickadesign/fluid-functionalism), MIT.
import { createContext, useContext, type ReactNode } from "react";

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
  default: {
    variant: "default",
    control: "h-9",
    controlHeight: 36,
    segmentItem: "h-7",
    segmentPad: "p-1",
    text: "text-[13px]",
    px: "px-3",
    itemPx: "px-2",
    gap: "gap-2",
    icon: 16,
  },
  compact: {
    variant: "compact",
    control: "h-7",
    controlHeight: 28,
    segmentItem: "h-6",
    segmentPad: "p-0.5",
    text: "text-[12px]",
    px: "px-2.5",
    itemPx: "px-1.5",
    gap: "gap-1",
    icon: 14,
  },
} satisfies Record<SizeVariant, SizeClasses>;

const SizeContext = createContext<SizeVariant | null>(null);

function useSizeVariant(override?: SizeVariant | null): SizeVariant {
  const ctx = useContext(SizeContext);
  return override ?? ctx ?? "default";
}

function useSize(override?: SizeVariant | null): SizeClasses {
  return sizeMap[useSizeVariant(override)];
}

function SizeProvider({ children, size }: { children: ReactNode; size: SizeVariant }) {
  return <SizeContext.Provider value={size}>{children}</SizeContext.Provider>;
}

export { SizeProvider, useSize, useSizeVariant };
export type { SizeVariant };
