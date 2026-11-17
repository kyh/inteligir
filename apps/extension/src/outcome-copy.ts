// what the popup and the toolbar's badge say of how a save went, in one place. A refusal of the
// extension's own says what the person can do about it, and links where that is done; one the
// library made is said in the library's words.

import type { WaitsFor } from "@repo/contract/library/call-outcome";

import type { Outcome, OutcomeReason } from "./messages";

export interface OutcomeLine {
  readonly text: string;
  // the line links the site's page that signs this browser in, where signing in helps
  readonly signIn: boolean;
}

const REFUSAL_COPY = {
  "not-connected": { signIn: true, text: "Sign in to Inteligir to save" },
  "signed-out": { signIn: true, text: "Sign in to Inteligir again to save" },
  "unsupported-page": { signIn: false, text: "Inteligir can't save this kind of page" },
  "update-extension": { signIn: false, text: "Update this extension to save" },
  "too-large": { signIn: false, text: "This is too large to save" },
  "needs-connection": { signIn: false, text: "Saving this picture needs a connection" },
  failed: { signIn: false, text: "Couldn't save this page" },
} satisfies Record<OutcomeReason, OutcomeLine>;

const SAVED = "Saved to Unsorted";
const ALREADY_SAVED = "Already in your library";
const WAITING_COPY = {
  connection: { signIn: false, text: "Saved when you're back online" },
  "sign-in": { signIn: true, text: "Saved once you sign in to Inteligir again" },
  update: { signIn: false, text: "Saved once this extension updates" },
} satisfies Record<WaitsFor, OutcomeLine>;

export const outcomeLine = (outcome: Outcome): OutcomeLine => {
  switch (outcome.kind) {
    case "saved": {
      return { signIn: false, text: outcome.created ? SAVED : ALREADY_SAVED };
    }
    case "queued": {
      return WAITING_COPY[outcome.waitsFor];
    }
    case "refused": {
      return outcome.reason === "library"
        ? { signIn: false, text: outcome.message }
        : REFUSAL_COPY[outcome.reason];
    }
    // no default
  }
};
