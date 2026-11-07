// Wired as the router's `defaultErrorComponent`, not the root route's `errorComponent`: a route's
// boundary is its own `errorComponent ?? default`, so the root route alone would leave every child
// unguarded. It says what the crash left as it was: whatever reached the library is safe there,
// and what the tab had not sent yet lives only in it, so Try again keeps it and a reload, which
// the browser asks about first (`cloud/leave-guard.ts`), loses it.

import type { ErrorComponentProps } from "@tanstack/react-router";

import { useReplicaStatus } from "./cloud/library-context";

const unsentWords = (unsent: number): string => {
  if (unsent === 0) {
    return "Everything you changed has reached your library. Try again, or reload the page.";
  }
  const held = unsent === 1 ? "One change hasn't" : `${String(unsent)} changes haven't`;
  return `${held} reached your library yet. Try again keeps it; reloading the page now loses it.`;
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
