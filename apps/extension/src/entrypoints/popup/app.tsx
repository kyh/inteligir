// the toolbar's popup: it saves the tab it opened over as soon as it opens and says how that went,
// in outcome-copy.ts's sentences, never the cloud's own words; a browser not signed in is pointed at
// the site's page that signs it in, and a signed-in one says as whom and links its library.

import { Spinner } from "@repo/ui/components/spinner";
import { useEffect, useRef, useState } from "react";

import type { Outcome, Status, WorkerAsks } from "../../messages";
import { outcomeLine } from "../../outcome-copy";

export interface PopupProps {
  // the tab the popup opened over, or null when there is none to save
  activeTabId: () => Promise<number | null>;
  ask: Pick<WorkerAsks, "save" | "status">;
}

const Headline = ({ outcome, status }: { outcome: Outcome | null; status: Status | null }) => {
  if (outcome === null) {
    return (
      <p className="flex items-center gap-2 text-subtitle text-foreground">
        <Spinner />
        Saving…
      </p>
    );
  }
  const line = outcomeLine(outcome);
  if (line.signIn && status !== null) {
    return (
      <a
        className="text-subtitle text-foreground underline"
        href={status.signInUrl}
        rel="noreferrer"
        target="_blank"
      >
        {line.text}
      </a>
    );
  }
  if (outcome.kind === "saved") {
    return (
      <div className="flex flex-col gap-1">
        <p className="text-subtitle text-foreground">{line.text}</p>
        <p className="truncate text-body text-muted-foreground">{outcome.title}</p>
      </div>
    );
  }
  return (
    <p
      className="text-subtitle text-foreground"
      role={outcome.kind === "refused" ? "alert" : "status"}
    >
      {line.text}
    </p>
  );
};

const UNSUPPORTED: Outcome = { kind: "refused", reason: "unsupported-page" };

// what saving the tab answered, with where the library is, asked beside the save
interface OpenedSave {
  answer: Outcome;
  status: Status | null;
}

const saveOpenedTab = async (
  activeTabId: PopupProps["activeTabId"],
  ask: PopupProps["ask"],
): Promise<OpenedSave> => {
  const tabId = await activeTabId();
  const [answer, status] = await Promise.all([
    tabId === null ? UNSUPPORTED : ask.save(tabId),
    ask.status(),
  ]);
  return { answer, status };
};

export const Popup = ({ activeTabId, ask }: PopupProps) => {
  const [opened, setOpened] = useState<OpenedSave | null>(null);

  // the save opening the popup asks for, started once: StrictMode runs this effect twice in a
  // development build, and a second save of the tab would answer that it was already saved
  const opening = useRef<Promise<OpenedSave> | null>(null);

  useEffect(() => {
    let live = true;
    const save = opening.current ?? saveOpenedTab(activeTabId, ask);
    opening.current = save;
    const show = async () => {
      const answered = await save;
      if (live) {
        setOpened(answered);
      }
    };
    void show();
    return () => {
      live = false;
    };
  }, [activeTabId, ask]);

  const account = opened?.status?.account ?? null;

  return (
    <main className="flex w-80 flex-col gap-3 bg-background p-4 text-foreground">
      <Headline outcome={opened?.answer ?? null} status={opened?.status ?? null} />
      {account === null ? null : (
        <>
          <p className="truncate text-body text-muted-foreground">{`Signed in as ${account.email}`}</p>
          <a
            className="text-body text-muted-foreground underline"
            href={account.libraryUrl}
            rel="noreferrer"
            target="_blank"
          >
            Open your library
          </a>
        </>
      )}
    </main>
  );
};
