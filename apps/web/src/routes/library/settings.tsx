// Settings as its own route: deep-linkable, back and forward work, and its account rows are
// asked for as the route loads, so they draw at once when the cell has answered. The route waits
// for one answer, never for the retries: a row whose seed failed asks again, with the client's own
// retries, as it mounts. With no connection nothing is awaited, and each row says it needs one
// (`needs-connection.tsx`).

import { onlineManager } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";

import { accountReads } from "../../library/settings/account-section";
import { SettingsPage } from "../../library/settings/settings-page";

const Settings = () => {
  const navigate = useNavigate();
  return (
    <SettingsPage
      onBack={() => {
        void navigate({ search: true, to: "/" });
      }}
    />
  );
};

export const Route = createFileRoute("/_workspace/settings")({
  component: Settings,
  loader: async ({ context }) => {
    if (!onlineManager.isOnline()) {
      return;
    }
    const reads = accountReads(context.library.wire.orpc);
    const { queryClient } = context;
    // a row whose call failed draws its own refusal, so a refused seed is not the route's failure
    await Promise.allSettled([
      queryClient.query({ ...reads.devices, retry: 0, staleTime: "static" }),
      queryClient.query({ ...reads.assistants, retry: 0, staleTime: "static" }),
      queryClient.query({ ...reads.agent, retry: 0, staleTime: "static" }),
    ]);
  },
});
