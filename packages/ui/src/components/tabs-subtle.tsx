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
import type { IconComponent } from "@repo/ui/lib/icon";
import { cn } from "@repo/ui/lib/utils";
import { composeRefs } from "@repo/ui/lib/compose-refs";
import { spring } from "@repo/ui/lib/springs";
import { fontWeights } from "@repo/ui/lib/font-weight";
import { useRadius } from "@repo/ui/lib/radius-context";
import { SizeProvider, useSize, type SizeVariant } from "@repo/ui/lib/size-context";
import { ProximityFocusRing } from "@repo/ui/hooks/proximity-overlays";
import { useProximityHover } from "@repo/ui/hooks/use-proximity-hover";

// Base UI leaves the value untyped and answers null when no tab is active
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
  size?: SizeVariant;
}

const TabsSubtle = forwardRef<HTMLDivElement, TabsSubtleProps>(
  ({ children, selectedIndex, onSelect, size, className, ...props }, ref) => {
    const containerRef = useRef<HTMLDivElement>(null);
    // state, not a ref: the hover pill's `exit` is chosen during render from this
    const [isMouseInside, setIsMouseInside] = useState(false);
    const radius = useRadius();

    const {
      activeIndex: hoveredIndex,
      setActiveIndex: setHoveredIndex,
      itemRects: tabRects,
      handlers,
      registerItem: registerTab,
    } = useProximityHover(containerRef, { axis: "x" });

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
                // -m-1/p-1 give the focus ring room inside overflow-x-auto; fit-content parents
                // size against the margin box, so a plain max-w-full would clamp the list 8px too
                // small and clip the end tabs' rings.
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

              <ProximityFocusRing rect={focusRect} />

              {children}
            </Tabs.List>
          }
        />
      </TabsSubtleContext.Provider>
    );

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

    // both stacked spans carry the text-box trim so the bold sizer and the label keep identical boxes
    return (
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
          // fixed heights so the label's text-box trim cannot shrink the tab
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
