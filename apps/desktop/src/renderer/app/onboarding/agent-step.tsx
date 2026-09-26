// The first run's offer of the agent, over the one AgentSignIn. The vendors' store is shared with
// their own apps, so a Mac already signed in to the default agent is shown connected instead.
// Skipped, the app is a notes app, and ⌘K offers the same sign-in when it is first pressed.

import type { AgentsStatusResponse } from "@repo/api/local/agents/agents-schema";
import { Button } from "@repo/ui/components/button";
import { Spinner } from "@repo/ui/components/spinner";
import { useAgentsStatus } from "../agents/agent-hooks";
import { AgentSignIn } from "../agents/agent-sign-in";

const connectedDefault = (status: AgentsStatusResponse): string | null => {
  const harness = status.harnesses.find((candidate) => candidate.id === status.defaultId);
  if (harness?.runtime !== "bundled" || harness.account.state !== "signed-in") {
    return null;
  }
  const { email } = harness.account;
  return email === null
    ? `You're signed in to ${harness.displayName}.`
    : `You're signed in to ${harness.displayName} as ${email}.`;
};

// the vendors take a moment to answer, and skipping needs nothing from them
const Offer = ({ onNext }: { onNext: () => void }) => {
  const status = useAgentsStatus().data;
  const connected = status === undefined ? null : connectedDefault(status);
  if (connected !== null) {
    return (
      <div className="space-y-3">
        <p className="text-body">{connected}</p>
        <Button onClick={onNext}>Continue</Button>
      </div>
    );
  }
  return (
    <div className="space-y-3">
      {status === undefined ? <Spinner className="text-muted-foreground" /> : <AgentSignIn />}
      <Button variant="ghost" size="compact" className="-ml-2" onClick={onNext}>
        Skip for now
      </Button>
    </div>
  );
};

export const AgentStep = ({ onNext }: { onNext: () => void }) => (
  <>
    <div className="space-y-1">
      <h1 className="text-title font-medium">Work with an agent</h1>
      <p className="text-body text-muted-foreground">
        The agent reads and edits your notes with you when you ask it to. It works on your own
        Claude or ChatGPT plan.
      </p>
    </div>
    <Offer onNext={onNext} />
  </>
);
