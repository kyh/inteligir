// What a person reads when the Mac's shell could not do what the page asked: a sentence of the
// page's for each kind of trouble they can do something about, and the screen's own fallback for
// the rest, never the words of the error itself (`shell/shell-error.ts`).

import { ShellError } from "../../shell/shell-error";

const KEYCHAIN =
  "Your Mac's Keychain didn't let Inteligir in. Unlock it, or choose Allow when your Mac asks, then try again.";
const REPLICA = "The copy of your library on this Mac couldn't be opened.";
const SIGN_OUT_FAILED = "This Mac couldn't sign out. Try again.";

export const shellTroubleText = (cause: unknown, fallback: string): string => {
  if (!(cause instanceof ShellError)) {
    return fallback;
  }
  switch (cause.kind) {
    case "keychain": {
      return KEYCHAIN;
    }
    case "io":
    case "sql": {
      return REPLICA;
    }
    case "bridge":
    case "invalid":
    case "missing":
    case "signed-out":
    case "transaction-gone": {
      return fallback;
    }
    // no default
  }
};

// a sign-out the shell could not finish: the Keychain's sentence when it refused, else that the
// sign-out itself failed, since what else stopped it (the copy's folder, its files) is no opening
export const signOutTroubleText = (cause: unknown): string =>
  cause instanceof ShellError && cause.kind === "keychain" ? KEYCHAIN : SIGN_OUT_FAILED;
