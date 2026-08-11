import { useCallback, useEffect } from "react";

import { backTarget, forwardTarget, useOpenNote } from "@repo/editor/note/open-note-store";
import { useVaultActions } from "@repo/editor/host";

export type NavHistory = {
  /** null when there is nowhere to go — the button is disabled, not hidden. */
  back: string | null;
  forward: string | null;
  goBack: () => void;
  goForward: () => void;
};

/**
 * Back / Forward over the notes this session has opened, plus their Alt+Arrow
 * keys. Mounted ONCE (the header), because the key listener is global.
 *
 * A move is just `openFile` on a remembered path: the open-note store
 * recognizes it as a history move by value when the path lands, so a
 * navigation the session refuses (an unsaved note blocks the switch) leaves
 * the stacks exactly where they were.
 */
export function useNavHistory(): NavHistory {
  const { openFile } = useVaultActions();
  const back = useOpenNote(backTarget);
  const forward = useOpenNote(forwardTarget);

  const goBack = useCallback(() => {
    if (back !== null) openFile(back);
  }, [back, openFile]);
  const goForward = useCallback(() => {
    if (forward !== null) openFile(forward);
  }, [forward, openFile]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.altKey || e.metaKey || e.ctrlKey || e.shiftKey) return;
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        goBack();
      }
      if (e.key === "ArrowRight") {
        e.preventDefault();
        goForward();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [goBack, goForward]);

  return { back, forward, goBack, goForward };
}
