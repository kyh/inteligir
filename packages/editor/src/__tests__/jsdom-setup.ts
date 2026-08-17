// CodeMirror measures layout through APIs jsdom does not implement. The
// shared test-support stubs cover the window-level ones; the Range stubs are
// CodeMirror-specific and stay here.

import "../test-support/jsdom-stubs";

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
