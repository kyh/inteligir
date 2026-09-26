import { Switch } from "@repo/ui/components/switch";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { failed, orpc } from "../api";
import { Row } from "./settings-chrome";

// This Mac's own choice, not the account's: off, its phone's requests wait for another Mac.
export const PhoneRequestsRow = () => {
  const queryClient = useQueryClient();
  const prefsQuery = useQuery({ ...orpc.cloud.prefs.queryOptions(), staleTime: 0 });
  const setPrefs = useMutation(
    orpc.cloud.setPrefs.mutationOptions({
      onError: (cause) => {
        failed(cause, "Could not change whether your phone can ask this Mac.");
      },
      onSuccess: (response) => {
        queryClient.setQueryData(orpc.cloud.prefs.queryKey(), response);
      },
    }),
  );

  const phoneRequests = prefsQuery.data?.phoneRequests;
  if (phoneRequests === undefined) {
    return <Row label="Phone">…</Row>;
  }
  return (
    <Row label="Phone">
      <span className="flex items-center gap-2">
        <Switch
          aria-label="Let my phone ask this Mac"
          checked={phoneRequests}
          disabled={setPrefs.isPending}
          onCheckedChange={(next) => {
            setPrefs.mutate({ phoneRequests: next });
          }}
        />
        <span className="text-subtitle text-muted-foreground">Let my phone ask this Mac</span>
      </span>
      <span className="mt-1 block text-body text-muted-foreground">
        {phoneRequests
          ? "What you ask the agent on your phone runs here while this Mac is open."
          : "What you ask on your phone waits for another Mac."}
      </span>
    </Row>
  );
};
