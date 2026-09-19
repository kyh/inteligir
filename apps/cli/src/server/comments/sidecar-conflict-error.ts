export class SidecarConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SidecarConflictError";
  }
}
