/** The `code` of a Node errno exception (`"ENOENT"`, `"EADDRINUSE"`, …), or
 * undefined for anything else. */
export function errnoCode(error: unknown): string | undefined {
  if (!(error instanceof Error) || !("code" in error)) {
    return undefined;
  }
  return typeof error.code === "string" ? error.code : undefined;
}
