// ---------------------------------------------------------------------------
// The signed-in account, injected by whichever surface mounted the workspace.
//
// NOT a Bridge channel, deliberately. The session is what named the host object
// in the first place — a socket that is open has already proved who it belongs
// to — so asking the host "who am I?" would be asking a question its own
// existence answers. And signing out is the one action that must NOT go through
// that socket: it invalidates the credential the socket authenticated with, so
// it belongs to the surface that holds the credential.
//
// Same shape as html-app-host.ts: installed once at boot, before render.
// ---------------------------------------------------------------------------

/** How a delete attempt came back. A wrong password and a stale session are
 * ordinary answers the user must read, not exceptions. */
type DeleteAccountOutcome = { readonly ok: true } | { readonly ok: false; readonly error: string };

export type AccountPort = {
  /** The signed-in email, for display. */
  readonly email: string;
  /** End the session and take the user wherever signed-out belongs. */
  readonly signOut: () => Promise<void>;
  /**
   * Where this surface serves the whole vault as a downloadable archive.
   *
   * A URL rather than a call, because the point is that the BROWSER writes the
   * bytes to disk as they arrive — a promise resolving to a blob would put a
   * vault-sized archive in the page's memory to save a file the browser was
   * already capable of saving.
   */
  readonly exportVaultUrl: string;
  /**
   * Delete the account and everything in it.
   *
   * `password` is null for an account that has none (a social sign-in), where
   * the host decides on the session's freshness instead. The client does not
   * know which case it is in and must not guess: it sends what the user typed,
   * or nothing, and shows whatever sentence comes back.
   */
  readonly deleteAccount: (password: string | null) => Promise<DeleteAccountOutcome>;
};

let installed: AccountPort | null = null;

/** Install the account port. Called once at boot, before render. */
export function setAccountPort(port: AccountPort): void {
  installed = port;
}

/** The signed-in account, or null when the surface installed none. */
export function accountPort(): AccountPort | null {
  return installed;
}
