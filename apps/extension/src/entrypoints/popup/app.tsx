// the toolbar's popup: it saves the tab it opened over as soon as it opens and says how that went,
// in outcome-copy.ts's sentences, never the cloud's own words; a browser not signed in is pointed at
// the site's page that signs it in, and a signed-in one says as whom and links its library. The
// popup's whole life is that one save, so it is a promise the page makes as it loads (main.tsx) and
// the popup reads, never an effect React may run twice.

import { Spinner } from "@repo/ui/components/spinner";
import { Suspense, use } from "react";

import type { Outcome, Status, WorkerAsks } from "../../messages";
import { outcomeLine } from "../../outcome-copy";

const UNSUPPORTED: Outcome = { kind: "refused", reason: "unsupported-page" };

// what saving the tab answered, with where the library is, asked beside the save
interface OpenedSave {
  answer: Outcome;
  status: Status | null;
}

// `activeTabId` answers the tab the popup opened over, or null when there is none to save
export const saveOpenedTab = async (
  activeTabId: () => Promise<number | null>,
  ask: Pick<WorkerAsks, "save" | "status">,
): Promise<OpenedSave> => {
  const tabId = await activeTabId();
  const [answer, status] = await Promise.all([
    tabId === null ? UNSUPPORTED : ask.save(tabId),
    ask.status(),
  ]);
  return { answer, status };
};

export interface PopupProps {
  opened: Promise<OpenedSave>;
}

const Saving = () => (
  <p className="flex items-center gap-2 text-subtitle text-foreground">
    <Spinner />
    Saving…
  </p>
);

const Headline = ({ outcome, status }: { outcome: Outcome; status: Status | null }) => {
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

const Opened = ({ opened }: PopupProps) => {
  const { answer, status } = use(opened);
  const account = status?.account ?? null;
  return (
    <>
      <Headline outcome={answer} status={status} />
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
    </>
  );
};

export const Popup = ({ opened }: PopupProps) => (
  <main className="flex w-80 flex-col gap-3 bg-background p-4 text-foreground">
    <Suspense fallback={<Saving />}>
      <Opened opened={opened} />
    </Suspense>
  </main>
);
