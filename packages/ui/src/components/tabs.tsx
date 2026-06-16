"use client";

import {
  useRef,
  useState,
  useCallback,
  useEffect,
  useLayoutEffect,
  createContext,
  useContext,
  forwardRef,
  Children,
  cloneElement,
  isValidElement,
  useMemo,
  type ComponentPropsWithoutRef,
  type ComponentType,
} from "react";
import { Tabs as TabsPrimitive } from "@base-ui/react/tabs";
import { motion, AnimatePresence } from "motion/react";
import { cn } from "@repo/ui/lib/utils";
import { springs } from "@repo/ui/lib/springs";
import { fontWeights } from "@repo/ui/lib/font-weight";
import { getShape } from "@repo/ui/lib/shape";
import { useOnGlass, useSurface } from "@repo/ui/lib/surface-context";
import { surfaceClasses } from "@repo/ui/lib/surface-classes";
import { useProximityHover } from "@repo/ui/hooks/use-proximity-hover";
import { useMergeRefs } from "@repo/ui/hooks/use-merge-refs";

/**
 * Icon component contract — matches the shape of a lucide-react icon (size +
 * strokeWidth props), so consumers can pass any lucide icon or their own
 * component with the same signature.
 */
type IconComponent = ComponentType<{
  size?: number;
  strokeWidth?: number;
  className?: string;
}>;

/* ─────────────────────── Contexts ─────────────────────── */

interface TabsValueOrderContextValue {
  valueOrder: string[];
  setValueOrder: (order: string[]) => void;
  selectedValue: string | undefined;
}

const TabsValueOrderContext = createContext<TabsValueOrderContextValue | null>(null);

interface TabsListContextValue {
  registerTab: (index: number, value: string, el: HTMLElement | null) => void;
  hoveredIndex: number | null;
  selectedValue: string | undefined;
  setOptimisticIdx: (index: number) => void;
}

const TabsListContext = createContext<TabsListContextValue | null>(null);

function useTabsList() {
  const ctx = useContext(TabsListContext);
  if (!ctx) throw new Error("TabItem must be used within a TabsList");
  return ctx;
}

/* ─────────────────────── Tabs (Root) ─────────────────────── */

interface TabsProps extends Omit<
  ComponentPropsWithoutRef<typeof TabsPrimitive.Root>,
  "onValueChange" | "value" | "defaultValue" | "onSelect"
> {
  value?: string | undefined;
  onValueChange?: ((value: string) => void) | undefined;
  selectedIndex?: number | undefined;
  onSelect?: ((index: number) => void) | undefined;
  defaultValue?: string | undefined;
}

const Tabs = forwardRef<HTMLDivElement, TabsProps>(
  ({ value, onValueChange, selectedIndex, onSelect, defaultValue, children, ...props }, ref) => {
    const [valueOrder, setValueOrder] = useState<string[]>([]);
    const [uncontrolledValue, setUncontrolledValue] = useState<string | undefined>(defaultValue);
    const updateValueOrder = useCallback((order: string[]) => {
      setValueOrder((current) => {
        if (current.length === order.length && current.every((v, i) => v === order[i])) {
          return current;
        }
        return order;
      });
    }, []);

    const resolvedValue =
      value ?? (selectedIndex != null ? valueOrder[selectedIndex] : uncontrolledValue);

    // Base UI types tab values as `any`; this wrapper constrains them to
    // strings (TabItemProps.value), so the param can be typed directly.
    const handleValueChange = useCallback(
      (newValue: string) => {
        if (value === undefined && selectedIndex == null) {
          setUncontrolledValue(newValue);
        }
        onValueChange?.(newValue);
        if (onSelect) {
          const idx = valueOrder.indexOf(newValue);
          if (idx !== -1) onSelect(idx);
        }
      },
      [onValueChange, onSelect, valueOrder, value, selectedIndex],
    );
    const contextValue = useMemo(
      () => ({
        valueOrder,
        setValueOrder: updateValueOrder,
        selectedValue: resolvedValue,
      }),
      [resolvedValue, updateValueOrder, valueOrder],
    );

    return (
      <TabsValueOrderContext.Provider value={contextValue}>
        <TabsPrimitive.Root
          ref={ref}
          value={resolvedValue}
          onValueChange={handleValueChange}
          defaultValue={resolvedValue == null ? defaultValue : undefined}
          {...props}
        >
          {children}
        </TabsPrimitive.Root>
      </TabsValueOrderContext.Provider>
    );
  },
);

Tabs.displayName = "Tabs";

/* ─────────────────────── TabsList ─────────────────────── */

type TabsListProps = ComponentPropsWithoutRef<typeof TabsPrimitive.List>;

const TabsList = forwardRef<HTMLDivElement, TabsListProps>(
  ({ children, className, ...props }, ref) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const isMouseInside = useRef(false);
    const shape = getShape();
    const substrate = useSurface();
    const indicatorLevel = Math.min(substrate + 3, 8);
    // On smoked glass the opaque ladder is invisible — track and indicators
    // swap to the translucent white glass-row recipe.
    const onGlass = useOnGlass();
    const valueOrderCtx = useContext(TabsValueOrderContext);
    const [optimisticIdx, setOptimisticIdx] = useState<number | null>(null);

    const values = useMemo(
      () =>
        Children.toArray(children)
          .filter(isValidElement)
          .map((child) => {
            const props: unknown = child.props;
            return typeof props === "object" && props !== null && "value" in props
              ? props.value
              : undefined;
          })
          .filter((v): v is string => typeof v === "string"),
      [children],
    );
    const setValueOrder = valueOrderCtx?.setValueOrder;

    useLayoutEffect(() => {
      setValueOrder?.(values);
    }, [setValueOrder, values]);

    const {
      activeIndex: hoveredIndex,
      setActiveIndex: setHoveredIndex,
      itemRects,
      handlers,
      registerItem,
      measureItems,
    } = useProximityHover(containerRef, { axis: "x" });

    const registerTab = useCallback(
      (index: number, _value: string, el: HTMLElement | null) => {
        registerItem(index, el);
      },
      [registerItem],
    );

    const mergedListRef = useMergeRefs<HTMLDivElement>(containerRef, ref);

    useEffect(() => {
      measureItems();
    }, [measureItems, children]);

    useEffect(() => {
      const el = containerRef.current;
      if (!el) return;
      const ro = new ResizeObserver(() => measureItems());
      ro.observe(el);
      return () => ro.disconnect();
    }, [measureItems]);

    const handleMouseMove = useCallback(
      (e: React.MouseEvent) => {
        isMouseInside.current = true;
        handlers.onMouseMove(e);
      },
      [handlers],
    );

    const handleMouseLeave = useCallback(() => {
      isMouseInside.current = false;
      handlers.onMouseLeave();
    }, [handlers]);

    const [focusedIndex, setFocusedIndex] = useState<number | null>(null);
    const selectedValue = valueOrderCtx?.selectedValue;
    const selectedIdx = selectedValue !== undefined ? values.indexOf(selectedValue) : -1;

    useEffect(() => {
      setOptimisticIdx(selectedIdx >= 0 ? selectedIdx : null);
    }, [selectedIdx]);

    const activeSelectedIdx = optimisticIdx;
    const selectedRect = activeSelectedIdx !== null ? itemRects[activeSelectedIdx] : null;
    const hoverRect = hoveredIndex !== null ? itemRects[hoveredIndex] : null;
    const focusRect = focusedIndex !== null ? itemRects[focusedIndex] : null;
    const isHoveringSelected = hoveredIndex === activeSelectedIdx;
    const isHovering = hoveredIndex !== null && !isHoveringSelected;

    const indexedChildren = Children.map(children, (child, i) => {
      if (isValidElement<{ _index?: number }>(child)) {
        return cloneElement(child, { _index: i });
      }
      return child;
    });
    const contextValue = useMemo(
      () => ({
        registerTab,
        hoveredIndex,
        selectedValue,
        setOptimisticIdx,
      }),
      [hoveredIndex, registerTab, selectedValue],
    );

    return (
      <TabsListContext.Provider value={contextValue}>
        <TabsPrimitive.List
          // Match Radix's `activationMode="automatic"` — arrow keys move + activate.
          activateOnFocus
          ref={mergedListRef}
          onMouseMove={handleMouseMove}
          onMouseLeave={handleMouseLeave}
          onFocus={(e) => {
            if (!(e.target instanceof HTMLElement)) return;
            const trigger = e.target.closest('[role="tab"]');
            if (!trigger) return;
            const indexAttr = trigger.getAttribute("data-proximity-index");
            if (indexAttr != null) {
              const idx = Number(indexAttr);
              setHoveredIndex(idx);
              setFocusedIndex(e.target.matches(":focus-visible") ? idx : null);
            }
          }}
          onBlur={(e) => {
            if (e.relatedTarget instanceof Node && containerRef.current?.contains(e.relatedTarget))
              return;
            setFocusedIndex(null);
            if (isMouseInside.current) return;
            setHoveredIndex(null);
          }}
          className={cn(
            "relative inline-flex items-center gap-0.5 p-1 select-none",
            onGlass ? "bg-glass-row" : "bg-muted",
            shape.container,
            className,
          )}
          {...props}
        >
          {/* Active segment indicator */}
          {selectedRect && (
            <motion.div
              className={cn(
                "absolute pointer-events-none",
                onGlass ? "bg-glass-row-active" : surfaceClasses(indicatorLevel),
                shape.bg,
              )}
              initial={false}
              animate={{
                left: selectedRect.left,
                width: selectedRect.width,
                top: selectedRect.top,
                height: selectedRect.height,
                opacity: isHovering ? 0.85 : 1,
              }}
              transition={{
                ...springs.moderate,
                opacity: { duration: 0.08 },
              }}
            />
          )}

          {/* Hover indicator */}
          <AnimatePresence>
            {hoverRect && !isHoveringSelected && selectedRect && (
              <motion.div
                className={cn(
                  "absolute pointer-events-none",
                  onGlass ? "bg-glass-row-hover" : "bg-hover",
                  shape.bg,
                )}
                initial={{
                  left: selectedRect.left,
                  width: selectedRect.width,
                  top: selectedRect.top,
                  height: selectedRect.height,
                  opacity: 0,
                }}
                animate={{
                  left: hoverRect.left,
                  width: hoverRect.width,
                  top: hoverRect.top,
                  height: hoverRect.height,
                  opacity: 0.4,
                }}
                exit={
                  !isMouseInside.current && selectedRect
                    ? {
                        left: selectedRect.left,
                        width: selectedRect.width,
                        top: selectedRect.top,
                        height: selectedRect.height,
                        opacity: 0,
                        transition: {
                          ...springs.moderate,
                          opacity: { duration: 0.06 },
                        },
                      }
                    : { opacity: 0, transition: { duration: 0.06 } }
                }
                transition={{
                  ...springs.fast,
                  opacity: { duration: 0.08 },
                }}
              />
            )}
          </AnimatePresence>

          {/* Focus ring */}
          <AnimatePresence>
            {focusRect && (
              <motion.div
                className={cn(
                  "absolute pointer-events-none z-20 border border-focus-ring",
                  shape.focusRing,
                )}
                initial={false}
                animate={{
                  left: focusRect.left - 2,
                  top: focusRect.top - 2,
                  width: focusRect.width + 4,
                  height: focusRect.height + 4,
                }}
                exit={{ opacity: 0, transition: { duration: 0.06 } }}
                transition={{
                  ...springs.fast,
                  opacity: { duration: 0.08 },
                }}
              />
            )}
          </AnimatePresence>

          {indexedChildren}
        </TabsPrimitive.List>
      </TabsListContext.Provider>
    );
  },
);

TabsList.displayName = "TabsList";

/* ─────────────────────── TabItem ─────────────────────── */

interface TabItemProps extends ComponentPropsWithoutRef<typeof TabsPrimitive.Tab> {
  value: string;
  icon?: IconComponent;
  label: string;
  /** @internal Auto-assigned by TabsList. */
  _index?: number;
}

const TabItem = forwardRef<HTMLButtonElement, TabItemProps>(
  ({ value, icon: Icon, label, _index = 0, className, ...props }, ref) => {
    const internalRef = useRef<HTMLButtonElement>(null);
    const { registerTab, hoveredIndex, selectedValue, setOptimisticIdx } = useTabsList();
    const onGlass = useOnGlass();
    const activeText = onGlass ? "text-glass-fg" : "text-foreground";
    const mutedText = onGlass ? "text-glass-fg-muted" : "text-muted-foreground";

    useEffect(() => {
      registerTab(_index, value, internalRef.current);
      return () => registerTab(_index, value, null);
    }, [_index, value, registerTab]);

    const isSelected = selectedValue === value;
    const isActive = hoveredIndex === _index || isSelected;
    const mergedTabRef = useMergeRefs<HTMLButtonElement>(internalRef, ref);

    return (
      <TabsPrimitive.Tab
        onClick={() => setOptimisticIdx(_index)}
        ref={mergedTabRef}
        value={value}
        data-proximity-index={_index}
        className={cn(
          "relative z-10 flex items-center gap-2 px-3 py-1.5 cursor-pointer bg-transparent border-none outline-none",
          className,
        )}
        {...props}
      >
        {Icon && (
          <Icon
            size={16}
            strokeWidth={isActive ? 2 : 1.5}
            className={cn(
              "transition-[color,stroke-width] duration-80",
              isActive ? activeText : mutedText,
            )}
          />
        )}
        <span className="inline-grid text-[13px] whitespace-nowrap">
          <span
            className="col-start-1 row-start-1 invisible"
            style={{ fontVariationSettings: fontWeights.semibold }}
            aria-hidden="true"
          >
            {label}
          </span>
          <span
            className={cn(
              "col-start-1 row-start-1 transition-[color,font-variation-settings] duration-80",
              isActive ? activeText : mutedText,
            )}
            style={{
              fontVariationSettings: isSelected ? fontWeights.semibold : fontWeights.normal,
            }}
          >
            {label}
          </span>
        </span>
      </TabsPrimitive.Tab>
    );
  },
);

TabItem.displayName = "TabItem";

/* ─────────────────────── TabPanel ─────────────────────── */

interface TabPanelProps extends ComponentPropsWithoutRef<typeof TabsPrimitive.Panel> {
  value: string;
}

const TabPanel = forwardRef<HTMLDivElement, TabPanelProps>(({ className, ...props }, ref) => {
  return <TabsPrimitive.Panel ref={ref} className={cn("outline-none", className)} {...props} />;
});

TabPanel.displayName = "TabPanel";

export { Tabs, TabsList, TabItem, TabPanel };
