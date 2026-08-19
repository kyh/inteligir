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
import { useQueryClient } from "@tanstack/react-query";
import type { VoiceStatusResponse } from "@repo/server-contract/voice";
import { useState } from "react";
import { queryKeys, unwrap } from "../api";
import { downloadPercent, useVoiceStatus } from "../voice-hooks";
import { useWorkspace } from "../workspace-context";
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
  const { api } = useWorkspace();
  const queryClient = useQueryClient();
  const statusQuery = useVoiceStatus();
  const [pending, setPending] = useState(false);
  const status = statusQuery.data;

  const applyStatus = (next: VoiceStatusResponse): void => {
    queryClient.setQueryData<VoiceStatusResponse>(queryKeys.voiceStatus, () => next);
  };

  const setEnabled = (enabled: boolean): void => {
    void (async () => {
      if (!enabled) {
        const confirmed = await confirm({
          title: "Turn off voice input?",
          body: "The downloaded speech model is deleted. Turning it back on downloads it again.",
          confirmLabel: "Turn off",
          destructive: true,
        });
        if (!confirmed) {
          return;
        }
      }
      setPending(true);
      try {
        applyStatus(
          await unwrap(
            enabled ? await api.voice.model.install.$post() : await api.voice.model.remove.$post(),
          ),
        );
      } catch (error) {
        failed(error, enabled ? "Could not start the download." : "Could not delete the model.");
      } finally {
        setPending(false);
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
