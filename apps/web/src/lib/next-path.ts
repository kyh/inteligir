// where a sign-in or sign-up lands when nothing asked to come back: the one page a session
// opens, so the landing shows the account is signed in
export const SIGNED_IN_HOME = "/app/devices";

// Narrows a sign-in return target to a same-document path (open-redirect guard):
// browsers read `//` and `/\` as protocol-relative, and resolving against a sentinel
// base settles the remaining encoding tricks without enumerating them.
const RESOLUTION_BASE = "http://internal.invalid";

export const internalNextPath = (value: string | undefined): string | null => {
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
};
