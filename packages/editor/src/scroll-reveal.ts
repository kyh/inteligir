import { holdInView } from "@repo/editor/run-anchoring";

const SCROLLER = "[data-editor-scroller]";

const NEAR_SCREENS = 1.5;

const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";

const isNearInScroller = (el: Element, scroller: Element) => {
  const offset = el.getBoundingClientRect().top - scroller.getBoundingClientRect().top;

  return Math.abs(offset) <= scroller.clientHeight * NEAR_SCREENS;
};

export const reveal = (el: Element, at: "center" | { readonly top: number }) => {
  if (el.getClientRects().length === 0) {
    return;
  }

  const scroller = el.closest(SCROLLER);
  const near = scroller === null || isNearInScroller(el, scroller);
  const behavior = near && !window.matchMedia(REDUCED_MOTION).matches ? "smooth" : "auto";

  if (at === "center" || scroller === null) {
    el.scrollIntoView({ behavior, block: "center" });
  } else {
    const offset = el.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
    scroller.scrollTo({ behavior, top: scroller.scrollTop + offset - at.top });
  }

  if (!near) {
    holdInView(el);
  }
};
