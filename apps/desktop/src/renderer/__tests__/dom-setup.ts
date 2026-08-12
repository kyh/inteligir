// ---------------------------------------------------------------------------
// Setup for the `renderer` (jsdom) vitest project — wired in vitest.config.ts.
//
// jsdom implements no ResizeObserver, and renderer components legitimately use
// one: the composer's prompt bar re-measures its wrap threshold whenever the
// grid or either control cluster changes width, which no dependency list can
// observe. Without a stub, constructing one throws during render and every test
// touching that component fails on a missing browser API rather than on
// anything it means to assert.
//
// The stub is deliberately inert — it records nothing and never invokes the
// callback. jsdom does no layout (every offsetWidth is 0), so a firing observer
// could only report meaningless zero-size boxes. Components must therefore take
// their initial measurement in a layout effect, which they do; these tests
// assert handler wiring and state transitions, not measured geometry.
// ---------------------------------------------------------------------------

class ResizeObserverStub implements ResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

if (!("ResizeObserver" in globalThis)) {
  globalThis.ResizeObserver = ResizeObserverStub;
}
