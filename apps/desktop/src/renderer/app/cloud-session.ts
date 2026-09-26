// The device's account session as one hook, so the rail's footer and Settings › Account run the
// same sign-in, sign-up, sign-out and status: two spellings of a credential flow are two to audit.

import type {
  CloudLoginRequest,
  CloudSignUpRequest,
  CloudStatusResponse,
} from "@repo/api/local/cloud/cloud-schema";
import { confirm } from "@repo/ui/components/confirm-dialog";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { failed, orpc, refusalMessage } from "./api";
import { useVaultStatus } from "./vault-hooks";

export interface CloudSession {
  status: CloudStatusResponse | undefined;
  pending: boolean;
  // the cloud's own words for why a sign-in or a sign-up was refused
  refusal: string | null;
  signIn: (request: CloudLoginRequest) => void;
  signUp: (request: CloudSignUpRequest) => void;
  // confirms first: a surface greyed out while the dialog waits claims work that has not started
  signOut: () => void;
  syncThreads: () => void;
}

export const useCloudSession = (): CloudSession => {
  const queryClient = useQueryClient();
  const { data: vaultStatus } = useVaultStatus();
  const statusQuery = useQuery(orpc.cloud.status.queryOptions());
  const [refusal, setRefusal] = useState<string | null>(null);

  const applyStatus = (next: CloudStatusResponse): void => {
    queryClient.setQueryData(orpc.cloud.status.queryKey(), next);
  };
  const joined = (next: CloudStatusResponse): void => {
    setRefusal(null);
    applyStatus(next);
  };
  const login = useMutation(
    orpc.cloud.login.mutationOptions({
      onError: (error) => {
        setRefusal(refusalMessage(error, "Could not sign in."));
      },
      onSuccess: joined,
    }),
  );
  const signUp = useMutation(
    orpc.cloud.signUp.mutationOptions({
      onError: (error) => {
        setRefusal(refusalMessage(error, "Could not create the account."));
      },
      onSuccess: joined,
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
        body: `This machine forgets its credential and everything queued for the cloud, and revokes itself on your account if it can reach it.${vaultViaAccount ? " Your vault stops syncing through your account." : ""} Your notes and threads stay here.`,
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
    pending: login.isPending || signUp.isPending || logout.isPending || sync.isPending,
    refusal,
    signIn: login.mutate,
    signOut,
    signUp: signUp.mutate,
    status: statusQuery.data,
    syncThreads: sync.mutate,
  };
};
