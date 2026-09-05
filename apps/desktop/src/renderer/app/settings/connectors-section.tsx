import {
  CONNECTOR_ARGS_MAX,
  CONNECTOR_NAME_MAX_LENGTH,
  CONNECTOR_NAME_PATTERN,
  type ConnectorOauthStatus,
  connectorTarget,
  type ConnectorTransportInput,
  type ConnectorView,
} from "@repo/api/local/connectors/connectors-schema";
import { Button } from "@repo/ui/components/button";
import { confirm } from "@repo/ui/components/confirm-dialog";
import { Input } from "@repo/ui/components/input";
import { Label } from "@repo/ui/components/label";
import { Textarea } from "@repo/ui/components/textarea";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useId, useState } from "react";
import { orpc } from "../api";
import { useDataDirScope } from "../vault-hooks";
import { ChoiceRow, failed, SecondVaultNote, SectionHeading } from "./settings-chrome";

function useConnectors() {
  return useQuery({ ...orpc.connectors.list.queryOptions(), staleTime: 0 });
}

export function argumentLines(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

type TransportKind = ConnectorTransportInput["kind"];

const TRANSPORT_CHOICES: readonly { value: TransportKind; label: string }[] = [
  { value: "http", label: "URL" },
  { value: "stdio", label: "Command" },
  { value: "oauth", label: "OAuth" },
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
  name: "",
  kind: "http",
  command: "",
  argsText: "",
  url: "",
  headerName: "",
  headerValue: "",
  authorizationEndpoint: "",
  tokenEndpoint: "",
  clientId: "",
  scopesText: "",
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
    name: "context7",
    description: "Up-to-date library documentation for coding questions",
    url: "https://mcp.context7.com/mcp",
    authHeader: "CONTEXT7_API_KEY",
    docsUrl: "https://context7.com/docs",
  },
  {
    name: "exa",
    description: "Web search and crawling",
    url: "https://mcp.exa.ai/mcp",
    authHeader: "x-api-key",
    docsUrl: "https://docs.exa.ai/reference/exa-mcp",
  },
  {
    name: "linear",
    description: "Issues and projects (OAuth — paste your app's client id)",
    url: "https://mcp.linear.app/mcp",
    docsUrl: "https://linear.app/docs/mcp",
    oauth: {
      authorizationEndpoint: "https://linear.app/oauth/authorize",
      tokenEndpoint: "https://api.linear.app/oauth/token",
      scopes: ["read", "write"],
    },
  },
  {
    name: "notion",
    description: "Pages and databases (OAuth — paste your integration's client id)",
    url: "https://mcp.notion.com/mcp",
    docsUrl: "https://developers.notion.com/docs/mcp",
    oauth: {
      authorizationEndpoint: "https://api.notion.com/v1/oauth/authorize",
      tokenEndpoint: "https://api.notion.com/v1/oauth/token",
      scopes: [],
    },
  },
];

export function draftToRequest(
  draft: AddConnectorDraft,
): { ok: true; transport: ConnectorTransportInput } | { ok: false; problem: string } {
  if (!CONNECTOR_NAME_PATTERN.test(draft.name)) {
    return { ok: false, problem: "A name uses letters, numbers, '-' and '_' only." };
  }
  if (draft.name.length > CONNECTOR_NAME_MAX_LENGTH) {
    return {
      ok: false,
      problem: `A name is at most ${String(CONNECTOR_NAME_MAX_LENGTH)} characters.`,
    };
  }
  if (draft.kind === "stdio") {
    const command = draft.command.trim();
    if (command.length === 0) {
      return { ok: false, problem: "Name the program to run." };
    }
    const args = argumentLines(draft.argsText);
    if (args.length > CONNECTOR_ARGS_MAX) {
      return { ok: false, problem: `At most ${String(CONNECTOR_ARGS_MAX)} arguments.` };
    }
    return { ok: true, transport: { args, command, kind: "stdio" } };
  }
  if (draft.kind === "oauth") {
    const url = draft.url.trim();
    const authorizationEndpoint = draft.authorizationEndpoint.trim();
    const tokenEndpoint = draft.tokenEndpoint.trim();
    const clientId = draft.clientId.trim();
    for (const [label, value] of [
      ["server URL", url],
      ["authorize endpoint", authorizationEndpoint],
      ["token endpoint", tokenEndpoint],
    ] as const) {
      let protocol = "";
      try {
        protocol = new URL(value).protocol;
      } catch {
        return { ok: false, problem: `The ${label} does not parse.` };
      }
      if (protocol !== "http:" && protocol !== "https:") {
        return { ok: false, problem: `The ${label} must be http:// or https://.` };
      }
    }
    if (clientId.length === 0) {
      return { ok: false, problem: "Paste the OAuth app's client id." };
    }
    const scopes = draft.scopesText.split(/\s+/u).filter((scope) => scope.length > 0);
    return {
      ok: true,
      transport: { authorizationEndpoint, clientId, kind: "oauth", scopes, tokenEndpoint, url },
    };
  }
  const url = draft.url.trim();
  let protocol = "";
  try {
    protocol = new URL(url).protocol;
  } catch {
    return { ok: false, problem: "The URL does not parse." };
  }
  if (protocol !== "http:" && protocol !== "https:") {
    return { ok: false, problem: "The URL must be http:// or https://." };
  }
  const headerName = draft.headerName.trim();
  const headerValue = draft.headerValue.trim();
  if ((headerName === "") !== (headerValue === "")) {
    return { ok: false, problem: "An auth header needs both its name and its value." };
  }
  const transport: ConnectorTransportInput = { kind: "http", url };
  if (headerName !== "") {
    transport.headers = { [headerName]: headerValue };
  }
  return { ok: true, transport };
}

const OAUTH_STATUS_LABEL = {
  "needs-auth": "not connected",
  connected: "connected",
  "needs-reauth": "needs re-auth",
} satisfies Record<ConnectorOauthStatus, string>;

function ConnectorRow({
  server,
  onChanged,
}: {
  server: ConnectorView;
  onChanged: (servers: ConnectorView[]) => void;
}) {
  const [authorizeUrl, setAuthorizeUrl] = useState<string | null>(null);

  const connect = useMutation(
    orpc.connectors.oauthBegin.mutationOptions({
      onMutate: () => {
        setAuthorizeUrl(null);
      },
      onSuccess: (body) => {
        if (!body.opened) {
          setAuthorizeUrl(body.url);
        }
      },
      onError: (cause) => {
        failed(cause, `Could not start authorizing ${server.name}.`);
      },
    }),
  );

  const disconnect = useMutation(
    orpc.connectors.oauthDisconnect.mutationOptions({
      onSuccess: (body) => {
        onChanged(body.servers);
      },
      onError: (cause) => {
        failed(cause, `Could not disconnect ${server.name}.`);
      },
    }),
  );

  const toggle = useMutation(
    orpc.connectors.toggle.mutationOptions({
      onSuccess: (body) => {
        onChanged(body.servers);
      },
      onError: (cause) => {
        failed(cause, `Could not toggle ${server.name}.`);
      },
    }),
  );

  const removeServer = useMutation(
    orpc.connectors.remove.mutationOptions({
      onSuccess: (body) => {
        onChanged(body.servers);
      },
      onError: (cause) => {
        failed(cause, `Could not remove ${server.name}.`);
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
        title: `Remove ${server.name}?`,
        body: "Agent sessions stop getting this server on their next launch.",
        confirmLabel: "Remove",
        destructive: true,
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
          <p className="text-sm">
            {server.name}
            {server.transport.kind === "http" && server.transport.hasAuth ? (
              <span className="ml-2 text-xs text-muted-foreground">authenticated</span>
            ) : null}
            {oauth !== null ? (
              <span className="ml-2 text-xs text-muted-foreground">
                {OAUTH_STATUS_LABEL[oauth.status]}
              </span>
            ) : null}
          </p>
          <p className="truncate text-xs text-muted-foreground">
            {connectorTarget(server.transport)}
          </p>
        </div>
        {oauth !== null ? (
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
        ) : null}
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
      {authorizeUrl !== null ? (
        <p className="mt-1 text-xs text-muted-foreground">
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
      ) : null}
    </div>
  );
}

export function ConnectorsSection() {
  const queryClient = useQueryClient();
  const query = useConnectors();
  const [draft, setDraft] = useState<AddConnectorDraft>(EMPTY_DRAFT);
  const formId = useId();

  const servers = query.data?.servers ?? [];
  const setServers = (next: ConnectorView[]): void => {
    queryClient.setQueryData(orpc.connectors.list.queryKey(), { servers: next });
  };

  const verdict = draftToRequest(draft);

  const addServer = useMutation(
    orpc.connectors.add.mutationOptions({
      onSuccess: (body) => {
        setServers(body.servers);
        setDraft(EMPTY_DRAFT);
      },
      onError: (cause, variables) => {
        failed(cause, `Could not add ${variables.name}.`);
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

  return (
    <section>
      <SectionHeading>Connectors</SectionHeading>
      <p className="mb-2 text-xs text-muted-foreground">
        MCP servers every agent session gets — Claude Code and Codex alike. Enabled rows ride each
        session's launch; changes apply from the next action.
      </p>

      {query.isError ? (
        <p className="text-sm text-destructive">The connector list could not be read.</p>
      ) : servers.length === 0 ? (
        <div className="space-y-1">
          <p className="text-sm text-muted-foreground">No connectors configured.</p>
          <SecondVaultNote scope={scope} />
        </div>
      ) : (
        <div className="divide-y divide-line">
          {servers.map((server) => (
            <ConnectorRow key={server.name} server={server} onChanged={setServers} />
          ))}
        </div>
      )}

      <SectionHeading>Add a connector</SectionHeading>
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <Label htmlFor={`${formId}-name`} className="w-24 shrink-0 text-xs">
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
        {draft.kind === "http" ? (
          <>
            <div className="flex items-center gap-2">
              <Label htmlFor={`${formId}-url`} className="w-24 shrink-0 text-xs">
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
              <Label htmlFor={`${formId}-header`} className="w-24 shrink-0 text-xs">
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
        ) : draft.kind === "oauth" ? (
          <>
            <div className="flex items-center gap-2">
              <Label htmlFor={`${formId}-oauth-url`} className="w-24 shrink-0 text-xs">
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
              <Label htmlFor={`${formId}-authz`} className="w-24 shrink-0 text-xs">
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
              <Label htmlFor={`${formId}-token`} className="w-24 shrink-0 text-xs">
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
              <Label htmlFor={`${formId}-client`} className="w-24 shrink-0 text-xs">
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
        ) : (
          <>
            <div className="flex items-center gap-2">
              <Label htmlFor={`${formId}-command`} className="w-24 shrink-0 text-xs">
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
              <Label htmlFor={`${formId}-args`} className="w-24 shrink-0 pt-2 text-xs">
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
        )}
        <div className="flex items-center gap-2">
          {draft.name !== "" && !verdict.ok ? (
            <p className="flex-1 text-xs text-muted-foreground">{verdict.problem}</p>
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
              <p className="text-sm">
                {entry.name}
                <a
                  href={entry.docsUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="ml-2 text-xs text-muted-foreground underline-offset-2 hover:underline"
                >
                  docs
                </a>
              </p>
              <p className="truncate text-xs text-muted-foreground">{entry.description}</p>
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
}
