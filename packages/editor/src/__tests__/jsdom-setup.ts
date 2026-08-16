// CodeMirror measures layout through APIs jsdom does not implement. These
// stubs return empty geometry — enough for EditorView to mount, render and
// dispatch; anything asserting on real pixel layout belongs in a browser.

const emptyRect: DOMRect = {
  x: 0,
  y: 0,
  top: 0,
  left: 0,
  bottom: 0,
  right: 0,
  width: 0,
  height: 0,
  toJSON: () => ({}),
};

const emptyRectList = (): DOMRectList => ({
  length: 0,
  item: () => null,
  [Symbol.iterator]: [][Symbol.iterator],
});

Range.prototype.getBoundingClientRect = () => emptyRect;
Range.prototype.getClientRects = emptyRectList;

if (typeof Element.prototype.scrollIntoView !== "function") {
  Element.prototype.scrollIntoView = () => {};
}

if (typeof window.matchMedia !== "function") {
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

if (typeof globalThis.ResizeObserver !== "function") {
  class ResizeObserverStub {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  globalThis.ResizeObserver = ResizeObserverStub;
}
