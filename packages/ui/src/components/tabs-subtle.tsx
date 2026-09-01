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
import { composeRefs } from "@repo/ui/lib/compose-refs";
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
  /** Pins the tabs to one step of the size ladder (default 36px, compact
   *  28px). Omitted, they follow the surrounding SizeProvider. */
  size?: SizeVariant;
}

const TabsSubtle = forwardRef<HTMLDivElement, TabsSubtleProps>(
  ({ children, selectedIndex, onSelect, size, className, ...props }, ref) => {
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
      registerItem: registerTab,
    } = useProximityHover(containerRef, { axis: "x" });

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
      () => ({ registerTab, hoveredIndex, selectedIndex }),
      [registerTab, hoveredIndex, selectedIndex],
    );

    const selectTab = useCallback(
      (value: TabValue) => {
        if (value !== null) onSelect(value);
      },
      [onSelect],
    );

    // Root is merged into List via `render` so a single <div> is emitted.
    // Base UI owns role="tablist", roving tabindex, and Arrow/Home/End
    // keyboard navigation. `activateOnFocus={false}` keeps manual activation:
    // arrows move focus, Enter/Space selects.
    const root = (
      <TabsSubtleContext.Provider value={contextValue}>
        <Tabs.Root
          value={selectedIndex}
          onValueChange={selectTab}
          render={
            <Tabs.List
              activateOnFocus={false}
              ref={composeRefs<HTMLDivElement>(containerRef, ref)}
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
                "relative flex items-center gap-0.5 select-none overflow-x-auto max-w-[calc(100%_+_8px)] -mx-1 px-1 -my-1 py-1",
                className,
              )}
              {...props}
            >
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
    const radius = useRadius();
    const sizeClasses = useSize();
    const { registerTab, hoveredIndex, selectedIndex } = useTabsSubtle();

    useEffect(() => {
      registerTab(index, internalRef.current);
      return () => registerTab(index, null);
    }, [index, registerTab]);

    const isSelected = selectedIndex === index;
    const isActive = hoveredIndex === index || isSelected;

    // Both stacked spans carry the text-box trim so the invisible bold sizer
    // and the visible label keep identical boxes.
    return (
      // Base UI Tab renders a native <button type="button"> and wires
      // role="tab", aria-selected, roving tabindex, and activation for us.
      <Tabs.Tab
        ref={(node: HTMLElement | null) =>
          composeRefs<HTMLButtonElement>(
            internalRef,
            ref,
          )(node instanceof HTMLButtonElement ? node : null)
        }
        value={index}
        data-proximity-index={index}
        className={cn(
          // Fixed heights (was py-2 around a 19.5px line box ≈ 35.5px) so the
          // text-box trim on the label doesn't shrink the tab. Standalone
          // pills sit directly on the ladder's control height.
          "relative z-10 flex items-center cursor-pointer bg-transparent border-none outline-none",
          sizeClasses.control,
          sizeClasses.px,
          sizeClasses.gap,
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
        <span className={cn("inline-grid whitespace-nowrap", sizeClasses.text)}>
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
      </Tabs.Tab>
    );
  },
);

TabsSubtleItem.displayName = "TabsSubtleItem";

export { TabsSubtle, TabsSubtleItem };
