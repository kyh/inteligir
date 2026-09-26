import { harnessReadiness } from "@repo/api/local/agents/agents-schema";
import type { HarnessReadiness, HarnessStatus } from "@repo/api/local/agents/agents-schema";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { failed, orpc } from "../api";
import { useDataDirScope } from "../vault-hooks";
import { ChoiceRow, Row, SecondVaultNote, SectionHeading } from "./settings-chrome";

const READINESS_LABELS = {
  ready: "ready",
  "signed-out": "signed out",
  unavailable: "missing",
  unknown: "unknown",
} satisfies Record<HarnessReadiness, string>;

const readinessSentence = (status: HarnessStatus): string => {
  if (status.runtime === "missing") {
    return "This copy of inteligir is missing it. Reinstall the app to use it.";
  }
  const { account } = status;
  switch (account.state) {
    case "signed-in": {
      return account.email === null
        ? `Signed in with ${account.label}.`
        : `Signed in with ${account.label} as ${account.email}.`;
    }
    case "signed-out": {
      return "Signed out on this Mac.";
    }
    case "unknown": {
      return "Could not tell whether it is signed in.";
    }
    // no default
  }
};

const HarnessRow = ({ status }: { status: HarnessStatus }) => {
  const readiness = harnessReadiness(status);
  return (
    <div className="flex items-start justify-between gap-3 py-2">
      <div className="min-w-0">
        <p className="text-subtitle font-medium">{status.displayName}</p>
        <p className="text-body text-muted-foreground">{readinessSentence(status)}</p>
      </div>
      <span
        className={
          readiness === "ready"
            ? "shrink-0 rounded-full bg-success/15 px-2 py-0.5 text-body text-success"
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
    // a sign-in can change outside this app; opening the page asks the vendors again.
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
        Actions run on your own Claude or ChatGPT plan. Both ship with the app; the sign-in is
        yours.
      </p>
      <div className="mt-2 divide-y divide-line">
        {harnesses.map((harness) => (
          <HarnessRow key={harness.id} status={harness} />
        ))}
      </div>
      {status === undefined ? null : (
        <dl className="mt-3 space-y-1.5">
          <Row label="Default agent">
            <ChoiceRow
              label="Default agent"
              options={harnesses.map((harness) => ({
                label: harness.displayName,
                value: harness.id,
              }))}
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
