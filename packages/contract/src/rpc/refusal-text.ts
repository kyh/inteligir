import { isOrpcError } from "./v1-errors";

export const refusalText = (cause: unknown, fallback: string) =>
  isOrpcError(cause) && cause.defined && cause.message.length > 0 ? cause.message : fallback;
