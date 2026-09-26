import type { HarnessStatus } from "@repo/api/local/agents/agents-schema";
import type { AgentStatus } from "@repo/api/local/system/system-schema";
import { Button } from "@repo/ui/components/button";
import { confirm } from "@repo/ui/components/confirm-dialog";
import { toast } from "@repo/ui/components/sonner";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { failed, orpc } from "../api";
import { useAgentsStatus } from "../agents/agent-hooks";
import { AgentSignIn } from "../agents/agent-sign-in";
import { useDataDirScope, useSystemStatus } from "../vault-hooks";
import { SecondVaultNote, SectionHeading } from "./settings-chrome";

const accountSentence = (harness: HarnessStatus): string => {
  if (harness.runtime === "missing") {
    return "This copy of inteligir is missing it. Reinstall the app to use it.";
  }
  const { account } = harness;
  switch (account.state) {
    case "signed-in": {
      return account.email === null
        ? `Signed in · ${account.label}`
        : `Signed in · ${account.label} · ${account.email}`;
    }
    case "signed-out": {
      return "Signed out";
    }
    case "unknown": {
      return "Couldn't tell whether it's signed in.";
    }
    // no default
  }
};

// Only the ACP runtime runs a signed-in agent; the others say so in a sentence, never by the
// configuration's own names.
const RUNTIME_SENTENCES = {
  acp: null,
  off: "Actions are turned off on this Mac.",
  scripted: "Actions run on a stand-in agent here, not on your Claude or ChatGPT plan.",
  unavailable: "Actions can't start on this Mac right now.",
} satisfies Record<AgentStatus["runtime"], string | null>;

const RuntimeNote = ({ agent }: { agent: AgentStatus | undefined }) => {
  const sentence = agent === undefined ? null : RUNTIME_SENTENCES[agent.runtime];
  if (agent === undefined || sentence === null) {
    return null;
  }
  return (
    <p className="text-body text-muted-foreground">
      {agent.detail === null ? sentence : `${sentence} ${agent.detail}`}
    </p>
  );
};

const HarnessCard = ({
  harness,
  isDefault,
  onUseForNew,
  onSignOut,
  busy,
}: {
  harness: HarnessStatus;
  isDefault: boolean;
  onUseForNew: () => void;
  onSignOut: () => void;
  busy: boolean;
}) => {
  const signedIn = harness.runtime === "bundled" && harness.account.state === "signed-in";
  return (
    <div className="space-y-1.5 py-2">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-subtitle font-medium">{harness.displayName}</p>
        {isDefault ? (
          <span className="shrink-0 text-body text-muted-foreground">Used for new actions</span>
        ) : null}
      </div>
      <p className="text-body text-muted-foreground">{accountSentence(harness)}</p>
      {signedIn ? (
        <div className="flex flex-wrap gap-2">
          {isDefault ? null : (
            <Button size="compact" variant="tertiary" disabled={busy} onClick={onUseForNew}>
              Use for new actions
            </Button>
          )}
          <Button size="compact" variant="ghost" disabled={busy} onClick={onSignOut}>
            Sign out of {harness.displayName}
          </Button>
        </div>
      ) : (
        <AgentSignIn harness={harness.id} />
      )}
    </div>
  );
};

export const AgentsSection = () => {
  const queryClient = useQueryClient();
  const status = useAgentsStatus().data;
  const agent = useSystemStatus().data?.agent;
  const scope = useDataDirScope();
  const statusKey = orpc.agents.status.queryKey();

  const setDefault = useMutation(
    orpc.agents.setDefault.mutationOptions({
      onError: (cause) => {
        failed(cause, "Could not change the agent for new actions.");
      },
      onSuccess: (next) => {
        queryClient.setQueryData(statusKey, next);
      },
    }),
  );
  const signOut = useMutation(
    orpc.agents.signOut.mutationOptions({
      onError: (cause) => {
        failed(cause, "Could not sign out.");
      },
      onSuccess: (answer) => {
        queryClient.setQueryData(statusKey, answer.status);
        if (answer.outcome === "failed") {
          toast.error(answer.detail);
        }
      },
    }),
  );

  const confirmSignOut = (harness: HarnessStatus): void => {
    void (async () => {
      const confirmed = await confirm({
        body: `This also signs ${harness.vendorApp} out on this Mac: they share one sign-in. Actions can't use ${harness.displayName} until you sign in again.`,
        confirmLabel: `Sign out of ${harness.displayName}`,
        destructive: true,
        title: `Sign out of ${harness.displayName}?`,
      });
      if (confirmed) {
        signOut.mutate({ id: harness.id });
      }
    })();
  };

  // the server lists Claude first; everything after it is Other.
  const [first, ...others] = status?.harnesses ?? [];
  const card = (harness: HarnessStatus) => (
    <HarnessCard
      key={harness.id}
      harness={harness}
      isDefault={harness.id === status?.defaultId}
      busy={setDefault.isPending || signOut.isPending}
      onUseForNew={() => {
        setDefault.mutate({ id: harness.id });
      }}
      onSignOut={() => {
        confirmSignOut(harness);
      }}
    />
  );

  return (
    <section className="space-y-2">
      <SectionHeading>Agent</SectionHeading>
      <p className="text-body text-muted-foreground">
        The agent works on your notes with your own Claude or ChatGPT plan. An action keeps the
        agent it started on.
      </p>
      <RuntimeNote agent={agent} />
      {first === undefined ? null : <div className="divide-y divide-line">{card(first)}</div>}
      {others.length === 0 ? null : (
        <div>
          <p className="pt-1 text-caption font-medium text-muted-foreground uppercase">Other</p>
          <div className="divide-y divide-line">{others.map(card)}</div>
        </div>
      )}
      <SecondVaultNote scope={scope}>
        This vault keeps its own choice of agent for new actions. Signing in to Claude or ChatGPT
        counts for every vault on this Mac.
      </SecondVaultNote>
    </section>
  );
};
