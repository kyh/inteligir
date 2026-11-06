// CLAUDE.md § A CELL CALL PAUSES OFFLINE AND SAYS SO. What a screen shows of a call only the cell
// answers (History, the agent, imports and exports, the account) while it is not answered: with no
// connection TanStack Query pauses it rather than failing it, and the screen says it needs one;
// a refusal says its own sentence. A read says so where it would draw; a write, wherever it was
// asked from (a card's menu, a button, Settings), says so in one notice the page keeps up while
// any waits. Spec §6, "Online only, said plainly in the UI".

import { refusalText } from "@repo/contract/cloud/refusal-text";
import { LoadingState } from "@repo/ui/ai/loading-state";
import { toast } from "@repo/ui/components/sonner";
import { onlineManager, useIsMutating } from "@tanstack/react-query";
import type { UseQueryResult } from "@tanstack/react-query";
import { useEffect, useSyncExternalStore } from "react";

export const NEEDS_CONNECTION = "Needs a connection";

const subscribeOnline = (listener: () => void): (() => void) => onlineManager.subscribe(listener);
const readOnline = (): boolean => onlineManager.isOnline();

// the browser's own word on its connection, which TanStack Query pauses its cell calls by
export const useOnline = (): boolean => useSyncExternalStore(subscribeOnline, readOnline);

export const CellAnswer = <T,>({
  query,
  failed,
  children,
}: {
  // a query's or an infinite query's state, as much of it as says where the answer stands
  query: Pick<UseQueryResult<T>, "data" | "error" | "fetchStatus" | "isError">;
  // what to say when the call failed with nothing of its own to say
  failed: string;
  children: (data: T) => React.ReactNode;
}): React.ReactNode => {
  if (query.data !== undefined) {
    return children(query.data);
  }
  if (query.fetchStatus === "paused") {
    return (
      <p className="m-0 px-3 py-2 text-body text-muted-foreground" data-needs-connection>
        {NEEDS_CONNECTION}
      </p>
    );
  }
  if (query.isError) {
    return (
      <p className="m-0 px-3 py-2 text-body text-destructive">{refusalText(query.error, failed)}</p>
    );
  }
  return <LoadingState className="px-3 py-2" label="Asking your library" variant="dots" />;
};

const PAUSED_NOTICE = "needs-connection";

// The one notice for every write to the cell asked while offline: up while any waits, gone once
// the connection returns and they go. Online, a write waiting behind another of its `scope` is
// paused too, so only the browser's word on the connection makes it the notice's.
export const PausedWrites = () => {
  const waiting = useIsMutating({ predicate: (mutation) => mutation.state.isPaused });
  const online = useOnline();
  const shown = waiting > 0 && !online;
  useEffect(() => {
    if (shown) {
      toast(NEEDS_CONNECTION, {
        description: "What you asked goes as soon as you're back online.",
        duration: Number.POSITIVE_INFINITY,
        id: PAUSED_NOTICE,
      });
    } else {
      toast.dismiss(PAUSED_NOTICE);
    }
  }, [shown]);
  return null;
};
