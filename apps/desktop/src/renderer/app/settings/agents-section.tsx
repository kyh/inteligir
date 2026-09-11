import type { HarnessProbe } from "@repo/api/local/agents/agents-schema";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { orpc } from "../api";
import { useDataDirScope } from "../vault-hooks";
import { ChoiceRow, failed, Row, SecondVaultNote, SectionHeading } from "./settings-chrome";

const credentialSentence = (probe: HarnessProbe): string => {
  switch (probe.credentials) {
    case "present": {
      return "Signed in.";
    }
    case "unknown": {
      return "Sign-in state unknown on this platform.";
    }
    case "absent": {
      return probe.cliPath === null
        ? "Not signed in."
        : `Not signed in — run: ${probe.loginCommand}`;
    }
    // no default
  }
};

const readinessLabel = (probe: HarnessProbe, ready: boolean): string => {
  if (probe.cliPath === null) {
    return "not installed";
  }
  return ready ? "ready" : "needs sign-in";
};

const HarnessRow = ({ probe }: { probe: HarnessProbe }) => {
  const ready = probe.cliPath !== null && probe.credentials === "present";
  return (
    <div className="flex items-start justify-between gap-3 py-2">
      <div className="min-w-0">
        <p className="text-subtitle font-medium">{probe.displayName}</p>
        <p className="text-body text-muted-foreground">
          {probe.cliPath === null
            ? `The ${probe.displayName} CLI was not found on PATH — install it, then sign in with: ${probe.loginCommand}`
            : credentialSentence(probe)}
        </p>
      </div>
      <span
        className={
          ready
            ? "shrink-0 rounded-full bg-emerald-500/15 px-2 py-0.5 text-body text-emerald-600"
            : "shrink-0 rounded-full bg-muted px-2 py-0.5 text-body text-muted-foreground"
        }
      >
        {readinessLabel(probe, ready)}
      </span>
    </div>
  );
};

export const AgentsSection = () => {
  const queryClient = useQueryClient();
  const statusQuery = useQuery({
    ...orpc.agents.status.queryOptions(),
    // Login state changes outside this app; opening the page re-probes.
    staleTime: 0,
  });
  const setDefault = useMutation(
    orpc.agents.setDefault.mutationOptions({
      onError: (cause) => {
        failed(cause, "Could not set the default agent.");
      },
      onSuccess: (status) => {
        queryClient.setQueryData(orpc.agents.status.queryKey(), status);
      },
    }),
  );
  const status = statusQuery.data;
  const harnesses = status?.harnesses ?? [];
  const scope = useDataDirScope();

  return (
    <section>
      <SectionHeading>Agents</SectionHeading>
      <p className="text-body text-muted-foreground">
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
              options={harnesses.map((probe) => ({ label: probe.displayName, value: probe.id }))}
              value={status.defaultId}
              onChange={(id) => {
                setDefault.mutate({ id });
              }}
            />
            <span className="mt-1 block text-body text-muted-foreground">
              New actions start on this agent. An action keeps the agent it started on.
            </span>
            <SecondVaultNote scope={scope} />
          </Row>
        </dl>
      )}
    </section>
  );
};
