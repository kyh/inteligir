// the toolbar's popup: it saves the tab it opened over as soon as it opens, says where the page
// landed, keeps a copy of the page on request, and opens the app. Every refusal is a sentence
// from outcome-copy.ts, never the host's own detail.

import { Button } from "@repo/ui/components/button";
import { Spinner } from "@repo/ui/components/spinner";
import { Switch } from "@repo/ui/components/switch";
import { useEffect, useState } from "react";
import type { ExtensionRequest, Outcome } from "../messages";
import { refusalCopy, savedCopy } from "../outcome-copy";

export interface PopupProps {
  // the tab the popup opened over, or null when there is none to save
  activeTabId: () => Promise<number | null>;
  ask: (request: ExtensionRequest) => Promise<Outcome>;
}

type CopyState = "off" | "keeping" | "kept";

const Headline = ({ outcome }: { outcome: Outcome | null }) => {
  if (outcome === null) {
    return (
      <p className="flex items-center gap-2 text-subtitle text-foreground">
        <Spinner />
        Saving…
      </p>
    );
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
  if (outcome.kind === "saved") {
    return (
      <div className="flex flex-col gap-1">
        <p className="text-subtitle text-foreground">{savedCopy(outcome.created)}</p>
        <p className="truncate text-body text-muted-foreground">{outcome.title}</p>
      </div>
    );
  }
  return null;
};

export const Popup = ({ activeTabId, ask }: PopupProps) => {
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [tabId, setTabId] = useState<number | null>(null);
  const [copy, setCopy] = useState<CopyState>("off");

  useEffect(() => {
    let live = true;
    const save = async () => {
      const id = await activeTabId();
      if (id === null) {
        if (live) {
          setOutcome({ detail: "", kind: "refused", reason: "unsupported-page" });
        }
        return;
      }
      const answer = await ask({ tabId: id, type: "save" });
      if (live) {
        setTabId(id);
        setOutcome(answer);
      }
    };
    void save();
    return () => {
      live = false;
    };
  }, [activeTabId, ask]);

  // a copy is kept once and stays: a save with it adds the copy to the item already there
  const keepCopy = async () => {
    if (tabId === null || copy !== "off") {
      return;
    }
    setCopy("keeping");
    const answer = await ask({ keepCopy: true, tabId, type: "save" });
    if (answer.kind === "refused") {
      setCopy("off");
      setOutcome(answer);
      return;
    }
    setCopy("kept");
  };

  const saved = outcome?.kind === "saved";

  return (
    <main className="flex w-80 flex-col gap-3 bg-background p-4 text-foreground">
      <Headline outcome={outcome} />
      {saved ? (
        <Switch
          checked={copy !== "off"}
          disabled={copy !== "off"}
          label="Keep a copy of the page"
          onCheckedChange={(checked) => {
            if (checked) {
              void keepCopy();
            }
          }}
        />
      ) : null}
      <Button
        onClick={() => {
          void ask({ type: "open-app" });
        }}
        size="compact"
        variant="tertiary"
      >
        Open Inteligir
      </Button>
    </main>
  );
};
