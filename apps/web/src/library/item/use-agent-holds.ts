import { followNoteEdits } from "@repo/client/agent-note-holds";
import type { OpenNote } from "@repo/editor/item/item-editor";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

import { usePageLibrary } from "../cloud/library-context";

export const useAgentHolds = (note: OpenNote | null) => {
  const queryClient = useQueryClient();
  const { wire } = usePageLibrary();
  useEffect(() => {
    if (note === null) {
      return;
    }

    return followNoteEdits(
      queryClient.getQueryCache(),
      wire.orpc.library.agent.events.key(),
      ({ callId, itemId, phase }) => {
        if (itemId !== note.itemId) {
          return;
        }

        if (phase === "started") {
          note.agentEditing(callId);
        } else {
          note.agentEdited(callId);
        }
      },
    );
  }, [note, queryClient, wire]);
};
