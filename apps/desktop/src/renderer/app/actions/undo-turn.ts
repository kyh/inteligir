// the shell's one way to take an agent turn back, which the finish toast and each reply's footer
// both run, and the one wording of what came back and what was left.

import type {
  TurnChanges,
  UndoKeptReason,
  UndoTurnRequest,
  UndoTurnResponse,
} from "@repo/api/local/threads/threads-schema";
import { flushOpenNote } from "@repo/editor/note/open-note-flush";
import { isVaultMetadataPath } from "@repo/notes/knowledge/doc-file";
import { toast } from "@repo/ui/components/sonner";
import { plural } from "@repo/ui/lib/plural";
import { isDefinedError, refusalMessage, safe } from "../api";
import type { client } from "../api";

export interface UndoTurnApi {
  threads: Pick<(typeof client)["threads"], "undoTurn">;
}

type UndoTurnOutcome =
  | { kind: "undone"; changes: UndoTurnResponse }
  | { kind: "refused"; message: string };

// a turn's commit can carry comment stores and other dot-entries; what it changed is its notes.
export const turnNotePaths = (turn: TurnChanges): string[] =>
  turn.paths.filter((path) => !isVaultMetadataPath(path));

const UNDO_REFUSED = "The agent's changes could not be undone.";

// the open note lands first, so a line still inside the autosave debounce is in the bytes the undo
// merges around rather than typed over by it. never rejects.
export const undoTurnChanges = async (
  api: UndoTurnApi,
  request: UndoTurnRequest,
): Promise<UndoTurnOutcome> => {
  await flushOpenNote();
  const [error, changes] = await safe(api.threads.undoTurn(request));
  if (changes !== undefined) {
    return { changes, kind: "undone" };
  }
  // CONFLICT is a turn still running or one undone already: nothing to take back right now.
  if (isDefinedError(error) && error.code === "CONFLICT") {
    return {
      kind: "refused",
      message: "Nothing to undo: the agent is still working, or these changes were undone already.",
    };
  }
  if (isDefinedError(error) && error.code === "NOT_FOUND") {
    return {
      kind: "refused",
      message: "These changes were not made on this device, so they can't be undone here.",
    };
  }
  return { kind: "refused", message: refusalMessage(error, UNDO_REFUSED) };
};

const KEPT_BECAUSE = {
  busy: "the agent is working on it",
  "deleted-since": "deleted since",
  "edited-since": "edited since",
  "recreated-since": "made again since",
  unreadable: "too large, or not text",
} satisfies Record<UndoKeptReason, string>;

interface UndoSummary {
  tone: "success" | "warning";
  message: string;
  // the one note left as it was, while it is still there to open: its History holds the version
  // from before the agent's change
  historyPath: string | null;
}

export const summarizeUndo = (changes: UndoTurnResponse): UndoSummary => {
  const { kept, reverted } = changes;
  const undid =
    reverted.length > 0 ? `Undid the agent's changes to ${plural(reverted.length, "note")}.` : null;
  const [only] = kept;
  if (only === undefined) {
    return {
      historyPath: null,
      message: undid ?? "The notes were already as they were before the agent's changes.",
      tone: "success",
    };
  }
  const left =
    kept.length === 1
      ? `Left ${only.path} as it is: ${KEPT_BECAUSE[only.reason]}.`
      : `Left ${plural(kept.length, "note")} as they are: ${kept
          .map((row) => `${row.path} (${KEPT_BECAUSE[row.reason]})`)
          .join(", ")}.`;
  return {
    historyPath: kept.length === 1 && only.reason !== "deleted-since" ? only.path : null,
    message: `${undid ?? "Nothing was undone."} ${left}`,
    tone: "warning",
  };
};

export const reportUndo = (outcome: UndoTurnOutcome, showHistory: (path: string) => void): void => {
  if (outcome.kind === "refused") {
    toast.error(outcome.message);
    return;
  }
  const { historyPath, message, tone } = summarizeUndo(outcome.changes);
  toast[tone](
    message,
    historyPath === null
      ? undefined
      : {
          action: {
            label: "Open History",
            onClick: () => {
              showHistory(historyPath);
            },
          },
        },
  );
};
