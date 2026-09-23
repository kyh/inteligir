// Vendored from Fluid Functionalism (github.com/mickadesign/fluid-functionalism), MIT.
import { useCallback, useEffect, useRef, useState } from "react";
import type { Dispatch, MouseEvent, RefObject, SetStateAction } from "react";

export interface ItemRect {
  top: number;
  height: number;
  left: number;
  width: number;
}

interface UseProximityHoverOptions {
  axis?: "x" | "y" | "xy";
  // how one item's box is read, in its container's layout space; the default is the whole
  // offset box
  measure?: (element: HTMLElement) => ItemRect;
}

interface UseProximityHoverReturn {
  activeIndex: number | null;
  setActiveIndex: Dispatch<SetStateAction<number | null>>;
  itemRects: ItemRect[];
  // gate positioned overlays on this: one mounted against a rect a later pass corrects animates in
  // from the wrong row
  isMeasured: boolean;
  session: number;
  handlers: {
    onMouseMove: (e: MouseEvent) => void;
    onMouseEnter: () => void;
    onMouseLeave: () => void;
  };
  // the items in the order their indices name; the container is observed while it holds any
  setItems: (elements: readonly HTMLElement[]) => void;
  measureItems: () => void;
}

// a popup can be in the DOM a frame before it is laid out, so the remeasure retries rather than
// publishing zeroed rects; the cap keeps a list hidden for good from spinning forever
const measurementAttempts = 3;

// offset*, not getBoundingClientRect: layout values ignore the parent motion.div's scale
// transform and match the space position: absolute children use
const offsetBox = (element: HTMLElement): ItemRect => ({
  height: element.offsetHeight,
  left: element.offsetLeft,
  top: element.offsetTop,
  width: element.offsetWidth,
});

const sameRect = (a: ItemRect | undefined, b: ItemRect): boolean =>
  a !== undefined &&
  a.top === b.top &&
  a.left === b.left &&
  a.width === b.width &&
  a.height === b.height;

const pickIndexXY = (
  container: HTMLElement,
  containerRect: DOMRect,
  rects: ItemRect[],
  mouseX: number,
  mouseY: number,
): number | null => {
  let closestIndex: number | null = null;
  let closestDistance = Infinity;
  let containingIndex: number | null = null;

  const scrollX = container.scrollLeft;
  const scrollY = container.scrollTop;
  const borderX = container.clientLeft;
  const borderY = container.clientTop;
  // map layout coords into viewport space, correcting for ancestor scale on each axis
  const scaleX = container.offsetWidth > 0 ? containerRect.width / container.offsetWidth : 1;
  const scaleY = container.offsetHeight > 0 ? containerRect.height / container.offsetHeight : 1;

  for (let index = 0; index < rects.length; index += 1) {
    const r = rects[index];
    if (!r) {
      continue;
    }

    const left = containerRect.left + (borderX + r.left - scrollX) * scaleX;
    const top = containerRect.top + (borderY + r.top - scrollY) * scaleY;
    const width = r.width * scaleX;
    const height = r.height * scaleY;

    if (mouseX >= left && mouseX <= left + width && mouseY >= top && mouseY <= top + height) {
      containingIndex = index;
    }

    const dx = mouseX - (left + width / 2);
    const dy = mouseY - (top + height / 2);
    const distance = Math.hypot(dx, dy);

    if (distance < closestDistance) {
      closestDistance = distance;
      closestIndex = index;
    }
  }

  return containingIndex ?? closestIndex;
};

const pickIndexAlongAxis = (
  container: HTMLElement,
  containerRect: DOMRect,
  rects: ItemRect[],
  axis: "x" | "y",
  mousePos: number,
): number | null => {
  let closestIndex: number | null = null;
  let closestDistance = Infinity;
  let containingIndex: number | null = null;

  const scrollOffset = axis === "x" ? container.scrollLeft : container.scrollTop;
  const borderOffset = axis === "x" ? container.clientLeft : container.clientTop;
  const containerEdge = axis === "x" ? containerRect.left : containerRect.top;
  // item rects are layout values while the container rect carries any ancestor scale, so
  // the factor maps them into the cursor's space
  const layoutSize = axis === "x" ? container.offsetWidth : container.offsetHeight;
  const visualSize = axis === "x" ? containerRect.width : containerRect.height;
  const scale = layoutSize > 0 ? visualSize / layoutSize : 1;

  for (let index = 0; index < rects.length; index += 1) {
    const r = rects[index];
    if (!r) {
      continue;
    }

    const contentPos = axis === "x" ? r.left : r.top;
    const itemStart = containerEdge + (borderOffset + contentPos - scrollOffset) * scale;
    const itemSize = (axis === "x" ? r.width : r.height) * scale;
    const itemEnd = itemStart + itemSize;

    if (mousePos >= itemStart && mousePos <= itemEnd) {
      containingIndex = index;
    }

    const itemCenter = itemStart + itemSize / 2;
    const distance = Math.abs(mousePos - itemCenter);

    if (distance < closestDistance) {
      closestDistance = distance;
      closestIndex = index;
    }
  }

  return containingIndex ?? closestIndex;
};

export const useProximityHover = <T extends HTMLElement>(
  containerRef: RefObject<T | null>,
  options: UseProximityHoverOptions = {},
): UseProximityHoverReturn => {
  const { axis = "y", measure = offsetBox } = options;
  const itemsRef = useRef<readonly HTMLElement[]>([]);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [itemRects, setItemRects] = useState<ItemRect[]>([]);
  const [isMeasured, setIsMeasured] = useState(false);
  const itemRectsRef = useRef<ItemRect[]>([]);
  const [session, setSession] = useState(0);
  const rafIdRef = useRef<number | null>(null);
  const remeasureRafIdRef = useRef<number | null>(null);

  const runMeasurement = useCallback(() => {
    const container = containerRef.current;
    if (!container) {
      return false;
    }
    const rects: ItemRect[] = [];
    for (const element of itemsRef.current) {
      // an element in a display:none or not-yet-laid-out popup has no offsetParent and reports 0
      // for every offset, which would pin overlays to the top; position: fixed items also lack an
      // offsetParent but do have a size, so the box is the test
      const hasLayoutBox =
        element.offsetParent !== null || element.offsetWidth > 0 || element.offsetHeight > 0;
      if (!hasLayoutBox) {
        return false;
      }
      rects.push(measure(element));
    }
    const prev = itemRectsRef.current;
    if (prev.length !== rects.length || rects.some((rect, i) => !sameRect(prev[i], rect))) {
      itemRectsRef.current = rects;
      setItemRects(rects);
    }
    return true;
  }, [containerRef, measure]);

  const measureItems = useCallback(() => {
    runMeasurement();
  }, [runMeasurement]);

  // the only place readiness is reported, so isMeasured cannot turn true while another pass is queued
  const scheduleMeasurement = useCallback(
    // named so the retry recurses into the function itself, not the binding useCallback is still building
    function schedule(attemptsLeft: number): void {
      if (remeasureRafIdRef.current !== null) {
        cancelAnimationFrame(remeasureRafIdRef.current);
      }
      remeasureRafIdRef.current = requestAnimationFrame(() => {
        remeasureRafIdRef.current = null;
        if (runMeasurement()) {
          setIsMeasured(true);
        } else if (attemptsLeft > 1) {
          schedule(attemptsLeft - 1);
        }
      });
    },
    [runMeasurement],
  );

  const remeasure = useCallback(() => {
    // readiness drops first: an overlay positioned from the stale rects would be corrected after
    // mounting, which animates as a slide
    setIsMeasured(false);
    scheduleMeasurement(measurementAttempts);
  }, [scheduleMeasurement]);

  // One observer over the items and their container. Readiness is not dropped on a resize: the
  // item set is unchanged, and hiding the overlays on every reflow would flicker them. The items
  // are observed, not only the container, because a row changing size in place moves every row
  // under it while the container may keep its size.
  const roRef = useRef<ResizeObserver | null>(null);
  const observedContainerRef = useRef<HTMLElement | null>(null);
  const getRo = useCallback(() => {
    if (roRef.current === null && globalThis.ResizeObserver !== undefined) {
      roRef.current = new ResizeObserver(() => {
        scheduleMeasurement(measurementAttempts);
      });
    }
    return roRef.current;
  }, [scheduleMeasurement]);

  const setItems = useCallback(
    (elements: readonly HTMLElement[]) => {
      const previous = itemsRef.current;
      if (
        previous.length === elements.length &&
        previous.every((element, i) => element === elements[i])
      ) {
        return;
      }
      itemsRef.current = elements;
      const ro = getRo();
      if (ro !== null) {
        const next = new Set(elements);
        for (const element of previous) {
          if (!next.has(element)) {
            ro.unobserve(element);
          }
        }
        const had = new Set(previous);
        for (const element of elements) {
          if (!had.has(element)) {
            ro.observe(element);
          }
        }
        // read with the items rather than once at mount: a popup's node mounts in a portal after
        // the hook's owner, and an empty list has nothing to measure
        const container = elements.length === 0 ? null : containerRef.current;
        if (container !== observedContainerRef.current) {
          if (observedContainerRef.current !== null) {
            ro.unobserve(observedContainerRef.current);
          }
          if (container !== null) {
            ro.observe(container);
          }
          observedContainerRef.current = container;
        }
      }
      remeasure();
    },
    [containerRef, getRo, remeasure],
  );

  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      const mouseX = e.clientX;
      const mouseY = e.clientY;

      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
      }

      rafIdRef.current = requestAnimationFrame(() => {
        rafIdRef.current = null;
        const container = containerRef.current;
        if (!container) {
          return;
        }

        const containerRect = container.getBoundingClientRect();
        const rects = itemRectsRef.current;

        if (axis === "xy") {
          setActiveIndex(pickIndexXY(container, containerRect, rects, mouseX, mouseY));
          return;
        }

        const mousePos = axis === "x" ? mouseX : mouseY;
        setActiveIndex(pickIndexAlongAxis(container, containerRect, rects, axis, mousePos));
      });
    },
    [axis, containerRef],
  );

  const handleMouseEnter = useCallback(() => {
    setSession((s) => s + 1);
  }, []);

  const handleMouseLeave = useCallback(() => {
    if (rafIdRef.current !== null) {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
    }
    setActiveIndex(null);
  }, []);

  useEffect(
    () => () => {
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
      }
      if (remeasureRafIdRef.current !== null) {
        cancelAnimationFrame(remeasureRafIdRef.current);
      }
      // forgotten with the observer: Fast Refresh re-runs the effects over the same items, and a
      // setItems that found them unchanged would leave the new observer watching nothing
      roRef.current?.disconnect();
      roRef.current = null;
      observedContainerRef.current = null;
      itemsRef.current = [];
    },
    [],
  );

  return {
    activeIndex,
    handlers: {
      onMouseEnter: handleMouseEnter,
      onMouseLeave: handleMouseLeave,
      onMouseMove: handleMouseMove,
    },
    isMeasured,
    itemRects,
    measureItems,
    session,
    setActiveIndex,
    setItems,
  };
};
