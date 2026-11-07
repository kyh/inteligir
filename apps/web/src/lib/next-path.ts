import { z } from "zod";

// where a sign-in or sign-up lands when nothing asked to come back: the one page a session
// opens, so the landing shows the account is signed in
export const SIGNED_IN_HOME = "/app/devices";

// the way back the sign-in and sign-up pages carry; a malformed `next` is dropped, not refused, so
// a bad link still reaches the form, and internalNextPath decides a well-formed one may be followed
export const authPageSearchSchema = z.object({
  // oxlint-disable-next-line unicorn/no-useless-undefined, promise/valid-params, promise/prefer-await-to-then -- zod's catch, not a promise's: it takes the fallback positionally and undefined IS the fallback
  next: z.catch(z.string().min(1).optional(), undefined),
});

// Narrows a sign-in return target to a same-document path (open-redirect guard):
// browsers read `//` and `/\` as protocol-relative, and resolving against a sentinel
// base settles the remaining encoding tricks without enumerating them.
const RESOLUTION_BASE = "http://internal.invalid";

/** @internal */
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
  // a dot segment resolves away before a second slash (`/.//evil.example` is `//evil.example`),
  // which the sign-in's document load reads as protocol-relative
  if (resolved.pathname.startsWith("//")) {
    return null;
  }
  return `${resolved.pathname}${resolved.search}${resolved.hash}`;
};

// where a session goes once it has one, by a document load: the way back may be a page the Worker
// answers before this router (an assistant's consent page)
export const signedInLanding = (next?: string): string => internalNextPath(next) ?? SIGNED_IN_HOME;
