// The server keeps no enabled flag: the model file on disk is the switch, so
// off deletes it and on downloads it.

import { Switch } from "@repo/ui/components/switch";
import { confirm } from "@repo/ui/components/confirm-dialog";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { VoiceStatusResponse } from "@repo/api/local/voice/voice-schema";
import { orpc } from "../api";
import { downloadPercent, useVoiceStatus } from "../voice-hooks";
import { failed, Row, SectionHeading } from "./settings-chrome";

const megabytes = (bytes: number): string => `${Math.round(bytes / 1_000_000)} MB`;

const stateLabel = (status: Exclude<VoiceStatusResponse, { state: "unavailable" }>): string => {
  switch (status.state) {
    case "ready": {
      return "On";
    }
    case "downloading": {
      return `Downloading — ${downloadPercent(status.receivedBytes, status.model.sizeBytes)}%`;
    }
    case "preparing": {
      return "Preparing — this happens once";
    }
    case "no-model": {
      return "Off";
    }
    // no default
  }
};

export const VoiceSection = () => {
  const queryClient = useQueryClient();
  const statusQuery = useVoiceStatus();
  const status = statusQuery.data;

  const applyStatus = (next: VoiceStatusResponse): void => {
    queryClient.setQueryData(orpc.voice.status.queryKey(), next);
  };

  const install = useMutation(
    orpc.voice.install.mutationOptions({
      onError: (error) => {
        failed(error, "Could not start the download.");
      },
      onSuccess: applyStatus,
    }),
  );
  const removeModel = useMutation(
    orpc.voice.remove.mutationOptions({
      onError: (error) => {
        failed(error, "Could not delete the model.");
      },
      onSuccess: applyStatus,
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
        body: "The downloaded speech model is deleted. Turning it back on downloads it again.",
        confirmLabel: "Turn off",
        destructive: true,
        title: "Turn off voice input?",
      });
      if (confirmed) {
        removeModel.mutate();
      }
    })();
  };

  const body = () => {
    if (status === undefined) {
      return <p className="text-sm text-muted-foreground">…</p>;
    }
    if (status.state === "unavailable") {
      return <p className="text-xs text-muted-foreground">{status.detail}</p>;
    }
    return (
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
    );
  };

  return (
    <section className="space-y-2">
      <SectionHeading>Voice</SectionHeading>
      {body()}
    </section>
  );
};
