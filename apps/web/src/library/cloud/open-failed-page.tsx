// The page when the library could not open at all, with nothing else drawn yet: the site or the
// connection failed, and the page holds nothing to let go, so it says so and offers Try again.

import { Button } from "@repo/ui/components/button";

const HEADING = "Your library didn't open";
const OPEN_FAILED = "Your library couldn't be reached. Check your connection and try again.";

export const OpenFailedPage = ({ reload }: { reload: () => void }) => (
  <main className="flex min-h-dvh items-center justify-center p-8">
    <div className="flex w-full max-w-sm flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h1 className="m-0 text-display font-semibold">{HEADING}</h1>
        <p className="m-0 text-body text-muted-foreground">{OPEN_FAILED}</p>
      </div>
      <Button type="button" size="default" className="self-start" onClick={reload}>
        Try again
      </Button>
    </div>
  </main>
);
