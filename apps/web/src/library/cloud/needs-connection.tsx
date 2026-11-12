// CLAUDE.md § A cell call pauses offline and says so. What a screen shows of a call only the cell
// answers (the agent and its Undo, imports and exports, the account) while it is not answered:
// with no connection TanStack Query pauses it rather than failing it, and the screen says it needs
// one; a refusal says its own sentence. A read says so where it would draw; a write, wherever it was
// asked from (a card's menu, a button, Settings), says so in one notice the page keeps up while
// any waits.

import { NEEDS_CONNECTION } from "@repo/contract/needs-connection";
import { refusalText } from "@repo/contract/refusal-text";
import { isOrpcError, NotFoundError } from "@repo/contract/v1/errors";
import { LoadingState } from "@repo/ui/ai/loading-state";
import { toast } from "@repo/ui/components/sonner";
import { onlineManager, useIsMutating } from "@tanstack/react-query";
import type { UseQueryResult } from "@tanstack/react-query";
import { useEffect, useSyncExternalStore } from "react";

const subscribeOnline = (listener: () => void): (() => void) => onlineManager.subscribe(listener);
const readOnline = (): boolean => onlineManager.isOnline();

// the browser's own word on its connection, which TanStack Query pauses its cell calls by
const useOnline = (): boolean => useSyncExternalStore(subscribeOnline, readOnline);

// a query's or an infinite query's state, as much of it as says where the answer stands
type CellRead<T> = Pick<UseQueryResult<T>, "data" | "error" | "fetchStatus">;

// where a read of the cell stands, as a screen says it: its answer once it has one, however it
// stands since; else that it needs a connection while it waits for one, whatever an earlier try
// met; else that the cell holds no such thing, or why the call failed; else that it is asked
export type CellStanding<T> =
  | { readonly kind: "answered"; readonly data: T }
  | { readonly kind: "needs-connection" }
  | { readonly kind: "missing"; readonly error: Error }
  | { readonly kind: "unreachable"; readonly error: Error }
  | { readonly kind: "loading" };

export const cellStanding = <T,>({ data, error, fetchStatus }: CellRead<T>): CellStanding<T> => {
  if (data !== undefined) {
    return { data, kind: "answered" };
  }
  if (fetchStatus === "paused") {
    return { kind: "needs-connection" };
  }
  if (error === null) {
    return { kind: "loading" };
  }
  return isOrpcError(error) && error.defined && error.code === NotFoundError.code
    ? { error, kind: "missing" }
    : { error, kind: "unreachable" };
};

export const CellAnswer = <T,>({
  query,
  failed,
  children,
}: {
  query: CellRead<T>;
  // what to say when the call failed with nothing of its own to say
  failed: string;
  children: (data: T) => React.ReactNode;
}): React.ReactNode => {
  const standing = cellStanding(query);
  switch (standing.kind) {
    case "answered": {
      return children(standing.data);
    }
    case "needs-connection": {
      return (
        <p className="m-0 px-3 py-2 text-body text-muted-foreground" data-needs-connection>
          {NEEDS_CONNECTION}
        </p>
      );
    }
    case "missing":
    case "unreachable": {
      return (
        <p className="m-0 px-3 py-2 text-body text-destructive">
          {refusalText(standing.error, failed)}
        </p>
      );
    }
    case "loading": {
      return <LoadingState className="px-3 py-2" label="Asking your library" />;
    }
    // no default
  }
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
