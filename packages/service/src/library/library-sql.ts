// the cell's own database holds a row this build cannot read
export class LibraryRowError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "LibraryRowError";
  }
}
