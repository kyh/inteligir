// Wired as the router's `defaultErrorComponent`, not the root route's `errorComponent`: a route's
// boundary is its own `errorComponent ?? default`, so the root route alone would leave every child
// unguarded. It says what the crash left as it was: whatever reached the library is safe there,
// what the tab had not sent yet lives only in it, so Try again keeps it and a reload, which the
// browser asks about first (`cloud/leave-guard.ts`), loses it, and what the Mac had not sent waits
// on its disk through either.

import type { ErrorComponentProps } from "@tanstack/react-router";

import { underShell } from "../shell/shell-commands";
import { useReplicaStatus } from "./cloud/library-context";

const unsentWords = (unsent: number): string => {
  if (unsent === 0) {
    return "Everything you changed has reached your library. Try again, or reload the page.";
  }
  const [held, them] =
    unsent === 1 ? ["One change hasn't", "it"] : [`${String(unsent)} changes haven't`, "them"];
  return underShell()
    ? `${held} reached your library yet, and this Mac keeps ${them} either way. Try again, or reload the page.`
    : `${held} reached your library yet. Try again keeps ${them}; reloading the page now loses ${them}.`;
};

export const RenderCrash = ({ error, reset }: ErrorComponentProps) => {
  const { unsent } = useReplicaStatus();
  return (
    <div className="flex min-h-dvh items-center justify-center p-6" data-tauri-drag-region>
      <div className="max-w-lg space-y-3">
        <h1 className="text-title font-medium">Something went wrong showing your library.</h1>
        <p className="text-subtitle text-muted-foreground">{unsentWords(unsent)}</p>
        <pre className="max-h-48 overflow-auto rounded border border-border bg-muted/40 p-3 font-mono text-body whitespace-pre-wrap select-text">
          {error instanceof Error ? (error.stack ?? error.message) : String(error)}
        </pre>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={reset}
            className="rounded border border-border px-3 py-1.5 text-subtitle hover:bg-muted"
          >
            Try again
          </button>
          <button
            type="button"
            onClick={() => {
              window.location.reload();
            }}
            className="rounded border border-border px-3 py-1.5 text-subtitle hover:bg-muted"
          >
            Reload
          </button>
        </div>
      </div>
    </div>
  );
};
