/** The printable message of an unknown thrown value. */
export const messageOf = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause);
