// CLAUDE.md § A CELL CALL PAUSES OFFLINE AND SAYS SO. What a screen shows of a call only the cell
// answers (History, the agent, imports and exports, the account) while it is not answered: with no
// connection TanStack Query pauses it rather than failing it, and the screen says it needs one;
// a refusal says its own sentence. Spec §6, "Online only, said plainly in the UI".

import type { UseQueryResult } from "@tanstack/react-query";

export const NEEDS_CONNECTION = "Needs a connection";

export const refusalText = (cause: unknown, fallback: string): string =>
  cause instanceof Error && cause.message.length > 0 ? cause.message : fallback;

export const CellAnswer = <T,>({
  query,
  failed,
  children,
}: {
  query: UseQueryResult<T>;
  // what to say when the call failed with nothing of its own to say
  failed: string;
  children: (data: T) => React.ReactNode;
}) => {
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
  return <p className="m-0 px-3 py-2 text-body text-muted-foreground">Loading…</p>;
};
