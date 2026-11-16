// the toolbar's popup: it saves the tab it opened over as soon as it opens and says how that went,
// in outcome-copy.ts's sentences or, for a save the library refused, the library's own words; a
// browser not signed in is pointed at the site's page that signs it in, and a signed-in one says as
// whom and links its library. Under them it lists the saves the library refused, each to try again
// or let go. The popup's opening is one save, so it is a promise the page makes as it loads
// (main.tsx) and the popup reads, never an effect React may run twice.

import { Button } from "@repo/ui/components/button";
import { Spinner } from "@repo/ui/components/spinner";
import { Suspense, use, useState, useTransition } from "react";

import type { Outcome, RefusedSave, Status, WorkerAsks } from "../../messages";
import { outcomeLine } from "../../outcome-copy";

const UNSUPPORTED: Outcome = { kind: "refused", reason: "unsupported-page" };

// what saving the tab answered, with where the library is, asked beside the save, and the saves
// the library refused
interface OpenedSave {
  answer: Outcome;
  status: Status | null;
  refused: readonly RefusedSave[];
}

// `activeTabId` answers the tab the popup opened over, or null when there is none to save
export const saveOpenedTab = async (
  activeTabId: () => Promise<number | null>,
  ask: Pick<WorkerAsks, "save" | "status" | "refused">,
): Promise<OpenedSave> => {
  const tabId = await activeTabId();
  const [answer, status] = await Promise.all([
    tabId === null ? UNSUPPORTED : ask.save(tabId),
    ask.status(),
  ]);
  // asked once the save has settled, since one the library just refused is among them
  return { answer, refused: (await ask.refused()) ?? [], status };
};

type RefusedAsks = Pick<WorkerAsks, "retry" | "discard">;

export interface PopupProps {
  ask: RefusedAsks;
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

const RefusedSaves = ({ ask, first }: { ask: RefusedAsks; first: readonly RefusedSave[] }) => {
  const [saves, setSaves] = useState(first);
  const [asking, startAsking] = useTransition();
  // the worker answers the list as the ask left it; one it could not read leaves the list as shown
  const act = (asked: () => Promise<readonly RefusedSave[] | null>) => {
    startAsking(async () => {
      const left = await asked();
      if (left !== null) {
        setSaves(left);
      }
    });
  };
  if (saves.length === 0) {
    return null;
  }
  return (
    <section className="flex flex-col gap-3 border-t border-border pt-3">
      <h2 className="text-body text-muted-foreground">Didn&rsquo;t reach your library</h2>
      <ul className="flex flex-col gap-3">
        {saves.map((save) => (
          <li className="flex flex-col gap-1" key={save.opId}>
            <p className="truncate text-body text-foreground">{save.name}</p>
            <p className="text-body text-muted-foreground">{save.message}</p>
            <div className="flex gap-2">
              <Button
                disabled={asking}
                variant="tertiary"
                onClick={() => {
                  act(async () => await ask.retry(save.opId));
                }}
              >
                Try again
              </Button>
              <Button
                disabled={asking}
                variant="ghost"
                onClick={() => {
                  act(async () => await ask.discard(save.opId));
                }}
              >
                Let it go
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
};

const Opened = ({ ask, opened }: PopupProps) => {
  const { answer, refused, status } = use(opened);
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
      <RefusedSaves ask={ask} first={refused} />
    </>
  );
};

export const Popup = ({ ask, opened }: PopupProps) => (
  <main className="flex w-80 flex-col gap-3 bg-background p-4 text-foreground">
    <Suspense fallback={<Saving />}>
      <Opened ask={ask} opened={opened} />
    </Suspense>
  </main>
);
