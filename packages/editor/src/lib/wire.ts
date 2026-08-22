/** Human-readable message for a caught value. A non-Error throw stringifies —
 * or, when `fallback` is given, yields the fallback instead (for UI surfaces
 * where a raw stringified value would read worse than a canned sentence). */
export function toErrorMessage(error: unknown, fallback?: string): string {
  if (error instanceof Error) return error.message;
  return fallback ?? String(error);
}

export function isHttpUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
}
