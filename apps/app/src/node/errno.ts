import { z } from "zod";

/** The `code` of a Node errno exception (`"ENOENT"`, `"EADDRINUSE"`, …), or
 * undefined for anything else. */
export function errnoCode(cause: unknown): string | undefined {
  if (!(cause instanceof Error) || !("code" in cause)) {
    return undefined;
  }
  const code = z.string().safeParse(cause.code);
  return code.success ? code.data : undefined;
}
