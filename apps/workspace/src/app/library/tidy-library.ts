// CLAUDE.md § A NAMED ACTION IS A PRESET ON THE SEND (apps/cli/src/server/agents/CLAUDE.md): Tidy my
// library is the composer opened on a preset, never a prompt typed into its field. The server
// composes the procedure; what rides the send is the preset, whatever the person added, and the
// library's view of Unsorted, so the thread's attribution says where it was asked from.

import { ACTION_PRESET_LABELS } from "@repo/domain/action-preset";
import type { ActionPreset } from "@repo/domain/action-preset";
import type { LibraryViewContext } from "@repo/domain/view-context";
import type { VaultActions } from "@repo/editor/host-io";
import { LIBRARY_RULES_PATH } from "@repo/notes/items/item-kind";
import type { RefObject } from "react";

import { FILING_RULES_TEXT } from "./filing-rules";

const TIDY_PRESET: ActionPreset = "tidy-library";

export const TIDY_LABEL = ACTION_PRESET_LABELS[TIDY_PRESET];

// the field beside the preset's chip: what the person adds to the rules for this one run
export const TIDY_PLACEHOLDER = "Anything the rules don't say…";

export const TIDY_VIEW_CONTEXT: LibraryViewContext = {
  paths: [],
  scope: { kind: "unsorted" },
  selected: 0,
  surface: "library",
};

export interface TidyEntry {
  // opens ⌘K on the preset's chip
  startTidy: () => void;
  // opens the library's filing rules, writing the starter rules first when it has none
  editFilingRules: () => void;
}

interface TidyEntryDeps {
  openComposer: (preset: ActionPreset) => void;
  // the session's verbs, read when a press runs: createFileAt creates without opening, and a
  // file already there counts as made
  actions: RefObject<Pick<VaultActions, "createFileAt"> | null>;
  openItem: (path: string) => void;
}

// a hook only so the session's ref may ride it: it reads the ref in a press, never in render
export const useTidyEntry = ({ openComposer, actions, openItem }: TidyEntryDeps): TidyEntry => ({
  editFilingRules: () => {
    void (async () => {
      const made = await actions.current?.createFileAt(LIBRARY_RULES_PATH, FILING_RULES_TEXT);
      if (made !== null && made !== undefined) {
        openItem(made);
      }
    })();
  },
  startTidy: () => {
    openComposer(TIDY_PRESET);
  },
});
