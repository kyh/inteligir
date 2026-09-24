import {
  connectorAddRequestSchema,
  connectorTarget,
} from "@repo/api/local/connectors/connectors-schema";
import type {
  ConnectorOauthStatus,
  ConnectorTransportInput,
  ConnectorView,
} from "@repo/api/local/connectors/connectors-schema";
import { Button } from "@repo/ui/components/button";
import { confirm } from "@repo/ui/components/confirm-dialog";
import { Input } from "@repo/ui/components/input";
import { Label } from "@repo/ui/components/label";
import { Textarea } from "@repo/ui/components/textarea";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useId, useState } from "react";
import type { z } from "zod";
import { failed, orpc } from "../api";
import { useDataDirScope } from "../vault-hooks";
import { ChoiceRow, SecondVaultNote, SectionHeading } from "./settings-chrome";

// The OAuth callback lands on the server and nothing on the ws bus announces it, so the list is
// polled from the moment the browser is sent to the provider until the row reads connected.
const AUTHORIZE_POLL_MS = 1000;
const AUTHORIZE_WAIT_MS = 5 * 60 * 1000;

interface AwaitedAuthorize {
  name: string;
  until: number;
}

const oauthStatusOf = (
  servers: readonly ConnectorView[] | undefined,
  name: string,
): ConnectorOauthStatus | null => {
  const transport = servers?.find((server) => server.name === name)?.transport;
  return transport?.kind === "oauth" ? transport.status : null;
};

export const authorizePollInterval = (
  awaited: AwaitedAuthorize | null,
  servers: readonly ConnectorView[] | undefined,
  now: number,
): number | false => {
  if (awaited === null || now >= awaited.until) {
    return false;
  }
  const status = oauthStatusOf(servers, awaited.name);
  return status === null || status === "connected" ? false : AUTHORIZE_POLL_MS;
};

const useConnectors = (awaited: AwaitedAuthorize | null) =>
  useQuery({
    ...orpc.connectors.list.queryOptions(),
    refetchInterval: (query) =>
      authorizePollInterval(awaited, query.state.data?.servers, Date.now()),
    staleTime: 0,
  });

export const argumentLines = (text: string): string[] =>
  text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

type TransportKind = ConnectorTransportInput["kind"];

const TRANSPORT_CHOICES: readonly { value: TransportKind; label: string }[] = [
  { label: "URL", value: "http" },
  { label: "Command", value: "stdio" },
  { label: "OAuth", value: "oauth" },
];

export interface AddConnectorDraft {
  name: string;
  kind: TransportKind;
  command: string;
  argsText: string;
  url: string;
  headerName: string;
  headerValue: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  clientId: string;
  scopesText: string;
}

export const EMPTY_DRAFT: AddConnectorDraft = {
  argsText: "",
  authorizationEndpoint: "",
  clientId: "",
  command: "",
  headerName: "",
  headerValue: "",
  kind: "http",
  name: "",
  scopesText: "",
  tokenEndpoint: "",
  url: "",
};

interface CatalogEntry {
  name: string;
  description: string;
  url: string;
  authHeader?: string;
  docsUrl: string;
  oauth?: { authorizationEndpoint: string; tokenEndpoint: string; scopes: readonly string[] };
}

const CATALOG: readonly CatalogEntry[] = [
  {
    authHeader: "CONTEXT7_API_KEY",
    description: "Up-to-date library documentation for coding questions",
    docsUrl: "https://context7.com/docs",
    name: "context7",
    url: "https://mcp.context7.com/mcp",
  },
  {
    authHeader: "x-api-key",
    description: "Web search and crawling",
    docsUrl: "https://docs.exa.ai/reference/exa-mcp",
    name: "exa",
    url: "https://mcp.exa.ai/mcp",
  },
  {
    description: "Issues and projects (OAuth — paste your app's client id)",
    docsUrl: "https://linear.app/docs/mcp",
    name: "linear",
    oauth: {
      authorizationEndpoint: "https://linear.app/oauth/authorize",
      scopes: ["read", "write"],
      tokenEndpoint: "https://api.linear.app/oauth/token",
    },
    url: "https://mcp.linear.app/mcp",
  },
  {
    description: "Pages and databases (OAuth — paste your integration's client id)",
    docsUrl: "https://developers.notion.com/docs/mcp",
    name: "notion",
    oauth: {
      authorizationEndpoint: "https://api.notion.com/v1/oauth/authorize",
      scopes: [],
      tokenEndpoint: "https://api.notion.com/v1/oauth/token",
    },
    url: "https://mcp.notion.com/mcp",
  },
];

type DraftVerdict =
  | { ok: true; transport: ConnectorTransportInput }
  | { ok: false; problem: string };

const draftTransport = (draft: AddConnectorDraft): ConnectorTransportInput => {
  switch (draft.kind) {
    case "stdio": {
      return { args: argumentLines(draft.argsText), command: draft.command.trim(), kind: "stdio" };
    }
    case "oauth": {
      return {
        authorizationEndpoint: draft.authorizationEndpoint.trim(),
        clientId: draft.clientId.trim(),
        kind: "oauth",
        scopes: draft.scopesText.split(/\s+/u).filter((scope) => scope.length > 0),
        tokenEndpoint: draft.tokenEndpoint.trim(),
        url: draft.url.trim(),
      };
    }
    case "http": {
      const url = draft.url.trim();
      const headerName = draft.headerName.trim();
      const headerValue = draft.headerValue.trim();
      return headerName === "" || headerValue === ""
        ? { kind: "http", url }
        : { headers: { [headerName]: headerValue }, kind: "http", url };
    }
    // no default
  }
};

// The schema is the rule; this table only names each field the way the form labels it.
const FIELD_LABELS = {
  args: "arguments",
  authorizationEndpoint: "authorize endpoint",
  clientId: "client id",
  command: "command",
  name: "name",
  scopes: "scopes",
  tokenEndpoint: "token endpoint",
  url: "URL",
} satisfies Record<string, string>;

const isLabelledField = (key: PropertyKey): key is keyof typeof FIELD_LABELS =>
  Object.hasOwn(FIELD_LABELS, key);

const fieldLabel = (kind: TransportKind, path: readonly PropertyKey[]): string => {
  const field = path.findLast(isLabelledField);
  if (field === undefined) {
    return "connector";
  }
  return field === "url" && kind === "oauth" ? "server URL" : FIELD_LABELS[field];
};

const problemOf = (kind: TransportKind, issue: z.core.$ZodIssue): string => {
  const label = fieldLabel(kind, issue.path);
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
    transport: draftTransport(draft),
  });
  if (!parsed.success) {
    const [issue] = parsed.error.issues;
    return {
      ok: false,
      problem:
        issue === undefined ? "The connector is not complete." : problemOf(draft.kind, issue),
    };
  }
  // the one draft rule the schema cannot state: it only ever sees a header that is whole
  if (
    draft.kind === "http" &&
    (draft.headerName.trim() === "") !== (draft.headerValue.trim() === "")
  ) {
    return { ok: false, problem: "An auth header needs both its name and its value." };
  }
  return { ok: true, transport: parsed.data.transport };
};

const OAUTH_STATUS_LABEL = {
  connected: "connected",
  "needs-auth": "not connected",
  "needs-reauth": "needs re-auth",
} satisfies Record<ConnectorOauthStatus, string>;

const ConnectorRow = ({
  server,
  onChanged,
  onAuthorizing,
}: {
  server: ConnectorView;
  onChanged: (servers: ConnectorView[]) => void;
  onAuthorizing: (name: string) => void;
}) => {
  const [authorizeUrl, setAuthorizeUrl] = useState<string | null>(null);

  const connect = useMutation(
    orpc.connectors.oauthBegin.mutationOptions({
      onError: (cause) => {
        failed(cause, `Could not start authorizing ${server.name}.`);
      },
      onMutate: () => {
        setAuthorizeUrl(null);
      },
      onSuccess: (body) => {
        if (!body.opened) {
          setAuthorizeUrl(body.url);
        }
        onAuthorizing(server.name);
      },
    }),
  );

  const disconnect = useMutation(
    orpc.connectors.oauthDisconnect.mutationOptions({
      onError: (cause) => {
        failed(cause, `Could not disconnect ${server.name}.`);
      },
      onSuccess: (body) => {
        onChanged(body.servers);
      },
    }),
  );

  const toggle = useMutation(
    orpc.connectors.toggle.mutationOptions({
      onError: (cause) => {
        failed(cause, `Could not toggle ${server.name}.`);
      },
      onSuccess: (body) => {
        onChanged(body.servers);
      },
    }),
  );

  const removeServer = useMutation(
    orpc.connectors.remove.mutationOptions({
      onError: (cause) => {
        failed(cause, `Could not remove ${server.name}.`);
      },
      onSuccess: (body) => {
        onChanged(body.servers);
      },
    }),
  );

  const busy =
    connect.isPending || disconnect.isPending || toggle.isPending || removeServer.isPending;

  // Confirm before mutate: a row greyed out while the dialog waits claims
  // work that has not started.
  const remove = (): void => {
    void (async () => {
      const confirmed = await confirm({
        body: "Agent sessions stop getting this server on their next launch.",
        confirmLabel: "Remove",
        destructive: true,
        title: `Remove ${server.name}?`,
      });
      if (confirmed) {
        removeServer.mutate({ name: server.name });
      }
    })();
  };

  const oauth = server.transport.kind === "oauth" ? server.transport : null;

  return (
    <div className="py-1.5">
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-subtitle">
            {server.name}
            {server.transport.kind === "http" && server.transport.hasAuth ? (
              <span className="ml-2 text-body text-muted-foreground">authenticated</span>
            ) : null}
            {oauth === null ? null : (
              <span className="ml-2 text-body text-muted-foreground">
                {OAUTH_STATUS_LABEL[oauth.status]}
              </span>
            )}
          </p>
          <p className="truncate text-body text-muted-foreground">
            {connectorTarget(server.transport)}
          </p>
        </div>
        {oauth === null ? null : (
          <Button
            size="compact"
            variant="ghost"
            disabled={busy}
            onClick={() => {
              connect.mutate({ name: server.name, open: true });
            }}
          >
            {oauth.status === "needs-auth" ? "Connect" : "Reconnect"}
          </Button>
        )}
        {oauth !== null && oauth.status !== "needs-auth" ? (
          <Button
            size="compact"
            variant="ghost"
            disabled={busy}
            onClick={() => {
              disconnect.mutate({ name: server.name });
            }}
          >
            Disconnect
          </Button>
        ) : null}
        <Button
          size="compact"
          variant="ghost"
          disabled={busy}
          onClick={() => {
            toggle.mutate({ enabled: !server.enabled, name: server.name });
          }}
        >
          {server.enabled ? "Disable" : "Enable"}
        </Button>
        <Button size="compact" variant="ghost" disabled={busy} onClick={remove}>
          Remove
        </Button>
      </div>
      {authorizeUrl === null ? null : (
        <p className="mt-1 text-body text-muted-foreground">
          Browser did not open —{" "}
          <a
            href={authorizeUrl}
            target="_blank"
            rel="noreferrer"
            className="underline underline-offset-2"
          >
            authorize here
          </a>
          .
        </p>
      )}
    </div>
  );
};

export const ConnectorsSection = () => {
  const queryClient = useQueryClient();
  const [awaited, setAwaited] = useState<AwaitedAuthorize | null>(null);
  const query = useConnectors(awaited);
  const [draft, setDraft] = useState<AddConnectorDraft>(EMPTY_DRAFT);
  const formId = useId();

  const servers = query.data?.servers ?? [];
  // dropped once it lands, so a later Disconnect does not start the poll again
  if (awaited !== null && oauthStatusOf(servers, awaited.name) === "connected") {
    setAwaited(null);
  }

  const awaitAuthorize = (name: string): void => {
    setAwaited({ name, until: Date.now() + AUTHORIZE_WAIT_MS });
  };
  const setServers = (next: ConnectorView[]): void => {
    queryClient.setQueryData(orpc.connectors.list.queryKey(), { servers: next });
  };

  const verdict = draftToRequest(draft);

  const addServer = useMutation(
    orpc.connectors.add.mutationOptions({
      onError: (cause, variables) => {
        failed(cause, `Could not add ${variables.name}.`);
      },
      onSuccess: (body) => {
        setServers(body.servers);
        setDraft(EMPTY_DRAFT);
      },
    }),
  );

  const submit = (): void => {
    if (!verdict.ok || addServer.isPending) {
      return;
    }
    addServer.mutate({ name: draft.name, transport: verdict.transport });
  };

  const prefill = (entry: CatalogEntry): void => {
    if (entry.oauth !== undefined) {
      setDraft({
        ...EMPTY_DRAFT,
        authorizationEndpoint: entry.oauth.authorizationEndpoint,
        kind: "oauth",
        name: entry.name,
        scopesText: entry.oauth.scopes.join(" "),
        tokenEndpoint: entry.oauth.tokenEndpoint,
        url: entry.url,
      });
      return;
    }
    setDraft({
      ...EMPTY_DRAFT,
      headerName: entry.authHeader ?? "",
      kind: "http",
      name: entry.name,
      url: entry.url,
    });
  };

  const scope = useDataDirScope();

  const list = () => {
    if (query.isError) {
      return (
        <p className="text-subtitle text-destructive">The connector list could not be read.</p>
      );
    }
    if (servers.length === 0) {
      return (
        <div className="space-y-1">
          <p className="text-subtitle text-muted-foreground">No connectors configured.</p>
          <SecondVaultNote scope={scope} />
        </div>
      );
    }
    return (
      <div className="divide-y divide-line">
        {servers.map((server) => (
          <ConnectorRow
            key={server.name}
            server={server}
            onChanged={setServers}
            onAuthorizing={awaitAuthorize}
          />
        ))}
      </div>
    );
  };

  const transportFields = () => {
    if (draft.kind === "http") {
      return (
        <>
          <div className="flex items-center gap-2">
            <Label htmlFor={`${formId}-url`} className="w-24 shrink-0 text-body">
              URL
            </Label>
            <Input
              id={`${formId}-url`}
              value={draft.url}
              placeholder="https://mcp.example.com/mcp"
              onChange={(event) => {
                setDraft({ ...draft, url: event.target.value });
              }}
            />
          </div>
          <div className="flex items-center gap-2">
            <Label htmlFor={`${formId}-header`} className="w-24 shrink-0 text-body">
              Auth header
            </Label>
            <Input
              id={`${formId}-header`}
              value={draft.headerName}
              placeholder="x-api-key"
              className="w-40"
              onChange={(event) => {
                setDraft({ ...draft, headerName: event.target.value });
              }}
            />
            <Input
              aria-label="Auth header value"
              type="password"
              value={draft.headerValue}
              placeholder="value"
              onChange={(event) => {
                setDraft({ ...draft, headerValue: event.target.value });
              }}
            />
          </div>
        </>
      );
    }
    if (draft.kind === "oauth") {
      return (
        <>
          <div className="flex items-center gap-2">
            <Label htmlFor={`${formId}-oauth-url`} className="w-24 shrink-0 text-body">
              Server URL
            </Label>
            <Input
              id={`${formId}-oauth-url`}
              value={draft.url}
              placeholder="https://mcp.example.com/mcp"
              onChange={(event) => {
                setDraft({ ...draft, url: event.target.value });
              }}
            />
          </div>
          <div className="flex items-center gap-2">
            <Label htmlFor={`${formId}-authz`} className="w-24 shrink-0 text-body">
              Authorize
            </Label>
            <Input
              id={`${formId}-authz`}
              value={draft.authorizationEndpoint}
              placeholder="https://provider.example/oauth/authorize"
              onChange={(event) => {
                setDraft({ ...draft, authorizationEndpoint: event.target.value });
              }}
            />
          </div>
          <div className="flex items-center gap-2">
            <Label htmlFor={`${formId}-token`} className="w-24 shrink-0 text-body">
              Token
            </Label>
            <Input
              id={`${formId}-token`}
              value={draft.tokenEndpoint}
              placeholder="https://provider.example/oauth/token"
              onChange={(event) => {
                setDraft({ ...draft, tokenEndpoint: event.target.value });
              }}
            />
          </div>
          <div className="flex items-center gap-2">
            <Label htmlFor={`${formId}-client`} className="w-24 shrink-0 text-body">
              Client id
            </Label>
            <Input
              id={`${formId}-client`}
              value={draft.clientId}
              placeholder="from your OAuth app registration"
              onChange={(event) => {
                setDraft({ ...draft, clientId: event.target.value });
              }}
            />
            <Input
              aria-label="Scopes"
              value={draft.scopesText}
              placeholder="scopes (space-separated)"
              className="w-48"
              onChange={(event) => {
                setDraft({ ...draft, scopesText: event.target.value });
              }}
            />
          </div>
        </>
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
    <section>
      <SectionHeading>Connectors</SectionHeading>
      <p className="mb-2 text-body text-muted-foreground">
        MCP servers every agent session gets — Claude Code and Codex alike. Enabled rows ride each
        session&apos;s launch; changes apply from the next action.
      </p>

      {list()}

      <SectionHeading>Add a connector</SectionHeading>
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <Label htmlFor={`${formId}-name`} className="w-24 shrink-0 text-body">
            Name
          </Label>
          <Input
            id={`${formId}-name`}
            value={draft.name}
            placeholder="context7"
            onChange={(event) => {
              setDraft({ ...draft, name: event.target.value });
            }}
          />
        </div>
        <ChoiceRow
          label="Transport"
          value={draft.kind}
          options={TRANSPORT_CHOICES}
          onChange={(kind) => {
            setDraft({ ...draft, kind });
          }}
        />
        {transportFields()}
        <div className="flex items-center gap-2">
          {draft.name !== "" && !verdict.ok ? (
            <p className="flex-1 text-body text-muted-foreground">{verdict.problem}</p>
          ) : (
            <span className="flex-1" />
          )}
          <Button size="compact" disabled={!verdict.ok || addServer.isPending} onClick={submit}>
            Add
          </Button>
        </div>
      </div>

      <SectionHeading>Known servers</SectionHeading>
      <div className="divide-y divide-line">
        {CATALOG.map((entry) => (
          <div key={entry.name} className="flex items-center gap-2 py-1.5">
            <div className="min-w-0 flex-1">
              <p className="text-subtitle">
                {entry.name}
                <a
                  href={entry.docsUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="ml-2 text-body text-muted-foreground underline-offset-2 hover:underline"
                >
                  docs
                </a>
              </p>
              <p className="truncate text-body text-muted-foreground">{entry.description}</p>
            </div>
            <Button
              size="compact"
              variant="ghost"
              onClick={() => {
                prefill(entry);
              }}
            >
              Use
            </Button>
          </div>
        ))}
      </div>
    </section>
  );
};
