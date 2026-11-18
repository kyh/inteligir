const SCROLLER = "[data-editor-scroller]";
const SAME_PX = 0.5;
const HOLD_MS = 1500;

const ESTIMATE = /(?<px>\d+(?:\.\d+)?)px\s*$/u;

const estimateOf = (run: Element) => {
  const px = ESTIMATE.exec(getComputedStyle(run).getPropertyValue("contain-intrinsic-block-size"))
    ?.groups?.px;

  return px === undefined ? null : Number(px);
};

const keepsItsOwnAnchor = () =>
  typeof CSS === "undefined" || CSS.supports("overflow-anchor", "auto");

const blockSizeOf = (entry: ResizeObserverEntry) =>
  entry.borderBoxSize[0]?.blockSize ?? entry.contentRect.height;

export interface RunChange {
  readonly was: number;
  readonly now: number;
  readonly estimate: number | null;
  readonly top: number;
  readonly landedIn: boolean;
}

export const anchorShift = (changes: readonly RunChange[]) => {
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
  expected: number;
}

interface RunAnchor {
  observe: (run: Element) => void;
  unobserve: (run: Element) => void;
  hold: (el: Element) => void;
}

const createRunAnchor = (scroller: Element) => {
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

  const scrollBy = (px: number) => {
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
  } satisfies RunAnchor;
};

const anchors = new WeakMap<Element, RunAnchor>();

export const anchorRun = (run: HTMLElement | null) => {
  if (run === null || keepsItsOwnAnchor() || typeof ResizeObserver === "undefined") {
    return;
  }

  const scroller = run.closest(SCROLLER);

  if (scroller === null) {
    return;
  }

  let anchor = anchors.get(scroller);

  if (anchor === undefined) {
    anchor = createRunAnchor(scroller);
    anchors.set(scroller, anchor);
  }

  const held = anchor;
  held.observe(run);

  return (() => {
    held.unobserve(run);
  }) satisfies (() => void) | undefined;
};

export const holdInView = (el: Element) => {
  const scroller = el.closest(SCROLLER);

  if (scroller !== null) {
    anchors.get(scroller)?.hold(el);
  }
};
