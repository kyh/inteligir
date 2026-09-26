// Connectors are the default agent's own: this section reads and edits that agent's list through
// the server, so what it shows is what the agent's next action gets, and every vault shares it.

import {
  connectorAddRequestSchema,
  connectorTargetText,
} from "@repo/api/local/connectors/connectors-schema";
import type {
  ConnectorAuth,
  ConnectorSignIn,
  ConnectorsResponse,
  ConnectorTargetInput,
  ConnectorView,
} from "@repo/api/local/connectors/connectors-schema";
import { Button } from "@repo/ui/components/button";
import { confirm } from "@repo/ui/components/confirm-dialog";
import { Input } from "@repo/ui/components/input";
import { Label } from "@repo/ui/components/label";
import { toast } from "@repo/ui/components/sonner";
import { Spinner } from "@repo/ui/components/spinner";
import { Textarea } from "@repo/ui/components/textarea";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useId, useRef, useState } from "react";
import type { z } from "zod";
import { failed, orpc, refusalMessage } from "../api";
import { CONNECTOR_PRESETS } from "./connector-presets";
import type { ConnectorPreset } from "./connector-presets";
import { ChoiceRow, SectionHeading } from "./settings-chrome";

// A sign-in finishes in the browser and nothing on the ws bus announces it, so the list is polled
// while any row waits on one.
const SIGN_IN_POLL_MS = 1500;

export const signInPollInterval = (
  servers: readonly ConnectorView[] | undefined,
): number | false =>
  servers?.some((server) => server.signIn.state === "pending") === true ? SIGN_IN_POLL_MS : false;

const useConnectors = () =>
  useQuery({
    ...orpc.connectors.list.queryOptions(),
    refetchInterval: (query) => signInPollInterval(query.state.data?.servers),
    staleTime: 0,
  });

// The row going back to idle is the only word a finished sign-in sends.
const useSignedInToasts = (response: ConnectorsResponse | undefined): void => {
  const pending = useRef<ReadonlySet<string>>(new Set());
  useEffect(() => {
    const servers = response?.servers ?? [];
    for (const server of servers) {
      if (pending.current.has(server.name) && server.signIn.state === "idle") {
        toast.success(`${server.name} is signed in.`);
      }
    }
    pending.current = new Set(
      servers.flatMap((server) => (server.signIn.state === "pending" ? [server.name] : [])),
    );
  }, [response]);
};

export const argumentLines = (text: string): string[] =>
  text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

type TargetKind = ConnectorTargetInput["kind"];

const TARGET_CHOICES: readonly { value: TargetKind; label: string }[] = [
  { label: "URL", value: "http" },
  { label: "Command", value: "stdio" },
];

export interface AddConnectorDraft {
  name: string;
  kind: TargetKind;
  url: string;
  command: string;
  argsText: string;
}

export const EMPTY_DRAFT: AddConnectorDraft = {
  argsText: "",
  command: "",
  kind: "http",
  name: "",
  url: "",
};

type DraftVerdict =
  | { ok: true; name: string; target: ConnectorTargetInput }
  | { ok: false; problem: string };

const draftTarget = (draft: AddConnectorDraft): ConnectorTargetInput =>
  draft.kind === "http"
    ? { kind: "http", url: draft.url.trim() }
    : { args: argumentLines(draft.argsText), command: draft.command.trim(), kind: "stdio" };

// The schema is the rule; this table only names each field the way the form labels it.
const FIELD_LABELS = {
  args: "arguments",
  command: "command",
  name: "name",
  url: "URL",
} satisfies Record<string, string>;

const isLabelledField = (key: PropertyKey): key is keyof typeof FIELD_LABELS =>
  Object.hasOwn(FIELD_LABELS, key);

const problemOf = (issue: z.core.$ZodIssue): string => {
  const field = issue.path.findLast(isLabelledField);
  const label = field === undefined ? "connector" : FIELD_LABELS[field];
  switch (issue.code) {
    case "too_small": {
      return `Fill in the ${label}.`;
    }
    case "too_big": {
      const maximum = String(issue.maximum);
      return issue.origin === "array"
        ? `At most ${maximum} ${label}.`
        : `The ${label} is at most ${maximum} characters.`;
    }
    default: {
      return `The ${label} ${issue.message}.`;
    }
  }
};

export const draftToRequest = (draft: AddConnectorDraft): DraftVerdict => {
  const parsed = connectorAddRequestSchema.safeParse({
    name: draft.name,
    target: draftTarget(draft),
  });
  if (!parsed.success) {
    const [issue] = parsed.error.issues;
    return {
      ok: false,
      problem: issue === undefined ? "The connector is not complete." : problemOf(issue),
    };
  }
  return { name: parsed.data.name, ok: true, target: parsed.data.target };
};

const AUTH_LABELS = {
  "needs-sign-in": "needs sign-in",
  "not-needed": null,
  "signed-in": "signed in",
  unknown: null,
} satisfies Record<ConnectorAuth, string | null>;

// A URL the agent may need a sign-in for is offered one; one it needs none for, or already has, is
// not, and neither is one already signing in.
export const offersSignIn = (server: ConnectorView): boolean =>
  server.target.kind === "http" &&
  server.signIn.state !== "pending" &&
  (server.auth === "needs-sign-in" || server.auth === "unknown");

const SignInLine = ({ signIn }: { signIn: ConnectorSignIn }) => {
  switch (signIn.state) {
    case "idle": {
      return null;
    }
    case "pending": {
      return (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-body">
          <span className="flex items-center gap-2">
            <Spinner className="size-3.5 text-muted-foreground" />
            Finish signing in in your browser.
          </span>
          {signIn.url === null ? null : (
            <a
              href={signIn.url}
              target="_blank"
              rel="noreferrer"
              className="underline underline-offset-2"
            >
              Open the sign-in page
            </a>
          )}
        </div>
      );
    }
    case "failed": {
      return <p className="text-body text-destructive">{signIn.detail}</p>;
    }
    // no default
  }
};

export const ConnectorRow = ({
  server,
  busy,
  onSignIn,
  onRemove,
}: {
  server: ConnectorView;
  busy: boolean;
  onSignIn: () => void;
  onRemove: () => void;
}) => {
  const status = AUTH_LABELS[server.auth];
  return (
    <div className="space-y-1 py-1.5">
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-subtitle">
            {server.name}
            {status === null ? null : (
              <span className="ml-2 text-body text-muted-foreground">{status}</span>
            )}
          </p>
          <p className="truncate text-body text-muted-foreground">
            {connectorTargetText(server.target)}
          </p>
        </div>
        {offersSignIn(server) ? (
          <Button size="compact" variant="ghost" disabled={busy} onClick={onSignIn}>
            Sign in
          </Button>
        ) : null}
        <Button size="compact" variant="ghost" disabled={busy} onClick={onRemove}>
          Remove
        </Button>
      </div>
      <SignInLine signIn={server.signIn} />
    </div>
  );
};

const presetAction = (preset: ConnectorPreset, added: boolean): string => {
  if (added) {
    return "Added";
  }
  return preset.signIn ? "Connect" : "Add";
};

export const ConnectorsSection = () => {
  const queryClient = useQueryClient();
  const query = useConnectors();
  const [draft, setDraft] = useState<AddConnectorDraft>(EMPTY_DRAFT);
  const formId = useId();
  useSignedInToasts(query.data);

  const servers = query.data?.servers ?? [];
  const agentName = query.data?.agent.displayName ?? "your agent";
  const setList = (next: ConnectorsResponse): void => {
    queryClient.setQueryData(orpc.connectors.list.queryKey(), next);
  };

  const signIn = useMutation(
    orpc.connectors.signIn.mutationOptions({
      onError: (cause, variables) => {
        failed(cause, `Could not start signing in to ${variables.name}.`);
      },
      onSuccess: setList,
    }),
  );
  const removeServer = useMutation(
    orpc.connectors.remove.mutationOptions({
      onError: (cause, variables) => {
        failed(cause, `Could not remove ${variables.name}.`);
      },
      onSuccess: setList,
    }),
  );
  const addServer = useMutation(
    orpc.connectors.add.mutationOptions({
      onError: (cause, variables) => {
        failed(cause, `Could not add ${variables.name}.`);
      },
      onSuccess: setList,
    }),
  );
  const busy = signIn.isPending || removeServer.isPending || addServer.isPending;

  // Confirm before mutate: a row greyed out while the dialog waits claims work that has not started.
  const remove = (name: string): void => {
    void (async () => {
      const confirmed = await confirm({
        body: `${agentName} stops using it from the next action, in every vault.`,
        confirmLabel: "Remove",
        destructive: true,
        title: `Remove ${name}?`,
      });
      if (confirmed) {
        removeServer.mutate({ name });
      }
    })();
  };

  const addPreset = (preset: ConnectorPreset): void => {
    addServer.mutate(
      { name: preset.name, target: { kind: "http", url: preset.url } },
      {
        onSuccess: () => {
          if (preset.signIn) {
            signIn.mutate({ name: preset.name });
          }
        },
      },
    );
  };

  const verdict = draftToRequest(draft);
  const submit = (): void => {
    if (!verdict.ok || busy) {
      return;
    }
    addServer.mutate(
      { name: verdict.name, target: verdict.target },
      {
        onSuccess: () => {
          setDraft(EMPTY_DRAFT);
        },
      },
    );
  };

  const list = () => {
    if (query.isError) {
      return (
        <p className="text-subtitle text-destructive">
          {refusalMessage(query.error, "The connector list could not be read.")}
        </p>
      );
    }
    if (query.data === undefined) {
      return null;
    }
    if (servers.length === 0) {
      return <p className="text-subtitle text-muted-foreground">No connectors yet.</p>;
    }
    return (
      <div className="divide-y divide-line">
        {servers.map((server) => (
          <ConnectorRow
            key={server.name}
            server={server}
            busy={busy}
            onSignIn={() => {
              signIn.mutate({ name: server.name });
            }}
            onRemove={() => {
              remove(server.name);
            }}
          />
        ))}
      </div>
    );
  };

  const targetFields = () => {
    if (draft.kind === "http") {
      return (
        <div className="flex items-center gap-2">
          <Label htmlFor={`${formId}-url`} className="w-24 shrink-0 text-body">
            URL
          </Label>
          <Input
            id={`${formId}-url`}
            value={draft.url}
            placeholder="https://example.com"
            onChange={(event) => {
              setDraft({ ...draft, url: event.target.value });
            }}
          />
        </div>
      );
    }
    return (
      <>
        <div className="flex items-center gap-2">
          <Label htmlFor={`${formId}-command`} className="w-24 shrink-0 text-body">
            Command
          </Label>
          <Input
            id={`${formId}-command`}
            value={draft.command}
            placeholder="npx"
            onChange={(event) => {
              setDraft({ ...draft, command: event.target.value });
            }}
          />
        </div>
        <div className="flex items-start gap-2">
          <Label htmlFor={`${formId}-args`} className="w-24 shrink-0 pt-2 text-body">
            Arguments
          </Label>
          <Textarea
            id={`${formId}-args`}
            value={draft.argsText}
            rows={2}
            placeholder={"one argument\nper line"}
            onChange={(event) => {
              setDraft({ ...draft, argsText: event.target.value });
            }}
          />
        </div>
      </>
    );
  };

  return (
    <section className="space-y-2">
      <SectionHeading>Connectors</SectionHeading>
      <p className="text-body text-muted-foreground">
        Apps and services {agentName} can use while it works on your notes. They belong to{" "}
        {agentName} on this Mac, so every vault shares them, and a change reaches the next action.
      </p>

      {list()}

      <SectionHeading>Add a connector</SectionHeading>
      <div className="divide-y divide-line">
        {CONNECTOR_PRESETS.map((preset) => {
          const added = servers.some((server) => server.name === preset.name);
          return (
            <div key={preset.name} className="flex items-center gap-2 py-1.5">
              <div className="min-w-0 flex-1">
                <p className="text-subtitle">{preset.label}</p>
                <p className="truncate text-body text-muted-foreground">{preset.description}</p>
              </div>
              <Button
                size="compact"
                variant="ghost"
                disabled={added || busy || query.data === undefined}
                onClick={() => {
                  addPreset(preset);
                }}
              >
                {presetAction(preset, added)}
              </Button>
            </div>
          );
        })}
      </div>

      <form
        aria-label="Another connector"
        className="flex flex-col gap-2 pt-2"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <div className="flex items-center gap-2">
          <Label htmlFor={`${formId}-name`} className="w-24 shrink-0 text-body">
            Name
          </Label>
          <Input
            id={`${formId}-name`}
            value={draft.name}
            placeholder="my-connector"
            onChange={(event) => {
              setDraft({ ...draft, name: event.target.value });
            }}
          />
        </div>
        <ChoiceRow
          label="Connect by"
          value={draft.kind}
          options={TARGET_CHOICES}
          onChange={(kind) => {
            setDraft({ ...draft, kind });
          }}
        />
        {targetFields()}
        <div className="flex items-center gap-2">
          {draft.name !== "" && !verdict.ok ? (
            <p className="flex-1 text-body text-muted-foreground">{verdict.problem}</p>
          ) : (
            <span className="flex-1" />
          )}
          <Button type="submit" size="compact" disabled={!verdict.ok || busy}>
            Add
          </Button>
        </div>
      </form>
    </section>
  );
};
