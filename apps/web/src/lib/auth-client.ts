import type { Clock } from "@repo/contract/library/account-socket";
import { createAuthClient } from "better-auth/client";

// no baseURL: the same Worker serves the app and /api/auth/*, so the relative default is right on every host
export const authClient = createAuthClient();

export const AUTH_FALLBACK_ERROR = "Something went wrong — try again.";

export const authErrorMessage = (error: { message?: string | undefined } | null): string =>
  error?.message ?? AUTH_FALLBACK_ERROR;

// who is signed in: Settings › Account names them
export interface SignedIn {
  readonly email: string;
  readonly name: string;
}

// who the session says this is, by the id that outlives a change of address
interface SessionUser extends SignedIn {
  readonly id: string;
}

// a read that failed is not a read that found no session: sending a signed-in user to sign-in
// over a 429 or a 5xx asks for a password they already gave
export type SessionState =
  | { readonly kind: "signed-in"; readonly user: SessionUser }
  | { readonly kind: "signed-out" }
  | { readonly kind: "unknown"; readonly message: string };

export const activeSession = async (): Promise<SessionState> => {
  const { data, error } = await authClient.getSession();
  if (error !== null) {
    return error.status === 401
      ? { kind: "signed-out" }
      : { kind: "unknown", message: authErrorMessage(error) };
  }
  if (data === null) {
    return { kind: "signed-out" };
  }
  const { email, id, name } = data.user;
  return { kind: "signed-in", user: { email, id, name } };
};

export const SIGN_IN_PATH = "/app/sign-in";

// the sign-in, which loads `here` again once it signs the browser in
export const signInHref = (here: Pick<Location, "pathname" | "search">): string =>
  `${SIGN_IN_PATH}?${new URLSearchParams({ next: `${here.pathname}${here.search}` }).toString()}`;

// Better Auth slides a session and its cookie together on its own read alone, which a tab
// otherwise makes only as it opens, so a tab left open would lose its cookie seven days after its
// sign-in, however much it was used (`apps/web/CLAUDE.md` § ONLY BETTER AUTH'S OWN READ SLIDES A
// SESSION). Well inside the day a session waits before it slides.
/** @internal */
export const SESSION_READ_MS = 3_600_000;

export const keepSession = (clock: Clock, read: () => Promise<void>): void => {
  const readOnce = async (): Promise<void> => {
    try {
      await read();
    } catch {
      // the next read makes up for this one, and a session that ended meets the next `/v1` call
    }
  };
  clock.after(SESSION_READ_MS, () => {
    keepSession(clock, read);
    void readOnce();
  });
};
