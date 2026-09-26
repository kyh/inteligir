// The one choice made before any server exists: a new vault, or a folder of notes the user already
// has, taken as plain markdown where it is. Main picks every folder and plans the boot, so this page
// names only what main handed it and shows main's refusal in main's words.

import { Button } from "@repo/ui/components/button";
import { Input } from "@repo/ui/components/input";
import { Label } from "@repo/ui/components/label";
import { RadioGroup, RadioGroupItem } from "@repo/ui/components/radio-group";
import { useId, useState } from "react";
import { outsideSyncWarning, ownSyncLine, vaultNameProblem } from "../../first-run-state";
import type { FirstRunChoice, FirstRunState, FolderFacts } from "../../first-run-state";
import type { FirstRunBridge } from "../../types";

type VaultMode = "create" | "open";

const MODES: readonly { value: VaultMode; label: string }[] = [
  { label: "Create a new vault", value: "create" },
  { label: "Open a folder", value: "open" },
];

interface PickedFolder {
  path: string;
  facts: FolderFacts;
}

// a throw across the bridge is a fault Electron words itself, so the page says its own sentence
const BRIDGE_FAILED = "Inteligir did not answer. Try again.";

const noteCountLine = ({ capped, count }: FolderFacts["noteCount"]): string => {
  if (capped) {
    return `More than ${count.toLocaleString()} notes`;
  }
  if (count === 0) {
    return "No notes in it yet";
  }
  return count === 1 ? "1 note" : `${count.toLocaleString()} notes`;
};

const FolderFactsView = ({ facts }: { facts: FolderFacts }) => {
  const warning = facts.externalSync === null ? null : outsideSyncWarning(facts.externalSync);
  return (
    <div className="space-y-2">
      <p className="text-body text-muted-foreground">{noteCountLine(facts.noteCount)}</p>
      {warning === null ? null : (
        <div role="note" className="rounded-md border border-border bg-muted/50 px-3 py-2">
          <p className="text-body font-medium">{warning.headline}</p>
          <p className="text-body text-muted-foreground">{warning.detail}</p>
        </div>
      )}
      {facts.ownSync === null ? null : (
        <p className="text-body text-muted-foreground">{ownSyncLine(facts.ownSync)}</p>
      )}
    </div>
  );
};

export interface VaultStepProps {
  bridge: FirstRunBridge;
  proposal: FirstRunState["newVault"];
}

export const VaultStep = ({ bridge, proposal }: VaultStepProps) => {
  const nameId = useId();
  const [mode, setMode] = useState<VaultMode>("create");
  const [name, setName] = useState(proposal.name);
  const [parent, setParent] = useState(proposal.parent);
  const [picked, setPicked] = useState<PickedFolder | null>(null);
  const [busy, setBusy] = useState<"picking" | "opening" | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);
  const nameProblem = vaultNameProblem(name);

  // one ask at a time: a picker and a boot both hold the page until main answers
  const ask = async (kind: "picking" | "opening", work: () => Promise<void>): Promise<void> => {
    setBusy(kind);
    setRefusal(null);
    try {
      await work();
    } catch (error) {
      console.warn("[first-run] the shell did not answer", error);
      setRefusal(BRIDGE_FAILED);
    }
    setBusy(null);
  };

  // a vault that opens closes this window, so an answer that lands is a refusal
  const finish = async (choice: FirstRunChoice): Promise<void> => {
    const answer = await bridge.finish(choice);
    if (!answer.ok) {
      setRefusal(answer.reason);
    }
  };

  return (
    <div className="flex w-full max-w-md flex-col gap-5">
      <div className="space-y-1">
        <h1 className="text-title font-medium">Where should your notes live?</h1>
        <p className="text-body text-muted-foreground">
          A vault is a folder of notes on your Mac. Inteligir reads and writes the files in it.
        </p>
      </div>
      <RadioGroup
        aria-label="Vault"
        value={mode}
        onValueChange={(next: VaultMode) => {
          setMode(next);
          setRefusal(null);
        }}
      >
        {MODES.map((option) => (
          <RadioGroupItem key={option.value} value={option.value} disabled={busy !== null}>
            {option.label}
          </RadioGroupItem>
        ))}
      </RadioGroup>
      {mode === "create" ? (
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (nameProblem === null && busy === null) {
              void ask("opening", async () => {
                await finish({ kind: "create", name, parent });
              });
            }
          }}
        >
          <div className="flex items-center gap-2">
            <Label htmlFor={nameId} className="w-20 shrink-0 text-body">
              Name
            </Label>
            <Input
              id={nameId}
              value={name}
              spellCheck={false}
              onChange={(event) => {
                setName(event.target.value);
              }}
            />
          </div>
          <div className="flex items-center gap-2">
            <span className="w-20 shrink-0 text-body">Location</span>
            <span
              className="min-w-0 flex-1 truncate text-body text-muted-foreground"
              title={parent}
            >
              {parent}
            </span>
            <Button
              type="button"
              variant="tertiary"
              size="compact"
              disabled={busy !== null}
              onClick={() => {
                void ask("picking", async () => {
                  const answer = await bridge.pickParent();
                  if (answer.kind === "picked") {
                    setParent(answer.path);
                  }
                });
              }}
            >
              Change…
            </Button>
          </div>
          {nameProblem === null ? null : (
            <p className="text-body text-destructive">{nameProblem}</p>
          )}
          <Button type="submit" disabled={busy !== null || nameProblem !== null}>
            {busy === "opening" ? "Opening…" : "Create vault"}
          </Button>
        </form>
      ) : (
        <div className="space-y-3">
          {picked === null ? (
            <p className="text-body text-muted-foreground">
              Pick a folder of markdown notes. They stay where they are, as they are.
            </p>
          ) : (
            <div className="space-y-2">
              <p className="truncate text-body" title={picked.path}>
                {picked.path}
              </p>
              <FolderFactsView facts={picked.facts} />
            </div>
          )}
          <div className="flex items-center gap-2">
            <Button
              variant="tertiary"
              disabled={busy !== null}
              onClick={() => {
                void ask("picking", async () => {
                  const answer = await bridge.pickFolder();
                  if (answer.kind === "picked") {
                    setPicked({ facts: answer.facts, path: answer.path });
                  }
                });
              }}
            >
              {picked === null ? "Choose a folder…" : "Choose another…"}
            </Button>
            {picked === null ? null : (
              <Button
                disabled={busy !== null}
                onClick={() => {
                  void ask("opening", async () => {
                    await finish({ kind: "open", path: picked.path });
                  });
                }}
              >
                {busy === "opening" ? "Opening…" : "Open folder"}
              </Button>
            )}
          </div>
        </div>
      )}
      {refusal === null ? null : <p className="text-body text-destructive">{refusal}</p>}
    </div>
  );
};
