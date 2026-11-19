import { savesWaiting } from "@repo/client/waiting-saves";
import { Button } from "@repo/ui/components/button";
import { Spinner } from "@repo/ui/components/spinner";
import { Suspense, use, useState, useTransition } from "react";

import type { HeldSaves, Outcome, Status, WorkerAsks } from "../../messages";
import { outcomeLine } from "../../outcome-copy";

const UNSUPPORTED: Outcome = { kind: "refused", reason: "unsupported-page" };

interface OpenedSave {
  answer: Outcome;
  status: Status | null;
  held: HeldSaves;
}

const NONE_HELD: HeldSaves = { refused: [], waiting: 0 };

export const saveOpenedTab = async (
  activeTabId: () => Promise<number | null>,
  ask: Pick<WorkerAsks, "save" | "status" | "saves">,
) => {
  const tabId = await activeTabId();

  const [answer, status] = await Promise.all([
    tabId === null ? UNSUPPORTED : ask.save(tabId),
    ask.status(),
  ]);

  return { answer, held: (await ask.saves()) ?? NONE_HELD, status } satisfies OpenedSave;
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

const HeldSavesList = ({ ask, first }: { ask: RefusedAsks; first: HeldSaves }) => {
  const [held, setHeld] = useState(first);
  const [asking, startAsking] = useTransition();

  const act = (asked: () => Promise<HeldSaves | null>) => {
    startAsking(async () => {
      const left = await asked();

      if (left !== null) {
        setHeld(left);
      }
    });
  };

  if (held.refused.length === 0 && held.waiting === 0) {
    return null;
  }

  return (
    <section className="flex flex-col gap-3 border-t border-border pt-3">
      {held.refused.length === 0 ? null : (
        <>
          <h2 className="text-body text-muted-foreground">Didn&rsquo;t reach your library</h2>
          <ul className="flex flex-col gap-3">
            {held.refused.map((save) => (
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
        </>
      )}
      {held.waiting === 0 ? null : (
        <output className="text-body text-muted-foreground">{savesWaiting(held.waiting)}</output>
      )}
    </section>
  );
};

const Opened = ({ ask, opened }: PopupProps) => {
  const { answer, held, status } = use(opened);
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
      <HeldSavesList ask={ask} first={held} />
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
