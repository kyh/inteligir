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

export type AccountPort = {
  /** The signed-in email, for display. */
  readonly email: string;
  /** End the session and take the user wherever signed-out belongs. */
  readonly signOut: () => Promise<void>;
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
