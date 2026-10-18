// A long note's runs off screen hold an estimate of their height until they first draw
// (EditorChunk, in editor-chrome.tsx), so a glide across them aims at a place that moves as each run
// it passes draws, and stops short of it. A jump further than about a screen lands at once, where
// the runs between keep their estimates and the target holds still; a near one glides.

const SCROLLER = "[data-editor-scroller]";

// a screen and a half: the runs that close are already drawn, since a run renders on approach
const NEAR_SCREENS = 1.5;

export const isNearInScroller = (el: Element, scroller: Element): boolean => {
  const offset = el.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
  return Math.abs(offset) <= scroller.clientHeight * NEAR_SCREENS;
};

// the element centred in the note's scroller: glided to when near, jumped to when far
export const revealCentered = (el: Element): void => {
  const scroller = el.closest(SCROLLER);
  const near = scroller === null || isNearInScroller(el, scroller);
  el.scrollIntoView({ behavior: near ? "smooth" : "auto", block: "center" });
};
