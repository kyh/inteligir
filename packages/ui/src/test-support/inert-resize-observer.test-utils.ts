export class InertResizeObserver implements ResizeObserver {
  readonly #watched = new Set<Element>();
  observe(target: Element) {
    this.#watched.add(target);
  }
  unobserve(target: Element) {
    this.#watched.delete(target);
  }
  disconnect() {
    this.#watched.clear();
  }
}
