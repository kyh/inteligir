import { harnessReadiness } from "@repo/api/local/agents/agents-schema";
import type { HarnessProbe, HarnessReadiness } from "@repo/api/local/agents/agents-schema";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { failed, orpc } from "../api";
import { useDataDirScope } from "../vault-hooks";
import { ChoiceRow, Row, SecondVaultNote, SectionHeading } from "./settings-chrome";

const READINESS_LABELS = {
  "needs-sign-in": "needs sign-in",
  "not-installed": "not installed",
  ready: "ready",
  unknown: "sign-in unknown",
} satisfies Record<HarnessReadiness, string>;

const readinessSentence = (probe: HarnessProbe, readiness: HarnessReadiness): string => {
  switch (readiness) {
    case "not-installed": {
      return `The ${probe.displayName} CLI was not found on PATH — install it, then sign in with: ${probe.loginCommand}`;
    }
    case "ready": {
      return "Signed in.";
    }
    case "needs-sign-in": {
      return `Not signed in — run: ${probe.loginCommand}`;
    }
    case "unknown": {
      return "Sign-in state unknown on this platform.";
    }
    // no default
  }
};

const HarnessRow = ({ probe }: { probe: HarnessProbe }) => {
  const readiness = harnessReadiness(probe);
  return (
    <div className="flex items-start justify-between gap-3 py-2">
      <div className="min-w-0">
        <p className="text-subtitle font-medium">{probe.displayName}</p>
        <p className="text-body text-muted-foreground">{readinessSentence(probe, readiness)}</p>
      </div>
      <span
        className={
          readiness === "ready"
            ? "shrink-0 rounded-full bg-emerald-500/15 px-2 py-0.5 text-body text-emerald-600"
            : "shrink-0 rounded-full bg-muted px-2 py-0.5 text-body text-muted-foreground"
        }
      >
        {READINESS_LABELS[readiness]}
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
