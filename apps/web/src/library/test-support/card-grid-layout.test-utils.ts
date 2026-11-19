import { vi } from "vitest";

const sizeOf = (element: Element, size: number) =>
  element.matches('[data-slot="card-grid"]') ? size : 0;

export const layOutCardGrids = (box: { readonly width: number; readonly height: number }) => {
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
