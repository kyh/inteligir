// The device's account session as one hook, so the rail's footer and Settings › Devices run the
// same sign-in, sign-out and status: two spellings of a credential flow are two to audit.

import type { CloudStatusResponse } from "@repo/api/local/cloud/cloud-schema";
import { confirm } from "@repo/ui/components/confirm-dialog";
import { toast } from "@repo/ui/components/sonner";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { orpc, refusalMessage } from "./api";
import { useVaultStatus } from "./vault-hooks";

// Nothing on the ws bus announces a sync pass, so the status polls while a consumer is mounted.
const STATUS_POLL_MS = 5000;

const failed = (cause: Error, fallback: string): void => {
  toast.error(refusalMessage(cause, fallback));
};

export interface CloudSession {
  status: CloudStatusResponse | undefined;
  pending: boolean;
  // the cloud's own words for why a sign-in was refused
  refusal: string | null;
  signIn: (login: { email: string; password: string }) => void;
  // confirms first: a surface greyed out while the dialog waits claims work that has not started
  signOut: () => void;
  syncThreads: () => void;
}

export const useCloudSession = (): CloudSession => {
  const queryClient = useQueryClient();
  const { data: vaultStatus } = useVaultStatus();
  const statusQuery = useQuery({
    ...orpc.cloud.status.queryOptions(),
    refetchInterval: STATUS_POLL_MS,
    staleTime: 0,
  });
  const [refusal, setRefusal] = useState<string | null>(null);

  const applyStatus = (next: CloudStatusResponse): void => {
    queryClient.setQueryData(orpc.cloud.status.queryKey(), next);
  };
  const login = useMutation(
    orpc.cloud.login.mutationOptions({
      onError: (error) => {
        setRefusal(refusalMessage(error, "Could not sign in."));
      },
      onSuccess: (next) => {
        setRefusal(null);
        applyStatus(next);
      },
    }),
  );
  const logout = useMutation(
    orpc.cloud.logout.mutationOptions({
      onError: (error) => {
        failed(error, "Could not sign this device out.");
      },
      onSuccess: applyStatus,
    }),
  );
  const sync = useMutation(
    orpc.cloud.syncNow.mutationOptions({
      onError: (error) => {
        failed(error, "Could not run a sync.");
      },
      onSuccess: applyStatus,
    }),
  );

  const signOut = (): void => {
    void (async () => {
      // Only an account-derived vault remote dies with the credential.
      const vaultViaAccount =
        vaultStatus !== undefined &&
        vaultStatus.state !== "no-remote" &&
        vaultStatus.remoteSource === "account";
      const confirmed = await confirm({
        body: `This machine forgets its credential and everything queued for the cloud.${vaultViaAccount ? " Your vault stops syncing through your account." : ""} Your notes and threads stay here. The device stays listed on your account until you revoke it there.`,
        confirmLabel: "Sign out",
        destructive: true,
        title: "Stop syncing this device?",
      });
      if (!confirmed) {
        return;
      }
      setRefusal(null);
      logout.mutate();
    })();
  };

  return {
    pending: login.isPending || logout.isPending || sync.isPending,
    refusal,
    signIn: login.mutate,
    signOut,
    status: statusQuery.data,
    syncThreads: sync.mutate,
  };
};
