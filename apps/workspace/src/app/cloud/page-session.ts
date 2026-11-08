// Who the session cookie the site's sign-in left signs in, as Better Auth answers it, and the way
// back to that sign-in, which loads this page again once it signs the browser in.

import { z } from "zod";

// who is signed in: Settings › Account names them
export interface SignedIn {
  readonly email: string;
  readonly name: string;
}

// who the site's session says this is, by the id that outlives a change of address
interface SessionUser extends SignedIn {
  readonly id: string;
}

// Better Auth's own answer for the cookie this request carries: null when it names no session
const sessionSchema = z
  .object({ user: z.object({ email: z.string(), id: z.string(), name: z.string() }) })
  .nullable();

export const SIGN_IN_PATH = "/app/sign-in";

export const signInHref = (here: Pick<Location, "pathname" | "search">): string =>
  `${SIGN_IN_PATH}?${new URLSearchParams({ next: `${here.pathname}${here.search}` }).toString()}`;

// who this cookie signs in, or null when the site says no one; a fault of the site's says neither,
// so it rejects rather than send a signed-in person to sign in again
export const readSession = async (origin: string): Promise<SessionUser | null> => {
  const response = await fetch(`${origin}/api/auth/get-session`, { credentials: "same-origin" });
  if (response.status === 401) {
    return null;
  }
  if (!response.ok) {
    throw new Error(`the session read answered ${String(response.status)}`);
  }
  return sessionSchema.parse(await response.json())?.user ?? null;
};
