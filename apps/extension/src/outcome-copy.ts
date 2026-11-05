// what the popup, the welcome page and the toolbar's badge say about an answer, in one place. A
// refusal says what the person can do about it, and links where that is done.

import type { Outcome, OutcomeReason } from "./messages";

export interface OutcomeLine {
  readonly text: string;
  // where the line links, when somewhere can help: the site's page that connects this browser
  readonly connect: boolean;
}

const REFUSAL_COPY = {
  "not-connected": { connect: true, text: "Connect Inteligir to your library to save" },
  "signed-out": { connect: true, text: "Connect Inteligir to your library again to save" },
  "unsupported-page": { connect: false, text: "Inteligir can't save this kind of page" },
  "update-extension": { connect: false, text: "Update this extension to save" },
  "library-full": { connect: false, text: "Your library is full" },
  "too-large": { connect: false, text: "This is too large to save" },
  "needs-connection": { connect: false, text: "Saving this picture needs a connection" },
  failed: { connect: false, text: "Couldn't save this page" },
} satisfies Record<OutcomeReason, OutcomeLine>;

const SAVED = "Saved to Unsorted";
const ALREADY_SAVED = "Already in your library";
const QUEUED = "Saved when you're back online";

export const outcomeLine = (outcome: Outcome): OutcomeLine => {
  switch (outcome.kind) {
    case "saved": {
      return { connect: false, text: outcome.created ? SAVED : ALREADY_SAVED };
    }
    case "queued": {
      return { connect: false, text: QUEUED };
    }
    case "refused": {
      return REFUSAL_COPY[outcome.reason];
    }
    case "status": {
      return outcome.connection === null
        ? REFUSAL_COPY["not-connected"]
        : { connect: false, text: `Saving to ${outcome.connection.email}'s library` };
    }
    // no default
  }
};
