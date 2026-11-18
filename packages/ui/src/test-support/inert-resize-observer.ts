// jsdom has no ResizeObserver, which a menu's popup and a layout reading watch their box with: this
// one keeps what it watches and never reports, and a suite that drives one stubs its own over it
export class InertResizeObserver implements ResizeObserver {
  readonly #watched = new Set<Element>();
  observe(target: Element): void {
    this.#watched.add(target);
  }
  unobserve(target: Element): void {
    this.#watched.delete(target);
  }
  disconnect(): void {
    this.#watched.clear();
  }
}
