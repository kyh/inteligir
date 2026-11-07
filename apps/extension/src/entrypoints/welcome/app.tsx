// the page the extension opens once installed, and the popup's Manage connection and the browser's
// Options open again: whose library this browser saves to, with Disconnect, or the way to connect
// it, the site's page that hands it a credential. A failed connection says so in its own words,
// never a save's.

import { Button } from "@repo/ui/components/button";
import { Spinner } from "@repo/ui/components/spinner";
import { useEffect, useState } from "react";

import type { Status, WorkerAsks } from "../../messages";

export interface WelcomeProps {
  ask: Pick<WorkerAsks, "disconnect" | "status">;
}

const CONNECT_COPY = "Connect this browser to your Inteligir library to save to it.";
const UNREADABLE_COPY = "Couldn't read this browser's connection. Close this page and try again.";

const Connection = ({
  status,
  onDisconnect,
}: {
  status: Status | "unreadable" | null;
  onDisconnect: () => void;
}) => {
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
  if (status.connection === null) {
    return (
      <div className="flex flex-col items-start gap-3">
        <p className="text-subtitle text-foreground">{CONNECT_COPY}</p>
        <a
          className="text-subtitle text-foreground underline"
          href={status.connectUrl}
          rel="noreferrer"
          target="_blank"
        >
          Connect your library
        </a>
      </div>
    );
  }
  return (
    <div className="flex flex-col items-start gap-3">
      <p className="text-subtitle text-foreground">{`Saving to ${status.connection.email}'s library`}</p>
      <Button onClick={onDisconnect} size="compact" variant="tertiary">
        Disconnect
      </Button>
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
    // a connection made in another tab shows here when this one is looked at again
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
      <Connection
        onDisconnect={() => {
          void (async () => {
            setStatus((await ask.disconnect()) ?? "unreadable");
          })();
        }}
        status={status}
      />
      <p className="text-body text-muted-foreground">
        Click the Inteligir button in the toolbar to save the page you&rsquo;re on, or right-click a
        page, a link, an image or a selection. Everything you save lands in Unsorted.
      </p>
    </main>
  );
};
