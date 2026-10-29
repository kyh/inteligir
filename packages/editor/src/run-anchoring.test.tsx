// WebKit keeps no scroll anchor, so the editor keeps one for a long note's runs: what is in view
// holds still when a run above it changes size, and a run being typed in moves nothing.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { anchorRun, anchorShift, holdInView } from "@repo/editor/run-anchoring";

const ESTIMATE = 4800;

const change = (over: Partial<Parameters<typeof anchorShift>[0][number]>) => ({
  estimate: ESTIMATE,
  landedIn: false,
  now: 18_000,
  top: -4000,
  was: ESTIMATE,
  ...over,
});

describe("how far the view moves for a run's change of size", () => {
  it("follows a run wholly above the view, and one drawn for the first time with its top above", () => {
    expect(anchorShift([change({ now: 3000, top: -5000, was: 2000 })])).toBe(1000);
    expect(anchorShift([change({})])).toBe(18_000 - ESTIMATE);
  });

  it("leaves a drawn run in view, a run below the view's top, and the run a jump or the caret landed in", () => {
    expect(anchorShift([change({ now: 2100, top: -500, was: 2000 })])).toBe(0);
    expect(anchorShift([change({ top: 200 })])).toBe(0);
    expect(anchorShift([change({ landedIn: true })])).toBe(0);
  });
});

// a ResizeObserver the suite drives: each `report` is one batch of size changes
const observers: ((sizes: ReadonlyMap<Element, number>) => void)[] = [];
class DrivenResizeObserver implements ResizeObserver {
  readonly watched = new Set<Element>();
  constructor(notify: ResizeObserverCallback) {
    observers.push((sizes) => {
      const entries: ResizeObserverEntry[] = [...sizes]
        .filter(([target]) => this.watched.has(target))
        .map(([target, blockSize]) => ({
          borderBoxSize: [{ blockSize, inlineSize: 700 }],
          contentBoxSize: [{ blockSize, inlineSize: 700 }],
          contentRect: DOMRect.fromRect({ height: blockSize, width: 700 }),
          devicePixelContentBoxSize: [{ blockSize, inlineSize: 700 }],
          target,
        }));
      notify(entries, this);
    });
  }
  disconnect = (): void => {
    this.watched.clear();
  };
  observe = (target: Element): void => {
    this.watched.add(target);
  };
  unobserve = (target: Element): void => {
    this.watched.delete(target);
  };
}

const report = (sizes: ReadonlyMap<Element, number>): void => {
  for (const observer of observers) {
    observer(sizes);
  }
};

const placed = (el: Element, top: () => number): void => {
  el.getBoundingClientRect = () => DOMRect.fromRect({ height: 0, width: 700, y: top() });
};

// a scroller with two runs: the first starts 4000px above the view's top, the second below it
const mount = () => {
  const scroller = document.createElement("div");
  scroller.dataset.editorScroller = "";
  const [above, below] = [document.createElement("div"), document.createElement("div")];
  for (const run of [above, below]) {
    run.dataset.slateChunk = "true";
    scroller.append(run);
  }
  document.body.append(scroller);
  placed(scroller, () => 0);
  placed(above, () => -4000);
  placed(below, () => 2000);
  const cleanups = [above, below].map((run) => anchorRun(run));
  return { above, below, cleanups, scroller };
};

describe("the anchor a long note's runs keep where the engine keeps none", () => {
  let supports = false;
  beforeEach(() => {
    observers.length = 0;
    supports = false;
    vi.stubGlobal("ResizeObserver", DrivenResizeObserver);
    vi.stubGlobal("CSS", { supports: () => supports });
    vi.spyOn(globalThis, "getComputedStyle").mockImplementation(() => {
      const { style } = document.createElement("div");
      style.getPropertyValue = (name: string) =>
        name === "contain-intrinsic-block-size" ? `auto ${String(ESTIMATE)}px` : "";
      return style;
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    document.body.replaceChildren();
  });

  it("holds the view still when a run above it draws at its real height", () => {
    const { above, below, scroller } = mount();
    scroller.scrollTop = 30_000;
    scroller.dispatchEvent(new Event("scroll"));
    report(
      new Map([
        [above, ESTIMATE],
        [below, ESTIMATE],
      ]),
    );
    report(new Map([[above, 18_000]]));
    expect(scroller.scrollTop).toBe(30_000 + 18_000 - ESTIMATE);
  });

  it("moves nothing when a run in view grows, as typing in it does", () => {
    const { above, scroller } = mount();
    placed(above, () => -500);
    scroller.scrollTop = 30_000;
    scroller.dispatchEvent(new Event("scroll"));
    report(new Map([[above, 2000]]));
    report(new Map([[above, 2100]]));
    expect(scroller.scrollTop).toBe(30_000);
  });

  it("leaves the run a jump landed in, which the jump laid out before it scrolled", () => {
    const { above, scroller } = mount();
    const target = document.createElement("p");
    above.append(target);
    placed(target, () => 400);
    report(new Map([[above, ESTIMATE]]));
    scroller.scrollTop = 30_000;
    holdInView(target);
    report(new Map([[above, 18_000]]));
    expect(scroller.scrollTop).toBe(30_000);
  });

  it("holds a jump's target where it landed, until the person scrolls", () => {
    const { above, below, scroller } = mount();
    const target = document.createElement("p");
    below.append(target);
    let targetTop = 400;
    placed(target, () => targetTop);
    report(new Map([[below, 2000]]));
    scroller.scrollTop = 30_000;
    holdInView(target);
    // something above the target in view grew, which no run rule follows
    targetTop = 460;
    report(new Map([[below, 2060]]));
    expect(scroller.scrollTop).toBe(30_060);

    scroller.scrollTop = 29_000;
    scroller.dispatchEvent(new Event("scroll"));
    targetTop = 520;
    report(new Map([[below, 2120]]));
    expect(scroller.scrollTop).toBe(29_000);
    expect(above.isConnected).toBe(true);
  });

  it("does nothing where the engine keeps its own anchor", () => {
    supports = true;
    const { cleanups } = mount();
    expect(cleanups).toEqual([undefined, undefined]);
    expect(observers).toHaveLength(0);
  });
});
