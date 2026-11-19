import { NEEDS_CONNECTION } from "@repo/contract/needs-connection";
import { refusalText } from "@repo/contract/rpc/refusal-text";
import { isOrpcError, NotFoundError } from "@repo/contract/rpc/v1-errors";
import { LoadingState } from "@repo/ui/ai/loading-state";
import { toast } from "@repo/ui/components/sonner";
import { onlineManager, useIsMutating } from "@tanstack/react-query";
import type { UseQueryResult } from "@tanstack/react-query";
import { useEffect, useSyncExternalStore } from "react";

const subscribeOnline = (listener: () => void) => onlineManager.subscribe(listener);
const readOnline = () => onlineManager.isOnline();

export const useOnline = () => useSyncExternalStore(subscribeOnline, readOnline);

type CellRead<T> = Pick<UseQueryResult<T>, "data" | "error" | "fetchStatus">;

export type CellStanding<T> =
  | { readonly kind: "answered"; readonly data: T }
  | { readonly kind: "needs-connection" }
  | { readonly kind: "missing"; readonly error: Error }
  | { readonly kind: "unreachable"; readonly error: Error }
  | { readonly kind: "loading" };

export const cellStanding = <T,>({ data, error, fetchStatus }: CellRead<T>) => {
  if (data !== undefined) {
    return { data, kind: "answered" } satisfies CellStanding<T>;
  }

  if (fetchStatus === "paused") {
    return { kind: "needs-connection" } satisfies CellStanding<T>;
  }

  if (error === null) {
    return { kind: "loading" } satisfies CellStanding<T>;
  }

  return (
    isOrpcError(error) && error.defined && error.code === NotFoundError.code
      ? { error, kind: "missing" }
      : { error, kind: "unreachable" }
  ) satisfies CellStanding<T>;
};

export const CellAnswer = <T,>({
  query,
  failed,
  children,
}: {
  query: CellRead<T>;
  failed: string;
  children: (data: T) => React.ReactNode;
}) => {
  const standing = cellStanding(query);

  switch (standing.kind) {
    case "answered": {
      return <>{children(standing.data)}</>;
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

    default: {
      throw new Error(`unexpected ${String(standing satisfies never)}`);
    }
  }
};

const PAUSED_NOTICE = "needs-connection";

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
