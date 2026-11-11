// the page the extension opens once installed, and the browser's Options opens again: whose library
// this browser saves to, as the browser is signed in on the site, or the way to sign in. The
// extension has no sign-out of its own: signing out on the site signs it out too. A status it could
// not read says so in its own words, never a save's.

import { Spinner } from "@repo/ui/components/spinner";
import { useEffect, useState } from "react";

import type { Status, WorkerAsks } from "../../messages";

export interface WelcomeProps {
  ask: Pick<WorkerAsks, "status">;
}

const SIGN_IN_COPY = "Sign in to Inteligir in this browser to save to your library.";
const SIGNED_IN_COPY = "Signing out of Inteligir in this browser signs this extension out too.";
const UNREADABLE_COPY = "Couldn't read whose library this is. Close this page and try again.";

const Account = ({ status }: { status: Status | "unreadable" | null }) => {
  if (status === null) {
    return (
      <p className="flex items-center gap-2 text-subtitle text-muted-foreground">
        <Spinner />
        Looking for your library…
      </p>
    );
  }
  if (status === "unreadable") {
    return (
      <p className="text-subtitle text-foreground" role="alert">
        {UNREADABLE_COPY}
      </p>
    );
  }
  if (status.account === null) {
    return (
      <div className="flex flex-col items-start gap-3">
        <p className="text-subtitle text-foreground">{SIGN_IN_COPY}</p>
        <a
          className="text-subtitle text-foreground underline"
          href={status.signInUrl}
          rel="noreferrer"
          target="_blank"
        >
          Sign in to Inteligir
        </a>
      </div>
    );
  }
  return (
    <div className="flex flex-col items-start gap-3">
      <p className="text-subtitle text-foreground">{`Saving to ${status.account.email}'s library`}</p>
      <a
        className="text-subtitle text-foreground underline"
        href={status.account.libraryUrl}
        rel="noreferrer"
        target="_blank"
      >
        Open your library
      </a>
      <p className="text-body text-muted-foreground">{SIGNED_IN_COPY}</p>
    </div>
  );
};

export const Welcome = ({ ask }: WelcomeProps) => {
  const [status, setStatus] = useState<Status | "unreadable" | null>(null);

  useEffect(() => {
    let live = true;
    const look = async () => {
      const answer = (await ask.status()) ?? "unreadable";
      if (live) {
        setStatus(answer);
      }
    };
    void look();
    // a sign-in or sign-out in another tab shows here when this one is looked at again
    const again = () => {
      if (document.visibilityState === "visible") {
        void look();
      }
    };
    document.addEventListener("visibilitychange", again);
    return () => {
      live = false;
      document.removeEventListener("visibilitychange", again);
    };
  }, [ask]);

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-4 bg-background p-8 text-foreground">
      <h1 className="text-display">Save to Inteligir</h1>
      <Account status={status} />
      <p className="text-body text-muted-foreground">
        Click the Inteligir button in the toolbar to save the page you&rsquo;re on, or right-click a
        page, a link or an image. Everything you save lands in Unsorted.
      </p>
    </main>
  );
};
