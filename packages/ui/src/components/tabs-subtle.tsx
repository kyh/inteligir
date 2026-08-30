"use client";
// Vendored from Fluid Functionalism (github.com/mickadesign/fluid-functionalism), MIT.

import {
  useRef,
  useState,
  useCallback,
  useEffect,
  useMemo,
  createContext,
  useContext,
  forwardRef,
  type ReactNode,
  type HTMLAttributes,
} from "react";
import { Tabs } from "@base-ui/react/tabs";
import { motion, AnimatePresence } from "framer-motion";
import type { IconComponent } from "@repo/ui/lib/icon-context";
import { cn } from "@repo/ui/lib/utils";
import { spring } from "@repo/ui/lib/springs";
import { fontWeights } from "@repo/ui/lib/font-weight";
import { useRadius } from "@repo/ui/lib/radius-context";
import { SizeProvider, useSize, type SizeVariant } from "@repo/ui/lib/size-context";
import { useProximityHover } from "@repo/ui/hooks/use-proximity-hover";

/** Base UI leaves a tab's value untyped. Every tab here carries its own index,
 *  and Base UI answers `null` when no tab is active — that is the whole domain,
 *  named once so both ends of the Base UI boundary agree on it. */
type TabValue = number | null;

interface TabsSubtleContextValue {
  registerTab: (index: number, element: HTMLElement | null) => void;
  hoveredIndex: number | null;
  selectedIndex: number;
  idPrefix: string | undefined;
  activeLabel: boolean;
}

const TabsSubtleContext = createContext<TabsSubtleContextValue | null>(null);

function useTabsSubtle() {
  const ctx = useContext(TabsSubtleContext);
  if (!ctx) throw new Error("useTabsSubtle must be used within a TabsSubtle");
  return ctx;
}

interface TabsSubtleProps extends Omit<HTMLAttributes<HTMLDivElement>, "onSelect"> {
  children: ReactNode;
  selectedIndex: number;
  onSelect: (index: number) => void;
  idPrefix?: string;
  /** When true, only the selected tab shows its text label. Requires icons on tabs. */
  activeLabel?: boolean;
  /** Pins the tabs to one step of the size ladder (default 36px, compact
   *  28px — see /docs/sizes). Omitted, they follow the surrounding
   *  SizeProvider. */
  size?: SizeVariant;
}

const TabsSubtle = forwardRef<HTMLDivElement, TabsSubtleProps>(
  (
    { children, selectedIndex, onSelect, idPrefix, activeLabel = false, size, className, ...props },
    ref,
  ) => {
    const containerRef = useRef<HTMLDivElement>(null);
    // State rather than a ref: the hover pill's `exit` is chosen during render
    // from whether the pointer is still over the strip.
    const [isMouseInside, setIsMouseInside] = useState(false);
    const radius = useRadius();

    const {
      activeIndex: hoveredIndex,
      setActiveIndex: setHoveredIndex,
      itemRects: tabRects,
      handlers,
      registerItem,
      measureItems: measureTabs,
    } = useProximityHover(containerRef, { axis: "x" });

    // Track tab elements locally so we can observe their individual resizes.
    // State rather than a ref because the observer effect below is rebuilt from
    // this map — a ref would give it nothing to depend on.
    const [tabElements, setTabElements] = useState<ReadonlyMap<number, HTMLElement>>(new Map());
    const registerTab = useCallback(
      (index: number, element: HTMLElement | null) => {
        registerItem(index, element);
        setTabElements((prev) => {
          const next = new Map(prev);
          if (element) next.set(index, element);
          else next.delete(index);
          return next;
        });
      },
      [registerItem],
    );

    // Observe individual tab buttons for resize (label expand/collapse in activeLabel mode)
    useEffect(() => {
      if (tabElements.size === 0) return;
      const ro = new ResizeObserver(() => measureTabs());
      tabElements.forEach((el) => ro.observe(el));
      return () => ro.disconnect();
    }, [measureTabs, tabElements]);

    // Wrap handlers to track isMouseInside
    const handleMouseMove = useCallback(
      (e: React.MouseEvent) => {
        setIsMouseInside(true);
        handlers.onMouseMove(e);
      },
      [handlers],
    );

    const handleMouseLeave = useCallback(() => {
      setIsMouseInside(false);
      handlers.onMouseLeave();
    }, [handlers]);

    const [focusedIndex, setFocusedIndex] = useState<number | null>(null);

    const selectedRect = tabRects[selectedIndex];
    const hoverRect = hoveredIndex !== null ? tabRects[hoveredIndex] : null;
    const focusRect = focusedIndex !== null ? tabRects[focusedIndex] : null;
    const isHoveringSelected = hoveredIndex === selectedIndex;
    const isHovering = hoveredIndex !== null && !isHoveringSelected;

    const contextValue = useMemo<TabsSubtleContextValue>(
      () => ({ registerTab, hoveredIndex, selectedIndex, idPrefix, activeLabel }),
      [registerTab, hoveredIndex, selectedIndex, idPrefix, activeLabel],
    );

    const selectTab = useCallback(
      (value: TabValue) => {
        if (value !== null) onSelect(value);
      },
      [onSelect],
    );

    const root = (
      <TabsSubtleContext.Provider value={contextValue}>
        {/* Root is merged into List via `render` so a single <div> is emitted,
            matching the previous DOM structure. Base UI owns role="tablist",
            roving tabindex, and Arrow/Home/End keyboard navigation.
            `activateOnFocus={false}` keeps manual activation: arrows move
            focus, Enter/Space selects. */}
        <Tabs.Root
          value={selectedIndex}
          onValueChange={selectTab}
          render={
            <Tabs.List
              activateOnFocus={false}
              ref={(node: HTMLDivElement | null) => {
                containerRef.current = node;
                if (ref instanceof Function) ref(node);
                else if (ref) ref.current = node;
              }}
              onMouseMove={handleMouseMove}
              onMouseLeave={handleMouseLeave}
              onFocus={(e: React.FocusEvent<HTMLDivElement>) => {
                const indexAttr = (e.target instanceof HTMLElement ? e.target : null)
                  ?.closest("[data-proximity-index]")
                  ?.getAttribute("data-proximity-index");
                if (indexAttr != null) {
                  const idx = Number(indexAttr);
                  setHoveredIndex(idx);
                  setFocusedIndex(
                    e.target instanceof HTMLElement && e.target.matches(":focus-visible")
                      ? idx
                      : null,
                  );
                }
              }}
              onBlur={(e: React.FocusEvent<HTMLDivElement>) => {
                if (
                  e.relatedTarget instanceof Node &&
                  containerRef.current?.contains(e.relatedTarget)
                )
                  return;
                setFocusedIndex(null);
                if (isMouseInside) return;
                setHoveredIndex(null);
              }}
              className={cn(
                // -mx-1 px-1 / -my-1 py-1 give the 2px-outset focus ring room
                // to draw without being clipped by overflow-x-auto. The
                // max-width allows for the negative margins: fit-content
                // parents size against the margin box (8px narrower than the
                // border box), so a plain max-w-full would clamp the list 8px
                // too small and clip the first/last tab's ring.
                "relative flex items-center gap-0.5 select-none overflow-x-auto max-w-[calc(100%_+_8px)] scrollbar-hide -mx-1 px-1 -my-1 py-1",
                className,
              )}
              {...props}
            >
              {/* Selected pill */}
              {selectedRect && (
                <motion.div
                  className={cn("absolute bg-active pointer-events-none", radius.bg)}
                  initial={false}
                  animate={{
                    left: selectedRect.left,
                    width: selectedRect.width,
                    top: selectedRect.top,
                    height: selectedRect.height,
                    opacity: isHovering ? 0.8 : 1,
                  }}
                  transition={{
                    ...spring.moderate,
                    opacity: { duration: 0.08 },
                  }}
                />
              )}

              {/* Hover pill */}
              <AnimatePresence>
                {hoverRect && !isHoveringSelected && selectedRect && (
                  <motion.div
                    className={cn("absolute bg-active pointer-events-none", radius.bg)}
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
                      !isMouseInside && selectedRect
                        ? {
                            left: selectedRect.left,
                            width: selectedRect.width,
                            top: selectedRect.top,
                            height: selectedRect.height,
                            opacity: 0,
                            transition: { ...spring.moderate, opacity: { duration: 0.06 } },
                          }
                        : { opacity: 0, transition: spring.fast.exit }
                    }
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
                    className={cn(
                      "absolute pointer-events-none z-20 border border-[color:var(--focus-ring,#6B97FF)]",
                      radius.focusRing,
                    )}
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
            </Tabs.List>
          }
        />
      </TabsSubtleContext.Provider>
    );

    // A size prop pins every tab to one ladder step.
    return size ? <SizeProvider size={size}>{root}</SizeProvider> : root;
  },
);

TabsSubtle.displayName = "TabsSubtle";

interface TabsSubtleItemProps extends HTMLAttributes<HTMLButtonElement> {
  icon?: IconComponent;
  label: string;
  index: number;
}

const TabsSubtleItem = forwardRef<HTMLButtonElement, TabsSubtleItemProps>(
  ({ icon: Icon, label, index, className, ...props }, ref) => {
    const internalRef = useRef<HTMLButtonElement | null>(null);
    // The collapsing label animates to a MEASURED layout width, not "auto":
    // framer resolves an "auto" target from the element's *visual*
    // (transformed) size, so under a scaled ancestor (e.g. /demo's card) the
    // spring overshoots to scale-x the real width and snaps when "auto"
    // lands. offsetWidth and ResizeObserver are transform-immune — same
    // setup as the accordions' height animation.
    const [labelWidth, setLabelWidth] = useState<number | null>(null);
    const labelRoRef = useRef<ResizeObserver | null>(null);
    const measureLabel = useCallback((el: HTMLSpanElement | null) => {
      labelRoRef.current?.disconnect();
      labelRoRef.current = null;
      if (!el) return;
      const update = () => setLabelWidth(el.offsetWidth);
      update();
      labelRoRef.current = new ResizeObserver(update);
      labelRoRef.current.observe(el);
    }, []);
    const radius = useRadius();
    const sizeClasses = useSize();
    const { registerTab, hoveredIndex, selectedIndex, idPrefix, activeLabel } = useTabsSubtle();

    useEffect(() => {
      registerTab(index, internalRef.current);
      return () => registerTab(index, null);
    }, [index, registerTab]);

    const isSelected = selectedIndex === index;
    const isActive = hoveredIndex === index || isSelected;
    const collapseLabel = activeLabel && !!Icon;
    const showLabel = !collapseLabel || isSelected;

    const labelContent = (
      // Both stacked spans carry the text-box trim so the invisible bold
      // sizer and the visible label keep identical boxes.
      <span ref={measureLabel} className={cn("inline-grid whitespace-nowrap", sizeClasses.text)}>
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
            isActive ? "text-foreground" : "text-muted-foreground",
          )}
          style={{
            fontVariationSettings: isSelected ? fontWeights.semibold : fontWeights.normal,
          }}
        >
          {label}
        </span>
      </span>
    );

    return (
      // Base UI Tab renders a native <button type="button"> and wires
      // role="tab", aria-selected, roving tabindex, and activation for us.
      // id/aria-controls are only overridden when an idPrefix is supplied so
      // externally rendered TabsSubtlePanel elements stay linked.
      <Tabs.Tab
        ref={(node: HTMLElement | null) => {
          const button = node instanceof HTMLButtonElement ? node : null;
          internalRef.current = button;
          if (ref instanceof Function) ref(button);
          else if (ref) ref.current = button;
        }}
        value={index}
        data-proximity-index={index}
        id={idPrefix ? `${idPrefix}-tab-${index}` : undefined}
        aria-controls={idPrefix ? `${idPrefix}-panel-${index}` : undefined}
        aria-label={collapseLabel && !showLabel ? label : undefined}
        className={cn(
          // Fixed heights (was py-2 around a 19.5px line box ≈ 35.5px) so the
          // text-box trim on the label doesn't shrink the tab. Standalone
          // pills sit directly on the ladder's control height.
          "relative z-10 flex items-center cursor-pointer bg-transparent border-none outline-none",
          sizeClasses.control,
          sizeClasses.px,
          !collapseLabel && sizeClasses.gap,
          radius.bg,
          className,
        )}
        {...props}
      >
        {Icon && (
          <Icon
            size={sizeClasses.icon}
            strokeWidth={isActive ? 2 : 1.5}
            className={cn(
              "shrink-0 transition-[color,stroke-width] duration-80",
              isActive ? "text-foreground" : "text-muted-foreground",
            )}
          />
        )}
        {collapseLabel ? (
          <AnimatePresence initial={false}>
            {showLabel && (
              <motion.span
                key="label"
                className="overflow-hidden"
                // Until the measurement lands, let CSS resolve the width
                // instead of handing framer "auto": framer resolves an "auto"
                // target from the element's *visual* size, so under a scaled
                // ancestor (the /demo card, ~1.76x) it writes back a layout
                // width that much too wide, then springs back down when the
                // measured value arrives — the selected tab visibly pulses on
                // arrival. Plain CSS auto is the true layout width, and the
                // measured number that follows matches it exactly.
                style={labelWidth == null ? { width: "auto" } : {}}
                initial={{ width: 0, opacity: 0, marginLeft: 0 }}
                animate={{
                  ...(labelWidth != null ? { width: labelWidth } : null),
                  opacity: 1,
                  // Matches the ladder's icon-to-label gap (gap-2 / gap-1.5).
                  marginLeft: sizeClasses.variant === "compact" ? 6 : 8,
                }}
                exit={{ width: 0, opacity: 0, marginLeft: 0 }}
                transition={{
                  ...spring.fast,
                  opacity: { duration: 0.06 },
                }}
              >
                {labelContent}
              </motion.span>
            )}
          </AnimatePresence>
        ) : (
          labelContent
        )}
      </Tabs.Tab>
    );
  },
);

TabsSubtleItem.displayName = "TabsSubtleItem";

interface TabsSubtlePanelProps extends HTMLAttributes<HTMLDivElement> {
  index: number;
  selectedIndex: number;
  idPrefix: string;
  children: ReactNode;
}

// Rendered outside <TabsSubtle> at every call site, so it cannot use Base UI's
// Tabs.Panel (which requires the Tabs.Root context). It stays a plain tabpanel
// linked to its tab through the shared idPrefix.
const TabsSubtlePanel = forwardRef<HTMLDivElement, TabsSubtlePanelProps>(
  ({ index, selectedIndex, idPrefix, children, className, ...props }, ref) => {
    const isSelected = selectedIndex === index;

    return (
      <div
        ref={ref}
        id={`${idPrefix}-panel-${index}`}
        role="tabpanel"
        aria-labelledby={`${idPrefix}-tab-${index}`}
        hidden={!isSelected}
        tabIndex={-1}
        className={cn("outline-none", className)}
        {...props}
      >
        {isSelected && children}
      </div>
    );
  },
);

TabsSubtlePanel.displayName = "TabsSubtlePanel";

export { TabsSubtle, TabsSubtleItem, TabsSubtlePanel };
export default TabsSubtle;
