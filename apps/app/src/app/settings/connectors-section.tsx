// Settings → Connectors: the app-owned MCP registry (issue #591). What is
// listed here is what EVERY agent session gets — session launch composes the
// enabled rows into ACP's mcpServers, identically for Claude Code and Codex —
// so this surface is the registry's real editor, not a face over someone
// else's config file.
//
// ADDING ONE IS A DELIBERATE ACT. An MCP server is a program this app will
// run on this machine (stdio) or a service note content will be sent to
// (http). The catalog below prefills KNOWN servers' coordinates; it never
// adds anything itself — every add goes through the same form and the same
// route. Secrets: header values are sent once on save and never come back;
// a configured row says "authenticated", nothing more.

import {
  CONNECTOR_ARGS_MAX,
  CONNECTOR_NAME_MAX_LENGTH,
  CONNECTOR_NAME_PATTERN,
  connectorTarget,
  type ConnectorTransportInput,
  type ConnectorView,
  type ConnectorsResponse,
} from "@repo/server-contract/connectors";
import { Button } from "@repo/ui/components/button";
import { confirm } from "@repo/ui/components/confirm-dialog";
import { Input } from "@repo/ui/components/input";
import { Label } from "@repo/ui/components/label";
import { Textarea } from "@repo/ui/components/textarea";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useId, useState } from "react";
import { queryKeys, unwrap } from "../api";
import { useWorkspace } from "../workspace-context";
import { ChoiceRow, failed, SectionHeading } from "./settings-chrome";

function useConnectors() {
  const { api } = useWorkspace();
  return useQuery<ConnectorsResponse>({
    queryKey: queryKeys.connectors,
    queryFn: async () => unwrap(await api.connectors.$get()),
    staleTime: 0,
  });
}

/** One argument per line; blank lines are spacing, not empty arguments. */
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
];

export interface AddConnectorDraft {
  name: string;
  kind: TransportKind;
  command: string;
  argsText: string;
  url: string;
  headerName: string;
  headerValue: string;
}

export const EMPTY_DRAFT: AddConnectorDraft = {
  name: "",
  kind: "http",
  command: "",
  argsText: "",
  url: "",
  headerName: "",
  headerValue: "",
};

/**
 * A KNOWN server's coordinates, prefill-only. `authHeader` names the header
 * the service documents for its API key; `unavailableReason` marks a row the
 * form cannot honestly add yet (OAuth-only services) — shown disabled with
 * the reason rather than pretending a key field would work.
 */
interface CatalogEntry {
  name: string;
  description: string;
  url: string;
  authHeader?: string;
  docsUrl: string;
  unavailableReason?: string;
}

/** Verified against each service's own docs at vendoring time — a wrong URL
 *  here is a server that can never connect, so rows are few and real. */
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
    description: "Issues and projects",
    url: "https://mcp.linear.app/mcp",
    docsUrl: "https://linear.app/docs/mcp",
    unavailableReason: "Authenticates with OAuth, which this app does not run yet",
  },
];

/**
 * The draft as a request, or the sentence that stops it. Pure and total, so
 * the disabled state and the submit read the same answer.
 */
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

function ConnectorRow({
  server,
  onChanged,
}: {
  server: ConnectorView;
  onChanged: (servers: ConnectorView[]) => void;
}) {
  const { api } = useWorkspace();
  const [busy, setBusy] = useState(false);

  const toggle = (): void => {
    setBusy(true);
    void (async () => {
      try {
        const body = unwrap(
          await api.connectors.toggle.$post({
            json: { enabled: !server.enabled, name: server.name },
          }),
        );
        onChanged((await body).servers);
      } catch (cause) {
        failed(cause, `Could not toggle ${server.name}.`);
      } finally {
        setBusy(false);
      }
    })();
  };

  const remove = (): void => {
    void (async () => {
      const confirmed = await confirm({
        title: `Remove ${server.name}?`,
        body: "Agent sessions stop getting this server on their next launch.",
        confirmLabel: "Remove",
        destructive: true,
      });
      if (!confirmed) {
        return;
      }
      setBusy(true);
      try {
        const body = unwrap(await api.connectors.remove.$post({ json: { name: server.name } }));
        onChanged((await body).servers);
      } catch (cause) {
        failed(cause, `Could not remove ${server.name}.`);
      } finally {
        setBusy(false);
      }
    })();
  };

  return (
    <div className="flex items-center gap-2 py-1.5">
      <div className="min-w-0 flex-1">
        <p className="text-sm">
          {server.name}
          {server.transport.kind === "http" && server.transport.hasAuth ? (
            <span className="ml-2 text-xs text-muted-foreground">authenticated</span>
          ) : null}
        </p>
        <p className="truncate text-xs text-muted-foreground">
          {connectorTarget(server.transport)}
        </p>
      </div>
      <Button size="xs" variant="ghost" disabled={busy} onClick={toggle}>
        {server.enabled ? "Disable" : "Enable"}
      </Button>
      <Button size="xs" variant="ghost" disabled={busy} onClick={remove}>
        Remove
      </Button>
    </div>
  );
}

export function ConnectorsSection() {
  const { api } = useWorkspace();
  const queryClient = useQueryClient();
  const query = useConnectors();
  const [draft, setDraft] = useState<AddConnectorDraft>(EMPTY_DRAFT);
  const [adding, setAdding] = useState(false);
  const formId = useId();

  const servers = query.data?.servers ?? [];
  const setServers = (next: ConnectorView[]): void => {
    queryClient.setQueryData<ConnectorsResponse>(queryKeys.connectors, { servers: next });
  };

  const verdict = draftToRequest(draft);

  const submit = (): void => {
    if (!verdict.ok || adding) {
      return;
    }
    setAdding(true);
    void (async () => {
      try {
        const body = unwrap(
          await api.connectors.add.$post({
            json: { name: draft.name, transport: verdict.transport },
          }),
        );
        setServers((await body).servers);
        setDraft(EMPTY_DRAFT);
      } catch (cause) {
        failed(cause, `Could not add ${draft.name}.`);
      } finally {
        setAdding(false);
      }
    })();
  };

  const prefill = (entry: CatalogEntry): void => {
    setDraft({
      ...EMPTY_DRAFT,
      headerName: entry.authHeader ?? "",
      kind: "http",
      name: entry.name,
      url: entry.url,
    });
  };

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
        <p className="text-sm text-muted-foreground">No connectors configured.</p>
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
          <Button size="sm" disabled={!verdict.ok || adding} onClick={submit}>
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
              <p className="truncate text-xs text-muted-foreground">
                {entry.unavailableReason ?? entry.description}
              </p>
            </div>
            <Button
              size="xs"
              variant="ghost"
              disabled={entry.unavailableReason !== undefined}
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
