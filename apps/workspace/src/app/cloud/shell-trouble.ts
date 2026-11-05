// What a person reads when the Mac's shell could not do what the page asked: a sentence of the
// page's for each kind of trouble they can do something about, and the screen's own fallback for
// the rest, never the words of the error itself (`shell/shell-error.ts`).

import { ShellError } from "../../shell/shell-error";

const KEYCHAIN =
  "Your Mac's Keychain didn't let Inteligir in. Unlock it, or choose Allow when your Mac asks, then try again.";
const REPLICA = "The copy of your library on this Mac couldn't be opened.";

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
    case "network":
    case "signed-out":
    case "transaction-gone": {
      return fallback;
    }
    // no default
  }
};
