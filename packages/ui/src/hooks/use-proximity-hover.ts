// Vendored from Fluid Functionalism (github.com/mickadesign/fluid-functionalism), MIT.
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type MouseEvent,
  type RefObject,
  type SetStateAction,
} from "react";

export interface ItemRect {
  top: number;
  height: number;
  left: number;
  width: number;
}

interface UseProximityHoverOptions {
  axis?: "x" | "y" | "xy";
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
  registerItem: (index: number, element: HTMLElement | null) => void;
  measureItems: () => void;
}

// a popup can be in the DOM a frame before it is laid out, so the remeasure retries rather than
// publishing zeroed rects; the cap keeps a list hidden for good from spinning forever
const measurementAttempts = 3;

export function useProximityHover<T extends HTMLElement>(
  containerRef: RefObject<T | null>,
  options: UseProximityHoverOptions = {},
): UseProximityHoverReturn {
  const { axis = "y" } = options;
  const itemsRef = useRef(new Map<number, HTMLElement>());
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [itemRects, setItemRects] = useState<ItemRect[]>([]);
  const [isMeasured, setIsMeasured] = useState(false);
  const itemRectsRef = useRef<ItemRect[]>([]);
  const [session, setSession] = useState(0);
  const rafIdRef = useRef<number | null>(null);
  const remeasureRafIdRef = useRef<number | null>(null);

  const runMeasurement = useCallback(() => {
    const container = containerRef.current;
    if (!container) return false;
    const rects: ItemRect[] = [];
    let everyItemHasLayout = true;
    itemsRef.current.forEach((element, index) => {
      // an element in a display:none or not-yet-laid-out popup has no offsetParent and reports 0
      // for every offset, which would pin overlays to the top; position: fixed items also lack an
      // offsetParent but do have a size, so the box is the test
      const hasLayoutBox =
        element.offsetParent !== null || element.offsetWidth > 0 || element.offsetHeight > 0;
      if (!hasLayoutBox) {
        everyItemHasLayout = false;
        return;
      }
      // offset*, not getBoundingClientRect: layout values ignore the parent motion.div's scale
      // transform and match the space position: absolute children use
      rects[index] = {
        top: element.offsetTop,
        height: element.offsetHeight,
        left: element.offsetLeft,
        width: element.offsetWidth,
      };
    });
    if (!everyItemHasLayout) return false;
    const prev = itemRectsRef.current;
    let changed = prev.length !== rects.length;
    for (let i = 0; !changed && i < rects.length; i++) {
      const p = prev[i];
      const r = rects[i];
      if (p === r) continue; // both undefined (sparse slot)
      changed =
        !p ||
        !r ||
        p.top !== r.top ||
        p.left !== r.left ||
        p.width !== r.width ||
        p.height !== r.height;
    }
    if (changed) {
      itemRectsRef.current = rects;
      setItemRects(rects);
    }
    return true;
  }, [containerRef]);

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

  // observes the items themselves, not only the container: a row changing size in place must
  // invalidate the rects even after the container remounted under a different element
  const itemRoRef = useRef<ResizeObserver | null>(null);
  const getItemRo = useCallback(() => {
    if (itemRoRef.current === null && globalThis.ResizeObserver !== undefined) {
      itemRoRef.current = new ResizeObserver(() => scheduleMeasurement(measurementAttempts));
    }
    return itemRoRef.current;
  }, [scheduleMeasurement]);

  const registerItem = useCallback(
    (index: number, element: HTMLElement | null) => {
      if (element) {
        itemsRef.current.set(index, element);
        getItemRo()?.observe(element);
      } else {
        const previous = itemsRef.current.get(index);
        if (previous) itemRoRef.current?.unobserve(previous);
        itemsRef.current.delete(index);
      }
      remeasure();
    },
    [remeasure, getItemRo],
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
        if (!container) return;

        const containerRect = container.getBoundingClientRect();

        if (axis === "xy") {
          let closestIndex: number | null = null;
          let closestDistance = Infinity;
          let containingIndex: number | null = null;

          const rects = itemRectsRef.current;
          const scrollX = container.scrollLeft;
          const scrollY = container.scrollTop;
          const borderX = container.clientLeft;
          const borderY = container.clientTop;
          // map layout coords into viewport space, correcting for ancestor scale on each axis
          const scaleX =
            container.offsetWidth > 0 ? containerRect.width / container.offsetWidth : 1;
          const scaleY =
            container.offsetHeight > 0 ? containerRect.height / container.offsetHeight : 1;

          for (let index = 0; index < rects.length; index++) {
            const r = rects[index];
            if (!r) continue;

            const left = containerRect.left + (borderX + r.left - scrollX) * scaleX;
            const top = containerRect.top + (borderY + r.top - scrollY) * scaleY;
            const width = r.width * scaleX;
            const height = r.height * scaleY;

            if (
              mouseX >= left &&
              mouseX <= left + width &&
              mouseY >= top &&
              mouseY <= top + height
            ) {
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

          setActiveIndex(containingIndex ?? closestIndex);
          return;
        }

        const mousePos = axis === "x" ? mouseX : mouseY;

        let closestIndex: number | null = null;
        let closestDistance = Infinity;
        let containingIndex: number | null = null;

        const rects = itemRectsRef.current;
        const scrollOffset = axis === "x" ? container.scrollLeft : container.scrollTop;
        const borderOffset = axis === "x" ? container.clientLeft : container.clientTop;
        const containerEdge = axis === "x" ? containerRect.left : containerRect.top;
        // item rects are layout values while the container rect carries any ancestor scale, so
        // the factor maps them into the cursor's space
        const layoutSize = axis === "x" ? container.offsetWidth : container.offsetHeight;
        const visualSize = axis === "x" ? containerRect.width : containerRect.height;
        const scale = layoutSize > 0 ? visualSize / layoutSize : 1;

        for (let index = 0; index < rects.length; index++) {
          const r = rects[index];
          if (!r) continue;

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

        setActiveIndex(containingIndex ?? closestIndex);
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

  // readiness is not dropped on a container resize: the item set is unchanged, and hiding the
  // overlays on every reflow would flicker them
  useEffect(() => {
    const container = containerRef.current;
    if (!container || globalThis.ResizeObserver === undefined) return;
    const ro = new ResizeObserver(() => scheduleMeasurement(measurementAttempts));
    ro.observe(container);
    return () => ro.disconnect();
  }, [containerRef, scheduleMeasurement]);

  useEffect(() => {
    return () => {
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
      }
      if (remeasureRafIdRef.current !== null) {
        cancelAnimationFrame(remeasureRafIdRef.current);
      }
      itemRoRef.current?.disconnect();
      itemRoRef.current = null;
    };
  }, []);

  return {
    activeIndex,
    setActiveIndex,
    itemRects,
    isMeasured,
    session,
    handlers: {
      onMouseMove: handleMouseMove,
      onMouseEnter: handleMouseEnter,
      onMouseLeave: handleMouseLeave,
    },
    registerItem,
    measureItems,
  };
}
