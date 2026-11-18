// A long note's runs off screen hold an estimate of their height until they first draw
// (EditorChunk, in editor-chrome.tsx), so a glide across them aims at a place that moves as each run
// it passes draws, and stops short of it. A jump further than about a screen lands at once, where
// the runs between keep their estimates and the target holds still (in WebKit, which keeps no
// scroll anchor, because run-anchoring.ts holds it); a near one glides.

import { holdInView } from "@repo/editor/run-anchoring";

const SCROLLER = "[data-editor-scroller]";

// a screen and a half: the runs that close are already drawn, since a run renders on approach
const NEAR_SCREENS = 1.5;

// a glide is travel, which the app drops for a person who asked for reduced motion (MotionPolicy)
const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";

const isNearInScroller = (el: Element, scroller: Element): boolean => {
  const offset = el.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
  return Math.abs(offset) <= scroller.clientHeight * NEAR_SCREENS;
};

// `at` is where the element lands in the note's scroller: centred, or its top this far below the
// scroller's
export const reveal = (el: Element, at: "center" | { readonly top: number }): void => {
  // a block in a folded section draws no box, so a place measured from one is the scroller's own
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
