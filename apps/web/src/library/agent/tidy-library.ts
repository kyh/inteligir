// CLAUDE.md § Tidy my library is a request from Unsorted. "Tidy my library" opens a new
// conversation on a fixed request, sent from Unsorted with whatever the person adds for this one
// run; the person's filing rules are no part of it, since every turn carries the rules the cell
// read for it, so the request never says whether the library has any.

import type { agentViewContextSchema } from "@repo/contract/library/library-wire";
import type { z } from "zod";

type LibraryViewContext = Extract<z.infer<typeof agentViewContextSchema>, { surface: "library" }>;

export const TIDY_LABEL = "Tidy my library";

// what the person adds beside the request, for this run alone
export const TIDY_PLACEHOLDER = "Anything the rules don't say…";

const TIDY_REQUEST =
  "Tidy my library: file and tag the items in Unsorted, and the items with no tags.";

// the screen a Tidy is asked from, whatever the grid shows: the items it is about
export const TIDY_VIEW_CONTEXT = {
  itemIds: [],
  scope: { kind: "unsorted" },
  selected: 0,
  surface: "library",
} satisfies LibraryViewContext;

// the message a Tidy sends: the request, then what the person added, when they added anything
export const tidyMessage = (added: string): string => {
  const words = added.trim();
  return words === "" ? TIDY_REQUEST : `${TIDY_REQUEST}\n\n${words}`;
};
