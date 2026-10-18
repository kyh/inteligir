// the page the extension opens once installed: it says hello to the Mac's app and names the
// library it reached, or links the download when no app answers.

import { Spinner } from "@repo/ui/components/spinner";
import { useEffect, useState } from "react";
import type { ExtensionRequest, Outcome } from "@/messages";
import { refusalCopy } from "@/outcome-copy";

export interface WelcomeProps {
  ask: (request: ExtensionRequest) => Promise<Outcome>;
}

const Status = ({ outcome }: { outcome: Outcome | null }) => {
  if (outcome === null) {
    return (
      <p className="flex items-center gap-2 text-subtitle text-muted-foreground">
        <Spinner />
        Looking for Inteligir on this Mac…
      </p>
    );
  }
  if (outcome.kind === "hello") {
    return <p className="text-subtitle text-foreground">Connected to {outcome.library}</p>;
  }
  if (outcome.kind === "refused") {
    const copy = refusalCopy(outcome.reason);
    return copy.href === null ? (
      <p className="text-subtitle text-foreground" role="alert">
        {copy.text}
      </p>
    ) : (
      <a
        className="text-subtitle text-foreground underline"
        href={copy.href}
        rel="noreferrer"
        target="_blank"
      >
        {copy.text}
      </a>
    );
  }
  return null;
};

export const Welcome = ({ ask }: WelcomeProps) => {
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  useEffect(() => {
    let live = true;
    const hello = async () => {
      const answer = await ask({ type: "hello" });
      if (live) {
        setOutcome(answer);
      }
    };
    void hello();
    return () => {
      live = false;
    };
  }, [ask]);

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-4 bg-background p-8 text-foreground">
      <h1 className="text-display">Save to Inteligir</h1>
      <Status outcome={outcome} />
      <p className="text-body text-muted-foreground">
        Click the Inteligir button in the toolbar to save the page you&rsquo;re on, or right-click a
        page, a link, an image or a selection. Everything you save lands in Unsorted.
      </p>
    </main>
  );
};
