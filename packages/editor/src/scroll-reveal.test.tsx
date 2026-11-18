// A reveal near at hand glides, but not for a person who asked for reduced motion: the outline's
// heading and the find bar's match land at once for them, as the rest of the app drops travel.

import { afterEach, describe, expect, it, vi } from "vitest";

import { reveal } from "@repo/editor/scroll-reveal";

// jsdom has no media queries; reveal reads only whether the query matches
const askForReducedMotion = (reduce: boolean): void => {
  vi.stubGlobal("matchMedia", (media: string) => ({
    matches: reduce && media === "(prefers-reduced-motion: reduce)",
    media,
  }));
};

// jsdom lays nothing out: one box makes the element drawn, and every place measures 0, so near
const drawn = <E extends Element>(el: E): E => {
  const box = new DOMRect(0, 0, 100, 20);
  el.getClientRects = () => ({
    0: box,
    item: () => box,
    length: 1,
    [Symbol.iterator]: () => [box][Symbol.iterator](),
  });
  return el;
};

const centred = () => {
  const match = drawn(document.createElement("span"));
  const scrollIntoView = vi.fn<(options?: boolean | ScrollIntoViewOptions) => void>();
  match.scrollIntoView = scrollIntoView;
  document.body.append(match);
  return { match, scrollIntoView };
};

const inScroller = () => {
  const scroller = document.createElement("div");
  scroller.dataset.editorScroller = "";
  const scrollTo = vi.fn<(options?: ScrollToOptions | number, y?: number) => void>();
  scroller.scrollTo = scrollTo;
  const heading = drawn(document.createElement("h2"));
  scroller.append(heading);
  document.body.append(scroller);
  return { heading, scrollTo };
};

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

describe("revealing a place in the note", () => {
  it("centres a find match at once for a person who asked for reduced motion", () => {
    askForReducedMotion(true);
    const { match, scrollIntoView } = centred();
    reveal(match, "center");

    expect(scrollIntoView).toHaveBeenCalledExactlyOnceWith({ behavior: "auto", block: "center" });
  });

  it("brings an outline's heading under the header at once for a person who asked for reduced motion", () => {
    askForReducedMotion(true);
    const { heading, scrollTo } = inScroller();
    reveal(heading, { top: 48 });

    expect(scrollTo).toHaveBeenCalledExactlyOnceWith({ behavior: "auto", top: -48 });
  });

  it("glides to a near place for anyone else", () => {
    askForReducedMotion(false);
    const { match, scrollIntoView } = centred();
    const { heading, scrollTo } = inScroller();
    reveal(match, "center");
    reveal(heading, { top: 48 });

    expect(scrollIntoView).toHaveBeenCalledExactlyOnceWith({ behavior: "smooth", block: "center" });
    expect(scrollTo).toHaveBeenCalledExactlyOnceWith({ behavior: "smooth", top: -48 });
  });
});
