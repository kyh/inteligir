// Where the vault syncs: the account's hosted vault, or a git server of the user's own. Settings ›
// Advanced alone draws it, so it may name git; the choice lands on the vault repo's own origin,
// the one record every sync reads.

import { parseRemoteUrl, VAULT_REMOTE_PIN_ENV_VAR } from "@repo/api/local/vault/remote-url";
import { externalSyncName } from "@repo/api/local/vault/vault-schema";
import type {
  VaultSetRemoteRequest,
  VaultStatusResponse,
} from "@repo/api/local/vault/vault-schema";
import { Button } from "@repo/ui/components/button";
import { Input } from "@repo/ui/components/input";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { failed, orpc } from "../api";
import { ChoiceRow, Row } from "./settings-chrome";

type Choice = VaultSetRemoteRequest["kind"];

const CHOICES: readonly { value: Choice; label: string }[] = [
  { label: "Your account", value: "account" },
  { label: "Your own git server", value: "remote" },
];

// a pinned remote is no choice at all: only the environment that pinned it changes it
type CurrentRemote =
  | { kind: "account" }
  | { kind: "remote"; url: string }
  | { kind: "pinned"; url: string };

const currentRemote = (status: VaultStatusResponse): CurrentRemote => {
  if (status.state === "no-remote") {
    return { kind: "account" };
  }
  switch (status.remoteSource) {
    case "account": {
      return { kind: "account" };
    }
    case "explicit": {
      return { kind: "remote", url: status.remote };
    }
    case "pinned": {
      return { kind: "pinned", url: status.remote };
    }
    default: {
      const exhaustive: never = status.remoteSource;
      return exhaustive;
    }
  }
};

const Note = ({ children }: { children: React.ReactNode }) => (
  <span className="mt-1 block text-body text-muted-foreground">{children}</span>
);

export interface SyncRemoteFormProps {
  status: VaultStatusResponse;
  pending: boolean;
  onSave: (choice: VaultSetRemoteRequest) => void;
}

export const SyncRemoteForm = ({ status, pending, onSave }: SyncRemoteFormProps) => {
  const [kindDraft, setKindDraft] = useState<Choice | null>(null);
  const [urlDraft, setUrlDraft] = useState<string | null>(null);
  const current = currentRemote(status);

  if (current.kind === "pinned") {
    return (
      <Row label="Sync with">
        <span className="block truncate font-mono text-body" title={current.url}>
          {current.url}
        </span>
        <Note>
          Pinned by {VAULT_REMOTE_PIN_ENV_VAR} in the environment the app started from; unset it to
          choose here.
        </Note>
      </Row>
    );
  }

  const kind = kindDraft ?? current.kind;
  const url = urlDraft ?? (current.kind === "remote" ? current.url : "");
  const verdict = parseRemoteUrl(url);
  let request: VaultSetRemoteRequest | null = null;
  if (kind === "account") {
    request = { kind };
  } else if (verdict.ok) {
    request = { kind, url: verdict.url };
  }
  const unchanged =
    request === null ||
    (request.kind === "account"
      ? current.kind === "account"
      : current.kind === "remote" && current.url === request.url);

  const accountNote =
    status.externalSync === null
      ? "Syncs through the account you sign in with under Devices."
      : `${externalSyncName(status.externalSync)} syncs this folder, so the hosted vault stays off here.`;

  return (
    <Row label="Sync with">
      <ChoiceRow label="Sync with" options={CHOICES} value={kind} onChange={setKindDraft} />
      <form
        className="mt-1.5"
        onSubmit={(event) => {
          event.preventDefault();
          if (request !== null && !unchanged) {
            onSave(request);
          }
        }}
      >
        {kind === "remote" ? (
          <Input
            aria-label="Git server URL"
            placeholder="https://… or git@host:path"
            spellCheck={false}
            value={url}
            onChange={(event) => {
              setUrlDraft(event.target.value);
            }}
            className="h-7 max-w-96 font-mono text-body"
          />
        ) : null}
        {kind === "remote" && url.trim().length > 0 && !verdict.ok ? (
          <Note>The URL {verdict.reason}.</Note>
        ) : null}
        <Note>
          {kind === "account"
            ? accountNote
            : `Uses this Mac's git credentials.${current.kind === "account" ? " Your phone and your other signed-in devices stop seeing this vault's notes." : ""}`}
        </Note>
        <Button
          type="submit"
          variant="tertiary"
          size="compact"
          className="mt-1.5"
          disabled={pending || unchanged}
        >
          Save
        </Button>
      </form>
    </Row>
  );
};

export const SyncRemoteRow = ({ status }: { status: VaultStatusResponse | undefined }) => {
  const queryClient = useQueryClient();
  // a save remounts the form, so what was typed gives way to what the vault now syncs with
  const [saved, setSaved] = useState(0);
  const setRemote = useMutation(
    orpc.vault.setRemote.mutationOptions({
      onError: (cause) => {
        failed(cause, "Could not change where this vault syncs.");
      },
      onSuccess: (response) => {
        queryClient.setQueryData(orpc.vault.status.queryKey(), response);
        setSaved((count) => count + 1);
      },
    }),
  );
  if (status === undefined) {
    return <Row label="Sync with">…</Row>;
  }
  const handleSave = (choice: VaultSetRemoteRequest): void => {
    setRemote.mutate(choice);
  };
  return (
    <SyncRemoteForm key={saved} status={status} pending={setRemote.isPending} onSave={handleSave} />
  );
};
