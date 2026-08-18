// Settings → Connectors: the MCP servers the coding agent can talk to.
//
// This surface OWNS NOTHING. Codex keeps the list; the routes behind this
// section are a typed face over `codex mcp list|add|remove`, so what is drawn
// here is what the agent actually gets. When codex is not installed the
// section says so in the same shape the Agent section states an unavailable
// runtime — a sentence, not an empty list, because an empty list is a claim
// that there are no connectors.
//
// ADDING ONE IS A DELIBERATE ACT, AND THE ACT IS SHOWN. An MCP server is a
// program codex will run on this machine (stdio) or a service it will send
// note content to (http) — it can reach whatever the person running this app
// can reach. So the form composes the EXACT `codex mcp add …` invocation and
// prints it above the button: nothing is inferred, suggested, or accepted
// from anywhere but these inputs.

import {
  CONNECTOR_ARGS_MAX,
  CONNECTOR_NAME_MAX_LENGTH,
  CONNECTOR_NAME_PATTERN,
  connectorTarget,
  type Connector,
  type ConnectorTransportInput,
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

/**
 * Codex's config file is not on the ws bus — nothing in this app writes it,
 * and codex does not announce it — so the query opts out of the fresh-forever
 * default and re-reads whenever the dialog mounts, exactly like
 * `useSystemStatus`. Its own mutations hand back the new listing directly.
 */
function useConnectors() {
  const { api } = useWorkspace();
  return useQuery<ConnectorsResponse>({
    queryKey: queryKeys.connectors,
    queryFn: async () => unwrap(await api.connectors.$get()),
    staleTime: 0,
  });
}

/** The invocation the Add button will run, spelled out for the user to read
 *  BEFORE it runs. Mirrors `codexMcpArgs` on the server. */
export function addCommandPreview(name: string, transport: ConnectorTransportInput): string {
  const target =
    transport.kind === "stdio"
      ? `-- ${[transport.command, ...transport.args].join(" ")}`
      : `--url ${transport.url}`;
  return `codex mcp add ${name === "" ? "<name>" : name} ${target}`;
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
  { value: "stdio", label: "Command" },
  { value: "http", label: "URL" },
];

export interface AddConnectorDraft {
  name: string;
  kind: TransportKind;
  command: string;
  argsText: string;
  url: string;
}

export const EMPTY_DRAFT: AddConnectorDraft = {
  name: "",
  kind: "stdio",
  command: "",
  argsText: "",
  url: "",
};

/**
 * The draft as a request, or the sentence that stops it. Pure and total, so
 * the preview, the disabled state and the submit all read the same answer —
 * a form that renders a command it will then refuse to run is worse than one
 * that never showed it.
 */
export function draftToRequest(
  draft: AddConnectorDraft,
): { ok: true; transport: ConnectorTransportInput } | { ok: false; problem: string } {
  if (!CONNECTOR_NAME_PATTERN.test(draft.name)) {
    return { ok: false, problem: "A name uses letters, numbers, '-' and '_' only." };
  }
  if (draft.name.length > CONNECTOR_NAME_MAX_LENGTH) {
    return { ok: false, problem: `A name is at most ${CONNECTOR_NAME_MAX_LENGTH} characters.` };
  }
  if (draft.kind === "stdio") {
    const command = draft.command.trim();
    if (command.length === 0) {
      return { ok: false, problem: "Name the program codex should run." };
    }
    const args = argumentLines(draft.argsText);
    if (args.length > CONNECTOR_ARGS_MAX) {
      return { ok: false, problem: `At most ${CONNECTOR_ARGS_MAX} arguments.` };
    }
    return { ok: true, transport: { kind: "stdio", command, args } };
  }
  const url = draft.url.trim();
  let protocol = "";
  try {
    protocol = new URL(url).protocol;
  } catch {
    return { ok: false, problem: "Enter an http:// or https:// URL." };
  }
  if (protocol !== "http:" && protocol !== "https:") {
    return { ok: false, problem: "Enter an http:// or https:// URL." };
  }
  return { ok: true, transport: { kind: "http", url } };
}

export interface AddConnectorFormProps {
  draft: AddConnectorDraft;
  onDraftChange: (draft: AddConnectorDraft) => void;
  onSubmit: (transport: ConnectorTransportInput) => void;
  onCancel: () => void;
  pending: boolean;
}

export function AddConnectorForm({
  draft,
  onDraftChange,
  onSubmit,
  onCancel,
  pending,
}: AddConnectorFormProps) {
  const fieldId = useId();
  const parsed = draftToRequest(draft);
  const preview = parsed.ok ? addCommandPreview(draft.name, parsed.transport) : null;

  return (
    <form
      className="space-y-3 rounded-md border border-border p-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (parsed.ok && !pending) {
          onSubmit(parsed.transport);
        }
      }}
    >
      <div className="space-y-1">
        <Label htmlFor={`${fieldId}-name`}>Name</Label>
        <Input
          id={`${fieldId}-name`}
          value={draft.name}
          placeholder="my-server"
          onChange={(event) => onDraftChange({ ...draft, name: event.target.value })}
        />
      </div>
      <ChoiceRow
        label="How codex reaches this server"
        options={TRANSPORT_CHOICES}
        value={draft.kind}
        onChange={(kind) => onDraftChange({ ...draft, kind })}
      />
      {draft.kind === "stdio" ? (
        <>
          <div className="space-y-1">
            <Label htmlFor={`${fieldId}-command`}>Command</Label>
            <Input
              id={`${fieldId}-command`}
              value={draft.command}
              placeholder="npx"
              onChange={(event) => onDraftChange({ ...draft, command: event.target.value })}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor={`${fieldId}-args`}>Arguments</Label>
            <Textarea
              id={`${fieldId}-args`}
              value={draft.argsText}
              placeholder={"-y\n@modelcontextprotocol/server-everything"}
              onChange={(event) => onDraftChange({ ...draft, argsText: event.target.value })}
            />
            <p className="text-xs text-muted-foreground">
              One per line — never split or quoted, so a path with a space stays one argument.
            </p>
          </div>
        </>
      ) : (
        <div className="space-y-1">
          <Label htmlFor={`${fieldId}-url`}>URL</Label>
          <Input
            id={`${fieldId}-url`}
            value={draft.url}
            placeholder="https://example.com/mcp"
            onChange={(event) => onDraftChange({ ...draft, url: event.target.value })}
          />
        </div>
      )}
      <p className="text-xs text-muted-foreground">
        An MCP server is a program codex runs on this machine, or a service it sends note content
        to. It can reach whatever you can. Add only servers you trust.
      </p>
      {preview === null ? (
        <p className="text-xs text-destructive">{parsed.ok ? "" : parsed.problem}</p>
      ) : (
        <p className="overflow-x-auto rounded bg-muted px-2 py-1 font-mono text-xs whitespace-pre">
          {preview}
        </p>
      )}
      <div className="flex gap-2">
        <Button type="submit" size="xs" disabled={!parsed.ok || pending}>
          Add connector
        </Button>
        <Button type="button" size="xs" variant="outline" onClick={onCancel} disabled={pending}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

export interface ConnectorListProps {
  servers: readonly Connector[];
  onRemove: (name: string) => void;
  pending: boolean;
}

export function ConnectorList({ servers, onRemove, pending }: ConnectorListProps) {
  if (servers.length === 0) {
    return <p className="text-sm text-muted-foreground">No MCP servers are configured.</p>;
  }
  return (
    <ul className="space-y-2">
      {servers.map((server) => {
        const target = connectorTarget(server.transport);
        return (
          <li key={server.name} className="space-y-0.5">
            <div className="flex items-baseline justify-between gap-2">
              <span className="truncate text-sm">{server.name}</span>
              <Button
                size="xs"
                variant="ghost"
                disabled={pending}
                onClick={() => onRemove(server.name)}
              >
                Remove
              </Button>
            </div>
            <p className="truncate font-mono text-xs text-muted-foreground" title={target}>
              {target}
            </p>
            {/* Codex's own words, unaltered — the Agent section above shows
                machine vocabulary the same way rather than paraphrasing it. */}
            <p className="font-mono text-xs text-muted-foreground">
              {[server.enabled ? "enabled" : "disabled", server.authStatus]
                .filter((part) => part !== null)
                .join(" · ")}
            </p>
          </li>
        );
      })}
    </ul>
  );
}

export function ConnectorsSection() {
  const { api } = useWorkspace();
  const queryClient = useQueryClient();
  const connectorsQuery = useConnectors();
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<AddConnectorDraft>(EMPTY_DRAFT);
  const [pending, setPending] = useState(false);

  // Both writes answer with the whole listing, so the cache takes the server's
  // own view rather than a re-read of what it just returned.
  const applyServers = (servers: readonly Connector[]): void => {
    const next: ConnectorsResponse = { state: "ready", servers: [...servers] };
    queryClient.setQueryData<ConnectorsResponse>(queryKeys.connectors, () => next);
  };

  const add = (transport: ConnectorTransportInput): void => {
    setPending(true);
    void (async () => {
      try {
        const result = await unwrap(
          await api.connectors.add.$post({ json: { name: draft.name, transport } }),
        );
        applyServers(result.servers);
        setDraft(EMPTY_DRAFT);
        setAdding(false);
      } catch (error) {
        failed(error, `Could not add ${draft.name}.`);
      } finally {
        setPending(false);
      }
    })();
  };

  const remove = (name: string): void => {
    void (async () => {
      const confirmed = await confirm({
        title: `Remove the connector ${name}?`,
        body: "Codex stops offering its tools to the agent. The server itself is not touched.",
        confirmLabel: "Remove",
        destructive: true,
      });
      if (!confirmed) {
        return;
      }
      setPending(true);
      try {
        const result = await unwrap(await api.connectors.remove.$post({ json: { name } }));
        applyServers(result.servers);
      } catch (error) {
        failed(error, `Could not remove ${name}.`);
      } finally {
        setPending(false);
      }
    })();
  };

  const connectors = connectorsQuery.data;

  return (
    <section className="space-y-2">
      <SectionHeading>Connectors</SectionHeading>
      {connectors === undefined ? (
        <p className="text-sm text-muted-foreground">…</p>
      ) : connectors.state === "unavailable" ? (
        <p className="text-xs text-muted-foreground">{connectors.detail}</p>
      ) : (
        <>
          <ConnectorList servers={connectors.servers} onRemove={remove} pending={pending} />
          {adding ? (
            <AddConnectorForm
              draft={draft}
              onDraftChange={setDraft}
              onSubmit={add}
              onCancel={() => {
                setDraft(EMPTY_DRAFT);
                setAdding(false);
              }}
              pending={pending}
            />
          ) : (
            <Button size="xs" variant="outline" onClick={() => setAdding(true)}>
              Add connector
            </Button>
          )}
        </>
      )}
    </section>
  );
}
