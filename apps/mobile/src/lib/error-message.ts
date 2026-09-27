export const messageOf = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause);
