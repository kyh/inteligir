// A run of blocks off screen is held at an estimate of its height until it first draws
// (EditorChunk, in editor-chrome.tsx), and the run's real height is rarely the estimate. Chromium
// keeps what is in view still through its own scroll anchoring; WebKit, the Mac app's and the
// phone's engine, has none (`overflow-anchor`), so a run above the view that drew moved
// everything under it: a far jump landed on other text, and scrolling back up leapt by the
// difference each time a run drew. Where the engine keeps no anchor, this keeps one:
//
// - a run that changes size while it lies wholly above the view, or that draws for the first
//   time with its top above the view's, moves the scroller by as much, so scrolling back up never
//   leaps; a run already drawn and in view is left alone, since what changed it is in sight;
// - a run that holds a jump's target or the caret is left alone too: a jump, Slate's caret scroll
//   among them, lays out the run it lands in before it scrolls, so that run's size is already
//   counted in where it landed;
// - a far jump holds its target where it landed for a moment (`holdInView`), so the run above the
//   target, which draws only once the jump has landed, cannot push it away.

const SCROLLER = "[data-editor-scroller]";
const SAME_PX = 0.5;
// how long a jump's target is held: the runs around it draw within a frame or two of the landing
const HOLD_MS = 1500;

// a run that never drew is held at `auto <length>`'s length, the run's estimate
const ESTIMATE = /(?<px>\d+(?:\.\d+)?)px\s*$/u;

const estimateOf = (run: Element): number | null => {
  const px = ESTIMATE.exec(getComputedStyle(run).getPropertyValue("contain-intrinsic-block-size"))
    ?.groups?.px;
  return px === undefined ? null : Number(px);
};

const keepsItsOwnAnchor = (): boolean =>
  typeof CSS === "undefined" || CSS.supports("overflow-anchor", "auto");

const blockSizeOf = (entry: ResizeObserverEntry): number =>
  entry.borderBoxSize[0]?.blockSize ?? entry.contentRect.height;

export interface RunChange {
  // the run's block size before and after, its estimate, and its top from the view's top
  readonly was: number;
  readonly now: number;
  readonly estimate: number | null;
  readonly top: number;
  // it holds a jump's target or the caret, so a jump laid it out before it scrolled
  readonly landedIn: boolean;
}

// how far the view moves for what it shows to hold still
export const anchorShift = (changes: readonly RunChange[]): number => {
  let shift = 0;
  for (const { was, now, estimate, top, landedIn } of changes) {
    const firstDraw = estimate !== null && Math.abs(was - estimate) < SAME_PX;
    const whollyAbove = top + Math.max(was, now) <= 0;
    if (whollyAbove || (firstDraw && top < 0 && !landedIn)) {
      shift += now - was;
    }
  }
  return shift;
};

interface Held {
  readonly el: Element;
  readonly top: number;
  readonly until: number;
  // the scroll this hold made or followed: any other ends the hold, since the person scrolled
  expected: number;
}

interface RunAnchor {
  observe: (run: Element) => void;
  unobserve: (run: Element) => void;
  hold: (el: Element) => void;
}

const createRunAnchor = (scroller: Element): RunAnchor => {
  const sizes = new WeakMap<Element, number>();
  let held: Held | null = null;

  scroller.addEventListener(
    "scroll",
    () => {
      if (held !== null && Math.abs(scroller.scrollTop - held.expected) >= SAME_PX) {
        held = null;
      }
    },
    { passive: true },
  );

  const scrollBy = (px: number): void => {
    scroller.scrollTop += px;
    if (held !== null) {
      held.expected = scroller.scrollTop;
    }
  };

  const observer = new ResizeObserver((entries) => {
    const viewTop = scroller.getBoundingClientRect().top;
    const caret = scroller.ownerDocument.getSelection()?.focusNode ?? null;
    const moved: { target: Element; was: number; now: number; at: number }[] = [];
    for (const entry of entries) {
      const now = blockSizeOf(entry);
      const was = sizes.get(entry.target);
      sizes.set(entry.target, now);
      if (was !== undefined && Math.abs(now - was) >= SAME_PX) {
        moved.push({
          at: entry.target.getBoundingClientRect().top - viewTop,
          now,
          target: entry.target,
          was,
        });
      }
    }
    // the runs stack in the note's order and their tops are read after every change in this
    // batch, so a run's top before is its top now less what the runs above it grew by
    let grownAbove = 0;
    const changes: RunChange[] = [];
    for (const { at, now, target, was } of moved.toSorted((a, b) => a.at - b.at)) {
      changes.push({
        estimate: estimateOf(target),
        landedIn:
          (held !== null && target.contains(held.el)) || (caret !== null && target.contains(caret)),
        now,
        top: at - grownAbove,
        was,
      });
      grownAbove += now - was;
    }
    const shift = anchorShift(changes);
    if (shift !== 0) {
      scrollBy(shift);
    }
    if (held !== null && (performance.now() > held.until || !held.el.isConnected)) {
      held = null;
    }
    if (held !== null) {
      const drift = held.el.getBoundingClientRect().top - held.top;
      if (Math.abs(drift) >= SAME_PX) {
        scrollBy(drift);
      }
    }
  });

  return {
    hold: (el) => {
      held = {
        el,
        expected: scroller.scrollTop,
        top: el.getBoundingClientRect().top,
        until: performance.now() + HOLD_MS,
      };
    },
    observe: (run) => {
      observer.observe(run);
    },
    unobserve: (run) => {
      sizes.delete(run);
      observer.unobserve(run);
    },
  };
};

const anchors = new WeakMap<Element, RunAnchor>();

// a run's ref: where the engine keeps its own anchor, or the run sits in no scroller, it does
// nothing
export const anchorRun = (run: HTMLElement | null): (() => void) | undefined => {
  if (run === null || keepsItsOwnAnchor() || typeof ResizeObserver === "undefined") {
    return undefined;
  }
  const scroller = run.closest(SCROLLER);
  if (scroller === null) {
    return undefined;
  }
  let anchor = anchors.get(scroller);
  if (anchor === undefined) {
    anchor = createRunAnchor(scroller);
    anchors.set(scroller, anchor);
  }
  const held = anchor;
  held.observe(run);
  return () => {
    held.unobserve(run);
  };
};

// a far jump has just landed on `el`: it holds there while the runs around it draw, until the
// person scrolls. Nothing where the engine keeps its own anchor.
export const holdInView = (el: Element): void => {
  const scroller = el.closest(SCROLLER);
  if (scroller !== null) {
    anchors.get(scroller)?.hold(el);
  }
};
