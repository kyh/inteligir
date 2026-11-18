import type { agentViewContextSchema } from "@repo/contract/library/library-wire";
import type { z } from "zod";

type LibraryViewContext = Extract<z.infer<typeof agentViewContextSchema>, { surface: "library" }>;

export const TIDY_LABEL = "Tidy my library";

export const TIDY_PLACEHOLDER = "Anything the rules don't say…";

const TIDY_REQUEST =
  "Tidy my library: file and tag the items in Unsorted, and the items with no tags.";

export const TIDY_VIEW_CONTEXT = {
  itemIds: [],
  scope: { kind: "unsorted" },
  selected: 0,
  surface: "library",
} satisfies LibraryViewContext;

export const tidyMessage = (added: string) => {
  const words = added.trim();

  return words === "" ? TIDY_REQUEST : `${TIDY_REQUEST}\n\n${words}`;
};
