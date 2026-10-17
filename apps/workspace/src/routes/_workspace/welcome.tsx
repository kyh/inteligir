// Where the app window opens after a first run: the agent, then an account, each skippable, drawn
// over the workspace like Settings so the library is already loading underneath. The step rides
// the url, so Back returns to the one before. Finishing lands on the library.

import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { z } from "zod";
import { AccountStep } from "../../app/onboarding/account-step";
import { AgentStep } from "../../app/onboarding/agent-step";

const welcomeSearchSchema = z.object({
  // oxlint-disable-next-line promise/valid-params, promise/prefer-await-to-then -- zod's catch, not a promise's: it takes the fallback positionally
  step: z.catch(z.enum(["agent", "account"]), "agent"),
});

const Welcome = () => {
  const { step } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  return (
    <div className="flex h-full overflow-y-auto p-8">
      <div data-welcome-step={step} className="m-auto flex w-full max-w-md flex-col gap-5">
        {step === "agent" ? (
          <AgentStep
            onNext={() => {
              void navigate({ search: (prior) => ({ ...prior, step: "account" }) });
            }}
          />
        ) : (
          <AccountStep
            onNext={() => {
              void navigate({ search: {}, to: "/" });
            }}
          />
        )}
      </div>
    </div>
  );
};

export const Route = createFileRoute("/_workspace/welcome")({
  component: Welcome,
  validateSearch: welcomeSearchSchema,
});
