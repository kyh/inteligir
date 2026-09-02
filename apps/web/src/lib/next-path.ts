// Narrows a sign-in return target to a same-document path (open-redirect guard):
// browsers read `//` and `/\` as protocol-relative, and resolving against a sentinel
// base settles the remaining encoding tricks without enumerating them.
const RESOLUTION_BASE = "http://internal.invalid";

export function internalNextPath(value: string | undefined): string | null {
  if (value === undefined || !value.startsWith("/")) {
    return null;
  }
  if (value.startsWith("//") || value.startsWith("/\\")) {
    return null;
  }
  let resolved: URL;
  try {
    resolved = new URL(value, RESOLUTION_BASE);
  } catch {
    return null;
  }
  if (resolved.origin !== RESOLUTION_BASE) {
    return null;
  }
  return `${resolved.pathname}${resolved.search}${resolved.hash}`;
}
