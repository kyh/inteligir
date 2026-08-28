// Settings → Voice: the switch that turns dictation on, which is the same act
// as downloading the model and deleting it.
//
// ONE CONTROL, because there is one fact. The server keeps no "enabled" flag —
// the model file on disk IS the switch — so this section cannot show a state
// the server does not have, and turning it off genuinely reclaims the bytes
// rather than leaving a model nothing can reach.
//
// THE SIZE IS SHOWN BEFORE IT IS SPENT. Turning this on starts a download the
// user did not otherwise ask for, so the number and the destination are on
// screen next to the switch, not discovered afterwards in a progress bar.

import { Switch } from "@repo/ui/components/switch";
import { confirm } from "@repo/ui/components/confirm-dialog";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { VoiceStatusResponse } from "@repo/api/local/voice/voice-schema";
import { orpc } from "../api";
import { downloadPercent, useVoiceStatus } from "../voice-hooks";
import { failed, Row, SectionHeading } from "./settings-chrome";

function megabytes(bytes: number): string {
  return `${Math.round(bytes / 1_000_000)} MB`;
}

/** What the switch's own state is called. `unavailable` is not here: that
 *  section renders a sentence instead of a switch, so it has no label. */
function stateLabel(status: Exclude<VoiceStatusResponse, { state: "unavailable" }>): string {
  switch (status.state) {
    case "ready":
      return "On";
    case "downloading":
      return `Downloading — ${downloadPercent(status.receivedBytes, status.model.sizeBytes)}%`;
    case "preparing":
      return "Preparing — this happens once";
    case "no-model":
      return "Off";
  }
}

export function VoiceSection() {
  const queryClient = useQueryClient();
  const statusQuery = useVoiceStatus();
  const status = statusQuery.data;

  const applyStatus = (next: VoiceStatusResponse): void => {
    queryClient.setQueryData(orpc.voice.status.queryKey(), next);
  };

  const install = useMutation(
    orpc.voice.install.mutationOptions({
      onSuccess: applyStatus,
      onError: (error) => {
        failed(error, "Could not start the download.");
      },
    }),
  );
  const removeModel = useMutation(
    orpc.voice.remove.mutationOptions({
      onSuccess: applyStatus,
      onError: (error) => {
        failed(error, "Could not delete the model.");
      },
    }),
  );
  const pending = install.isPending || removeModel.isPending;

  const setEnabled = (enabled: boolean): void => {
    if (enabled) {
      install.mutate();
      return;
    }
    void (async () => {
      const confirmed = await confirm({
        title: "Turn off voice input?",
        body: "The downloaded speech model is deleted. Turning it back on downloads it again.",
        confirmLabel: "Turn off",
        destructive: true,
      });
      if (confirmed) {
        removeModel.mutate();
      }
    })();
  };

  return (
    <section className="space-y-2">
      <SectionHeading>Voice</SectionHeading>
      {status === undefined ? (
        <p className="text-sm text-muted-foreground">…</p>
      ) : status.state === "unavailable" ? (
        <p className="text-xs text-muted-foreground">{status.detail}</p>
      ) : (
        <dl className="space-y-1.5">
          <Row label="Dictation">
            <span className="flex items-center gap-2">
              <Switch
                aria-label="Voice input"
                checked={status.state !== "no-model"}
                disabled={pending || status.state === "downloading" || status.state === "preparing"}
                onCheckedChange={setEnabled}
              />
              <span className="text-sm text-muted-foreground">{stateLabel(status)}</span>
            </span>
            <span className="mt-1 block text-xs text-muted-foreground">
              Speech is transcribed on this machine by {status.model.label} (
              {megabytes(status.model.sizeBytes)}, downloaded once). Nothing is sent anywhere.
            </span>
            {status.state === "no-model" && status.lastError !== null ? (
              <span className="mt-1 block text-xs text-destructive">{status.lastError}</span>
            ) : null}
          </Row>
        </dl>
      )}
    </section>
  );
}
