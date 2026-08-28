"use client";
// Vendored from Fluid Functionalism (github.com/mickadesign/fluid-functionalism), MIT.

import {
  createContext,
  forwardRef,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type HTMLAttributes,
  type ReactNode,
} from "react";
import { Checkbox as CheckboxPrimitive } from "@base-ui/react/checkbox";
import { AnimatePresence, motion } from "framer-motion";

import { SelectionBackgrounds, useMergeSplitBlocks } from "@repo/ui/hooks/use-merge-split";
import { useProximityHover } from "@repo/ui/hooks/use-proximity-hover";
import { fontWeights } from "@repo/ui/lib/font-weight";
import { useRadius } from "@repo/ui/lib/radius-context";
import { SizeProvider, useSize, type SizeVariant } from "@repo/ui/lib/size-context";
import { spring } from "@repo/ui/lib/springs";
import { cn } from "@repo/ui/lib/utils";

function CheckMark({ compact }: { compact: boolean }) {
  return (
    <motion.svg
      width={compact ? 16 : 18}
      height={compact ? 16 : 18}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-foreground"
      initial={{ opacity: 1 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 1 }}
    >
      <motion.path
        d="M6 12L10 16L18 8"
        initial={{ pathLength: 0 }}
        animate={{ pathLength: 1, transition: { duration: 0.08, ease: "easeOut" } }}
        exit={{ pathLength: 0, transition: { duration: 0.04, ease: "easeIn" } }}
      />
    </motion.svg>
  );
}

// keepMounted holds the span through the exit so the un-draw is visible;
// AnimatePresence initial={false} skips the draw for a box that mounts
// already checked.
function CheckIndicator({ compact }: { compact: boolean }) {
  return (
    <CheckboxPrimitive.Indicator
      keepMounted
      data-slot="checkbox-indicator"
      render={(indicatorProps, state) => (
        <span {...indicatorProps}>
          <AnimatePresence initial={false}>
            {state.checked && <CheckMark compact={compact} />}
          </AnimatePresence>
        </span>
      )}
    />
  );
}

type CheckboxProps = CheckboxPrimitive.Root.Props & {
  /** Pins the checkbox to one step of the size ladder. Omitted, it follows
   *  the surrounding SizeProvider. */
  size?: SizeVariant;
};

// Unlike CheckboxItem's square, the checked state keeps its border: standalone
// there is no selection background behind it to carry the boundary.
function Checkbox({ className, size, ...props }: CheckboxProps) {
  const compact = useSize(size).variant === "compact";
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      className={cn(
        "relative shrink-0 cursor-pointer appearance-none bg-transparent p-0 outline-none",
        "border-[1.5px] border-solid border-border transition-colors duration-80",
        "hover:border-neutral-400 dark:hover:border-neutral-500",
        // Invisible ::after padding widens the small square's hit target.
        "after:absolute after:-inset-x-3 after:-inset-y-2",
        "focus-visible:ring-1 focus-visible:ring-[color:var(--focus-ring,#6B97FF)] focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        "data-disabled:pointer-events-none data-disabled:opacity-50",
        compact ? "h-[14px] w-[14px] rounded-[4px]" : "h-[16px] w-[16px] rounded-[5px]",
        className,
      )}
      {...props}
    >
      <CheckIndicator compact={compact} />
    </CheckboxPrimitive.Root>
  );
}

interface CheckboxGroupContextValue {
  registerItem: (index: number, element: HTMLElement | null) => void;
  activeIndex: number | null;
}

const CheckboxGroupContext = createContext<CheckboxGroupContextValue | null>(null);

function useCheckboxGroup() {
  const ctx = useContext(CheckboxGroupContext);
  if (!ctx) throw new Error("useCheckboxGroup must be used within a CheckboxGroup");
  return ctx;
}

interface CheckboxGroupProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  checkedIndices: Set<number>;
  /** Pins the group's rows to one step of the size ladder. Omitted, they
   *  follow the surrounding SizeProvider. */
  size?: SizeVariant;
}

const CheckboxGroup = forwardRef<HTMLDivElement, CheckboxGroupProps>(
  ({ children, checkedIndices, size, className, ...props }, ref) => {
    const containerRef = useRef<HTMLDivElement | null>(null);
    const groupIdCounter = useRef(0);
    const prevGroupMap = useRef(new Map<number, number>());

    const {
      activeIndex,
      setActiveIndex,
      itemRects,
      sessionRef,
      handlers,
      registerItem,
      measureItems,
    } = useProximityHover(containerRef);

    // children is a deliberate dep: rows changing is what invalidates rects.
    useEffect(() => {
      measureItems();
    }, [measureItems, children]);

    // Group contiguous checked indices into runs with stable IDs
    const runs: { start: number; end: number }[] = [];
    const sortedChecked = [...checkedIndices].toSorted((a, b) => a - b);
    for (const idx of sortedChecked) {
      const last = runs[runs.length - 1];
      if (last && idx === last.end + 1) {
        last.end = idx;
      } else {
        runs.push({ start: idx, end: idx });
      }
    }

    // Assign stable IDs: reuse previous ID if any member overlaps
    const usedIds = new Set<number>();
    const newGroupMap = new Map<number, number>();
    const checkedGroups = runs.map((run) => {
      let stableId: number | null = null;
      for (let i = run.start; i <= run.end; i++) {
        const prevId = prevGroupMap.current.get(i);
        if (prevId !== undefined && !usedIds.has(prevId)) {
          stableId = prevId;
          break;
        }
      }
      const id = stableId ?? ++groupIdCounter.current;
      usedIds.add(id);
      for (let i = run.start; i <= run.end; i++) {
        newGroupMap.set(i, id);
      }
      return { start: run.start, end: run.end, id };
    });
    prevGroupMap.current = newGroupMap;

    const [focusedIndex, setFocusedIndex] = useState<number | null>(null);

    const groupContextValue = useMemo(
      () => ({ registerItem, activeIndex }),
      [registerItem, activeIndex],
    );

    const activeRect = activeIndex !== null ? (itemRects[activeIndex] ?? null) : null;
    const focusRect = focusedIndex !== null ? (itemRects[focusedIndex] ?? null) : null;
    const radius = useRadius();

    // Selected backgrounds, with the merge/split boundary animation when one
    // unchecked row bridges or splits two checked runs.
    const blocks = useMergeSplitBlocks(checkedGroups, itemRects, radius.mergedRadius);

    const group = (
      <CheckboxGroupContext.Provider value={groupContextValue}>
        <div
          ref={(node) => {
            containerRef.current = node;
            if (ref instanceof Function) ref(node);
            else if (ref) ref.current = node;
          }}
          onMouseEnter={handlers.onMouseEnter}
          onMouseMove={handlers.onMouseMove}
          onMouseLeave={handlers.onMouseLeave}
          onFocus={(e) => {
            const indexAttr = e.target
              .closest("[data-proximity-index]")
              ?.getAttribute("data-proximity-index");
            if (indexAttr != null) {
              const idx = Number(indexAttr);
              setActiveIndex(idx);
              setFocusedIndex(e.target.matches(":focus-visible") ? idx : null);
            }
          }}
          onBlur={(e) => {
            // Don't clear hover when focus moves to another item within the group
            if (containerRef.current?.contains(e.relatedTarget)) return;
            setFocusedIndex(null);
            setActiveIndex(null);
          }}
          onKeyDown={(e) => {
            // Scope to row wrappers only. The inner checkbox primitive also
            // carries role="checkbox", so a bare [role="checkbox"] selector
            // matches twice per row and arrows skip onto the hidden control.
            const items = Array.from(
              containerRef.current?.querySelectorAll<HTMLElement>("[data-proximity-index]") ?? [],
            );
            if (!(e.target instanceof HTMLElement)) return;
            const currentIdx = items.indexOf(e.target);
            if (currentIdx === -1) return;

            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
              e.preventDefault();
              const next =
                e.key === "ArrowDown"
                  ? (currentIdx + 1) % items.length
                  : (currentIdx - 1 + items.length) % items.length;
              items[next]?.focus();
            } else if (e.key === "Home") {
              e.preventDefault();
              items[0]?.focus();
            } else if (e.key === "End") {
              e.preventDefault();
              items[items.length - 1]?.focus();
            }
          }}
          role="group"
          className={cn("relative flex flex-col w-72 max-w-full select-none", className)}
          {...props}
        >
          {/* Selected backgrounds (merged for contiguous checked items).
              A run is normally one block; mid merge/split it is drawn as two
              abutting halves — see useMergeSplitBlocks. */}
          <SelectionBackgrounds blocks={blocks} />

          {/* Hover background */}
          <AnimatePresence>
            {activeRect && (
              <motion.div
                key={sessionRef.current}
                className={`absolute ${radius.bg} bg-hover pointer-events-none`}
                initial={{
                  opacity: 0,
                  top: activeRect.top,
                  left: activeRect.left,
                  width: activeRect.width,
                  height: activeRect.height,
                }}
                animate={{
                  opacity: 1,
                  top: activeRect.top,
                  left: activeRect.left,
                  width: activeRect.width,
                  height: activeRect.height,
                }}
                exit={{ opacity: 0, transition: spring.fast.exit }}
                transition={{
                  ...spring.fast,
                  opacity: { duration: 0.08 },
                }}
              />
            )}
          </AnimatePresence>

          {/* Focus ring */}
          <AnimatePresence>
            {focusRect && (
              <motion.div
                className={`absolute ${radius.focusRing} pointer-events-none z-20 border border-[color:var(--focus-ring,#6B97FF)]`}
                initial={false}
                animate={{
                  left: focusRect.left - 2,
                  top: focusRect.top - 2,
                  width: focusRect.width + 4,
                  height: focusRect.height + 4,
                }}
                exit={{ opacity: 0, transition: spring.fast.exit }}
                transition={{
                  ...spring.fast,
                  opacity: { duration: 0.08 },
                }}
              />
            )}
          </AnimatePresence>

          {children}
        </div>
      </CheckboxGroupContext.Provider>
    );

    // A size prop pins every row in the group to one ladder step.
    return size ? <SizeProvider size={size}>{group}</SizeProvider> : group;
  },
);

CheckboxGroup.displayName = "CheckboxGroup";

interface CheckboxItemProps extends HTMLAttributes<HTMLDivElement> {
  label: string;
  index: number;
  checked: boolean;
  onToggle: () => void;
}

const CheckboxItem = forwardRef<HTMLDivElement, CheckboxItemProps>(
  ({ label, index, checked, onToggle, className, ...props }, ref) => {
    const internalRef = useRef<HTMLDivElement | null>(null);
    const { registerItem, activeIndex } = useCheckboxGroup();

    useEffect(() => {
      registerItem(index, internalRef.current);
      return () => registerItem(index, null);
    }, [index, registerItem]);

    const isActive = activeIndex === index;
    const radius = useRadius();
    const sizeClasses = useSize();
    const compact = sizeClasses.variant === "compact";

    return (
      <div
        ref={(node) => {
          internalRef.current = node;
          if (ref instanceof Function) ref(node);
          else if (ref) ref.current = node;
        }}
        data-proximity-index={index}
        tabIndex={0}
        role="checkbox"
        aria-checked={checked}
        aria-label={label}
        onClick={onToggle}
        onMouseDown={(e) => {
          // Clicking the checkbox square would natively focus the hidden
          // primitive (nearest focusable ancestor of the click target), after
          // which arrow-key nav dead-zones: the group keydown handler can't
          // find the target among the row wrappers. Prevent the native focus
          // move (click still fires) and land focus on the row instead. Skip
          // genuinely interactive children so we don't hijack their focus.
          if (e.target instanceof Element) {
            const interactive = e.target.closest(
              'button:not([tabindex="-1"]), a[href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
            );
            if (interactive && interactive !== e.currentTarget) return;
          }
          e.preventDefault();
          e.currentTarget.focus();
        }}
        onKeyDown={(e) => {
          if (e.key === " " || e.key === "Enter") {
            e.preventDefault();
            onToggle();
          }
        }}
        className={cn(
          // Fixed height so the text-box trim on the label doesn't shrink the row.
          `relative z-10 flex ${sizeClasses.control} items-center ${sizeClasses.gap} ${radius.item} ${sizeClasses.px} cursor-pointer outline-none`,
          className,
        )}
        {...props}
      >
        {/* Checkbox — Base UI primitive for accessibility */}
        <CheckboxPrimitive.Root
          checked={checked}
          onCheckedChange={() => onToggle()}
          tabIndex={-1}
          aria-hidden
          className={cn(
            "relative shrink-0 appearance-none bg-transparent p-0 border-0 outline-none cursor-pointer",
            compact ? "w-[14px] h-[14px]" : "w-[16px] h-[16px]",
          )}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Border */}
          <div
            className={cn(
              "absolute inset-0 border-solid transition-all duration-80",
              compact ? "rounded-[4px]" : "rounded-[5px]",
              checked
                ? "border-[1.5px] border-transparent"
                : isActive
                  ? "border-[1.5px] border-neutral-400 dark:border-neutral-500"
                  : "border-[1.5px] border-border",
            )}
          />
          <CheckIndicator compact={compact} />
        </CheckboxPrimitive.Root>

        {/* Label */}
        {/* Both stacked spans carry the text-box trim so the invisible bold
            sizer and the visible label keep identical boxes. */}
        <span className={cn("inline-grid", sizeClasses.text)}>
          <span
            className="col-start-1 row-start-1 invisible [text-box:trim-both_cap_alphabetic]"
            style={{ fontVariationSettings: fontWeights.semibold }}
            aria-hidden="true"
          >
            {label}
          </span>
          <span
            className={cn(
              "col-start-1 row-start-1 transition-[color,font-variation-settings] duration-80 [text-box:trim-both_cap_alphabetic]",
              checked || isActive ? "text-foreground" : "text-muted-foreground",
            )}
            style={{
              fontVariationSettings: checked ? fontWeights.semibold : fontWeights.normal,
            }}
          >
            {label}
          </span>
        </span>
      </div>
    );
  },
);

CheckboxItem.displayName = "CheckboxItem";

export { Checkbox, CheckboxGroup, CheckboxItem };
export type { CheckboxProps, CheckboxGroupProps, CheckboxItemProps };
