import type { HarnessProbe } from "@repo/api/local/agents/agents-schema";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { orpc } from "../api";
import { ChoiceRow, failed, Row, SectionHeading } from "./settings-chrome";

function credentialSentence(probe: HarnessProbe): string {
  switch (probe.credentials) {
    case "present":
      return "Signed in.";
    case "unknown":
      return "Sign-in state unknown on this platform.";
    case "absent":
      return probe.cliPath === null
        ? "Not signed in."
        : `Not signed in — run: ${probe.loginCommand}`;
  }
}

function HarnessRow({ probe }: { probe: HarnessProbe }) {
  const ready = probe.cliPath !== null && probe.credentials === "present";
  return (
    <div className="flex items-start justify-between gap-3 py-2">
      <div className="min-w-0">
        <p className="text-sm font-medium">{probe.displayName}</p>
        <p className="text-xs text-muted-foreground">
          {probe.cliPath === null
            ? `The ${probe.displayName} CLI was not found on PATH — install it, then sign in with: ${probe.loginCommand}`
            : credentialSentence(probe)}
        </p>
      </div>
      <span
        className={
          ready
            ? "shrink-0 rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs text-emerald-600"
            : "shrink-0 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground"
        }
      >
        {ready ? "ready" : probe.cliPath === null ? "not installed" : "needs sign-in"}
      </span>
    </div>
  );
}

export function AgentsSection() {
  const queryClient = useQueryClient();
  const statusQuery = useQuery({
    ...orpc.agents.status.queryOptions(),
    // Login state changes outside this app; opening the page re-probes.
    staleTime: 0,
  });
  const setDefault = useMutation(
    orpc.agents.setDefault.mutationOptions({
      onSuccess: (status) => {
        queryClient.setQueryData(orpc.agents.status.queryKey(), status);
      },
      onError: (cause) => {
        failed(cause, "Could not set the default agent.");
      },
    }),
  );
  const status = statusQuery.data;
  const harnesses = status?.harnesses ?? [];

  return (
    <section>
      <SectionHeading>Agents</SectionHeading>
      <p className="text-xs text-muted-foreground">
        Actions run on your own agent subscriptions. The protocol adapters ship with the app; the
        CLIs and their sign-ins are yours.
      </p>
      <div className="mt-2 divide-y divide-line">
        {harnesses.map((probe) => (
          <HarnessRow key={probe.id} probe={probe} />
        ))}
      </div>
      {status === undefined ? null : (
        <dl className="mt-3 space-y-1.5">
          <Row label="Default agent">
            <ChoiceRow
              label="Default agent"
              options={harnesses.map((probe) => ({ value: probe.id, label: probe.displayName }))}
              value={status.defaultId}
              onChange={(id) => {
                setDefault.mutate({ id });
              }}
            />
            <span className="mt-1 block text-xs text-muted-foreground">
              New actions start on this agent. An action keeps the agent it started on.
            </span>
          </Row>
        </dl>
      )}
    </section>
  );
}
