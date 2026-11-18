// jsdom lays nothing out, so a card grid, which draws only the cards inside its box, draws none: a
// suite that reads or presses cards gives every grid the box a window would, through the size the
// grid reads off its scroller, and every other element keeps jsdom's 0. Restored with the suite's
// other mocks.

import { vi } from "vitest";

const sizeOf = (element: Element, size: number): number =>
  element.matches('[data-slot="card-grid"]') ? size : 0;

export const layOutCardGrids = (box: { readonly width: number; readonly height: number }): void => {
  vi.spyOn(Element.prototype, "clientWidth", "get").mockImplementation(function clientWidth(
    this: Element,
  ) {
    return sizeOf(this, box.width);
  });
  vi.spyOn(Element.prototype, "clientHeight", "get").mockImplementation(function clientHeight(
    this: Element,
  ) {
    return sizeOf(this, box.height);
  });
};
