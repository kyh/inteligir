// Every library route's own `errorComponent`: a route's boundary is its own `errorComponent ??
// default`, so the layout's alone would leave each child unguarded, and the site's default is no
// library's. It says what the crash left as it was: whatever reached the library is safe there.

import type { ErrorComponentProps } from "@tanstack/react-router";

export const RenderCrash = ({ error, reset }: ErrorComponentProps) => (
  <div className="flex min-h-dvh items-center justify-center p-6">
    <div className="max-w-lg space-y-3">
      <h1 className="text-title font-medium">Something went wrong showing your library.</h1>
      <p className="text-subtitle text-muted-foreground">
        Anything that reached your library is safe there. Try again, or reload the page.
      </p>
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
