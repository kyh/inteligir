// Settings as its own route: deep-linkable, back and forward work, and its account rows are
// asked for as the route loads, so they draw at once when the cell has answered. The route waits
// for one answer, never for the retries: a row whose seed failed asks again, with the client's own
// retries, as it mounts. With no connection nothing is awaited, and each row says it needs one
// (`needs-connection.tsx`).

import { onlineManager } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";

import type { TabOpening } from "../library-tab";
import { accountReads } from "./account-section";
import { SettingsPage } from "./settings-page";

export const SettingsRoute = () => {
  const navigate = useNavigate();
  return (
    <SettingsPage
      onBack={() => {
        void navigate({ search: true, to: "/library" });
      }}
    />
  );
};

export const seedSettings = async ({
  context: { opening },
}: {
  context: { opening: TabOpening };
}): Promise<void> => {
  if (opening.kind !== "open" || !onlineManager.isOnline()) {
    return;
  }
  const reads = accountReads(opening.library.wire.orpc);
  const { queryClient } = opening;
  // a row whose call failed draws its own refusal, so a refused seed is not the route's failure
  await Promise.allSettled([
    queryClient.query({ ...reads.devices, retry: 0, staleTime: "static" }),
    queryClient.query({ ...reads.assistants, retry: 0, staleTime: "static" }),
    queryClient.query({ ...reads.agent, retry: 0, staleTime: "static" }),
  ]);
};
