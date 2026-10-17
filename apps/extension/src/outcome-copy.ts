// what the popup, the welcome page and the toolbar's badge say about an answer, in one place

import { PRODUCTION_CLOUD_ORIGIN } from "@repo/contract/cloud/origin";
import type { OutcomeReason } from "./messages";

const SAVED_COPY = "Saved to Unsorted";
const ALREADY_SAVED_COPY = "Already in your library";

export interface RefusalCopy {
  text: string;
  // where the line links, when somewhere can help
  href: string | null;
}

const REFUSAL_COPY = {
  // no app on this computer answers: the line is the way to get one
  absent: { href: PRODUCTION_CLOUD_ORIGIN, text: "Get Inteligir for Mac" },
  "app-unavailable": { href: null, text: "Couldn't reach Inteligir. Open it and try again" },
  failed: { href: null, text: "Couldn't save this page" },
  "not-set-up": { href: null, text: "Open Inteligir to finish setting up" },
  "too-large": { href: null, text: "Bigger than 10 MB, the most Inteligir keeps" },
  "unsupported-page": { href: null, text: "Inteligir can't save this kind of page" },
  "update-app": { href: null, text: "Update Inteligir to save from this browser" },
  "update-extension": { href: null, text: "Update this extension to save" },
} satisfies Record<OutcomeReason, RefusalCopy>;

export const refusalCopy = (reason: OutcomeReason): RefusalCopy => REFUSAL_COPY[reason];

export const savedCopy = (created: boolean): string => (created ? SAVED_COPY : ALREADY_SAVED_COPY);
