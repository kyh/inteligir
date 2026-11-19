/* oxlint-disable anti-slop/no-runtime-typeof -- feature detection over host objects, not input to
   parse: jsdom declares some of these as non-callable, so presence alone would not answer. */

import { InertResizeObserver } from "@repo/ui/test-support/inert-resize-observer.test-utils";

if (typeof window !== "undefined") {
  if (typeof window.matchMedia !== "function") {
    window.matchMedia = (query: string) => ({
      addEventListener: () => {},
      // oxlint-disable-next-line typescript/no-deprecated -- MediaQueryList still names it, so a stub that is one must define it
      addListener: () => {},
      dispatchEvent: () => false,
      matches: false,
      media: query,
      onchange: null,
      removeEventListener: () => {},
      // oxlint-disable-next-line typescript/no-deprecated -- MediaQueryList still names it, so a stub that is one must define it
      removeListener: () => {},
    });
  }

  if (typeof Element.prototype.scrollIntoView !== "function") {
    Element.prototype.scrollIntoView = () => {};
  }

  if (typeof Element.prototype.setPointerCapture !== "function") {
    Element.prototype.setPointerCapture = () => {};

    Element.prototype.releasePointerCapture = () => {};
  }

  if (typeof globalThis.ResizeObserver !== "function") {
    globalThis.ResizeObserver = InertResizeObserver;
  }
}
