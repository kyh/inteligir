// Layout APIs jsdom does not implement, stubbed to empty geometry — enough
// for the editor, Base UI portals and cmdk to mount and dispatch; anything
// asserting on real pixel layout belongs in a browser. Guarded on `window` so
// the same setup file is inert under node-environment test files.

if (typeof window !== "undefined") {
  if (!window.matchMedia) {
    window.matchMedia = (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    });
  }
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = () => {};
  }
  if (!globalThis.ResizeObserver) {
    class ResizeObserverStub {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    }
    globalThis.ResizeObserver = ResizeObserverStub;
  }
}
