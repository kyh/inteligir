/** The printable message of an unknown thrown value. */
export function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
