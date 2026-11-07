import { z } from "zod";

import { LIBRARY_PAGE_PATH } from "@repo/contract/cloud/library-page";

// where a sign-in or sign-up lands when nothing asked to come back
export const SIGNED_IN_HOME = LIBRARY_PAGE_PATH;

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

const wayBackSchema = z
  .string()
  .transform((value) => internalNextPath(value) ?? undefined)
  .optional();

// the way back every account page carries, so a page holds one this site may follow or none: a
// malformed or off-site `next` is dropped, not refused, so a bad link still reaches the form
export const authPageSearchSchema = z.object({
  // oxlint-disable-next-line unicorn/no-useless-undefined, promise/valid-params, promise/prefer-await-to-then -- zod's catch, not a promise's: it takes the fallback positionally and undefined IS the fallback
  next: z.catch(wayBackSchema, undefined),
});

// where a session goes once it has one, by a document load: the landing may be a page the Worker
// answers before this router (the library, an assistant's consent page)
export const signedInLanding = (next?: string): string => internalNextPath(next) ?? SIGNED_IN_HOME;

const RESET_PAGE_PATH = "/app/reset-password";

// where a reset's emailed link lands: the way back rides the link, since the mail may be opened
// long after, and in another browser
export const resetLanding = (next?: string): string => {
  const wayBack = internalNextPath(next);
  return wayBack === null
    ? RESET_PAGE_PATH
    : `${RESET_PAGE_PATH}?${new URLSearchParams({ next: wayBack }).toString()}`;
};
