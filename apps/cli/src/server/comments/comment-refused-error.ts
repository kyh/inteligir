export class CommentRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CommentRefusedError";
  }
}
