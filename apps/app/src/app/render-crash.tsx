// The last boundary. Everything in this app renders inside ONE route, so a
// component that throws takes the whole document with it — an unstyled blank
// page with the reason only in the console.
//
// It is wired as the ROUTER's `defaultErrorComponent`, not the root route's
// `errorComponent`, and that distinction is the whole point: a route's
// boundary is `route.options.errorComponent ?? router.options.
// defaultErrorComponent`, so declaring it on the root route alone would guard
// the root match and leave every child — the workspace included — with none.

import type { ErrorComponentProps } from "@tanstack/react-router";

export function RenderCrash({ error, reset }: ErrorComponentProps) {
  return (
    <div className="flex min-h-dvh items-center justify-center p-6">
      <div className="max-w-lg space-y-3">
        <h1 className="text-base font-medium">The workspace stopped rendering.</h1>
        <p className="text-sm text-muted-foreground">
          Your notes are files on disk and the local server is still running — nothing was lost.
        </p>
        <pre className="max-h-48 overflow-auto rounded border border-border bg-muted/40 p-3 font-mono text-xs whitespace-pre-wrap">
          {error instanceof Error ? (error.stack ?? error.message) : String(error)}
        </pre>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={reset}
            className="rounded border border-border px-3 py-1.5 text-sm hover:bg-muted"
          >
            Try again
          </button>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="rounded border border-border px-3 py-1.5 text-sm hover:bg-muted"
          >
            Reload
          </button>
        </div>
      </div>
    </div>
  );
}
