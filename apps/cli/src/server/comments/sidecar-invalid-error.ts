// not folded to `{}`: an empty fold lets the next write erase every thread an external writer left.
export class SidecarInvalidError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SidecarInvalidError";
  }
}
