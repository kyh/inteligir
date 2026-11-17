// The library's crash, which `app/(library)/error.tsx` draws in place of the workspace or Settings:
// it says what the crash left as it was, since whatever reached the library is safe there.

import { Button } from "@repo/ui/components/button";

interface RenderCrashProps {
  readonly error: unknown;
  readonly retry: () => void;
}

export const RenderCrash = ({ error, retry }: RenderCrashProps) => (
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
        <Button type="button" variant="secondary" size="compact" onClick={retry}>
          Try again
        </Button>
        <Button
          type="button"
          variant="secondary"
          size="compact"
          onClick={() => {
            window.location.reload();
          }}
        >
          Reload
        </Button>
      </div>
    </div>
  </div>
);
