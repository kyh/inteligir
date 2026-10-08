// The account step, skippable, drawn over the workspace like Settings. The shell lands a data
// dir's first launch here (`WELCOME_PATH` in apps/desktop/src-tauri/src/window.rs).

import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { AccountStep } from "../../app/onboarding/account-step";

const Welcome = () => {
  const navigate = useNavigate({ from: Route.fullPath });
  return (
    <div className="flex h-full overflow-y-auto p-8">
      <div data-welcome-step="account" className="m-auto flex w-full max-w-md flex-col gap-5">
        <AccountStep
          onNext={() => {
            void navigate({ to: "/" });
          }}
        />
      </div>
    </div>
  );
};

export const Route = createFileRoute("/_workspace/welcome")({
  component: Welcome,
});
