import { createAuthClient } from "better-auth/client";

// no baseURL: the same Worker serves the app and /api/auth/*, so the relative default is right on every host
export const authClient = createAuthClient();

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
// over a 429, a 5xx or a request that never left asks for a password they already gave
export type SessionState =
  | { readonly kind: "signed-in"; readonly user: SessionUser }
  | { readonly kind: "signed-out" }
  | { readonly kind: "unknown" };

// never rejects: a request that did not reach the Worker is one more read that failed
export const activeSession = async (): Promise<SessionState> => {
  try {
    const { data, error } = await authClient.getSession();
    if (error !== null) {
      return { kind: error.status === 401 ? "signed-out" : "unknown" };
    }
    if (data === null) {
      return { kind: "signed-out" };
    }
    const { email, id, name } = data.user;
    return { kind: "signed-in", user: { email, id, name } };
  } catch {
    return { kind: "unknown" };
  }
};

// Better Auth slides a session and its cookie together on its own read alone, which a tab
// otherwise makes only as it opens, so a tab left open would lose its cookie seven days after its
// sign-in, however much it was used (`packages/service/CLAUDE.md` § Only Better Auth's own read
// slides a session). Well inside the day a session waits before it slides.
export const SESSION_READ_MS = 3_600_000;

export const keepSession = (read: () => Promise<void>): void => {
  setInterval(() => {
    void read();
  }, SESSION_READ_MS);
};
