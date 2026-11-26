import { z } from "zod";

import { LIBRARY_PAGE_PATH, SIGN_IN_PATH } from "@repo/contract/library-page";

const SIGNED_IN_HOME = LIBRARY_PAGE_PATH;

const RESOLUTION_BASE = "http://internal.invalid";

export const internalNextPath = (value: string | undefined) => {
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

  if (resolved.pathname.startsWith("//")) {
    return null;
  }

  return `${resolved.pathname}${resolved.search}${resolved.hash}`;
};

const wayBackSchema = z
  .string()
  .transform((value) => internalNextPath(value) ?? undefined)
  .optional();

export const authPageSearchSchema = z.object({
  // oxlint-disable-next-line promise/valid-params -- zod's catch, not a promise's: it takes the fallback positionally and undefined IS the fallback
  next: z.catch(wayBackSchema, undefined),
});

export const signedInLanding = (next?: string) => internalNextPath(next) ?? SIGNED_IN_HOME;

export const authPageHref = (pathname: string, next?: string) =>
  next === undefined ? pathname : `${pathname}?${new URLSearchParams({ next }).toString()}`;

export const signInHref = (here: Pick<URL, "pathname" | "search">) =>
  `${SIGN_IN_PATH}?${new URLSearchParams({ next: `${here.pathname}${here.search}` }).toString()}`;
