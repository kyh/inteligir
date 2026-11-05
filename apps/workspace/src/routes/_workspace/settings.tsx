// Settings as its own route: deep-linkable, back and forward work, and its account rows are
// asked for as the route loads, so they draw at once when the cell has answered. With no
// connection nothing is awaited, and each row says it needs one (`needs-connection.tsx`).

import { onlineManager } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";

import { SettingsPage } from "../../app/settings/settings-page";

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
    const { orpc } = context.library.wire;
    // a row whose call failed draws its own refusal, so a refused seed is not the route's failure
    await Promise.allSettled([
      context.queryClient.query({
        ...orpc.account.devices.list.queryOptions(),
        staleTime: "static",
      }),
      context.queryClient.query({
        ...orpc.account.assistants.list.queryOptions(),
        staleTime: "static",
      }),
      context.queryClient.query({
        ...orpc.library.agent.status.queryOptions(),
        staleTime: "static",
      }),
    ]);
  },
});
