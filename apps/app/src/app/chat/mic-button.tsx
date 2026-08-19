// The composer's microphone: hold the state machine, draw one button, hand the
// transcript back. It never sends — dictation is input, not a command channel,
// so the words land in the composer for the user to read and edit.
//
// THE BUTTON NEVER HIDES. With no model it is disabled and its label says what
// it needs, because an affordance that disappears asks the reader to already
// suspect it existed; on a machine with no usable runtime it says that
// instead. Both are the sentence the server sent, not one this file invented.

import { Button } from "@repo/ui/components/button";
import { Spinner } from "@repo/ui/components/spinner";
import { toast } from "@repo/ui/components/sonner";
import { cn } from "@repo/ui/lib/utils";
import type { VoiceStatusResponse } from "@repo/server-contract/voice";
import { MicIcon, MicOffIcon, SquareIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { refusalMessage, unwrap } from "../api";
import { downloadPercent } from "../voice-hooks";
import { useWorkspace } from "../workspace-context";
import {
  microphoneProblem,
  startCapture,
  toBase64,
  toPcm16,
  type CaptureHandle,
  type DictationState,
} from "./dictation";

/** Fast enough to read as live, slow enough that a meter costs a handful of
 *  renders a second rather than sixty. */
const METER_INTERVAL_MS = 100;

export interface MicButtonProps {
  status: VoiceStatusResponse | undefined;
  /** Called with what was said; the composer decides where it lands. */
  onTranscript: (transcript: string) => void;
  /** The composer is mid-send; a dictation would race its own insertion. */
  disabled: boolean;
}

/** What the button says it needs, or null when it can be pressed. */
export function micBlockedReason(status: VoiceStatusResponse | undefined): string | null {
  if (status === undefined) {
    return "Checking whether this machine can transcribe…";
  }
  switch (status.state) {
    case "unavailable":
      return status.detail;
    case "no-model":
      return `Dictation needs the ${status.model.label} model (${Math.round(status.model.sizeBytes / 1_000_000)} MB). Turn on voice input in Settings.`;
    case "downloading":
      return `Downloading ${status.model.label} — ${downloadPercent(status.receivedBytes, status.model.sizeBytes)}%`;
    case "preparing":
      return "Preparing the speech model — this happens once.";
    case "ready":
      return null;
  }
}

export function MicButton({ status, onTranscript, disabled }: MicButtonProps) {
  const { api } = useWorkspace();
  const [state, setState] = useState<DictationState>({ kind: "idle" });
  const captureRef = useRef<CaptureHandle | null>(null);

  // A dock that unmounts mid-recording must not leave the microphone open —
  // the browser keeps the indicator lit until the tracks are stopped.
  useEffect(
    () => () => {
      captureRef.current?.cancel();
      captureRef.current = null;
    },
    [],
  );

  useEffect(() => {
    if (state.kind !== "recording") {
      return;
    }
    const timer = setInterval(() => {
      const level = captureRef.current?.level() ?? 0;
      setState((current) =>
        current.kind === "recording" ? { kind: "recording", level } : current,
      );
    }, METER_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [state.kind]);

  const blocked = micBlockedReason(status);

  const begin = (): void => {
    setState({ kind: "requesting" });
    void (async () => {
      try {
        captureRef.current = await startCapture();
        setState({ kind: "recording", level: 0 });
      } catch (error) {
        captureRef.current = null;
        setState({ kind: "idle" });
        toast.error(microphoneProblem(error));
      }
    })();
  };

  const finish = (): void => {
    const capture = captureRef.current;
    if (capture === null) {
      setState({ kind: "idle" });
      return;
    }
    setState({ kind: "transcribing" });
    void (async () => {
      try {
        const samples = await capture.stop();
        captureRef.current = null;
        if (samples === null || samples.length === 0) {
          toast.error("Nothing was recorded.");
          return;
        }
        const result = await unwrap(
          await api.voice.transcribe.$post({ json: { pcm: toBase64(toPcm16(samples)) } }),
        );
        if (result.text === "") {
          toast.error("Nothing was said in that recording.");
          return;
        }
        onTranscript(result.text);
      } catch (error) {
        captureRef.current = null;
        toast.error(refusalMessage(error, "That recording could not be transcribed."));
      } finally {
        setState({ kind: "idle" });
      }
    })();
  };

  const recording = state.kind === "recording";
  const busy = state.kind === "requesting" || state.kind === "transcribing";
  const label = recording
    ? "Stop dictating"
    : state.kind === "transcribing"
      ? "Transcribing"
      : (blocked ?? "Dictate");

  return (
    <Button
      size="icon-sm"
      variant={recording ? "default" : "ghost"}
      aria-label={label}
      title={label}
      aria-pressed={recording}
      disabled={disabled || busy || (blocked !== null && !recording)}
      onClick={recording ? finish : begin}
    >
      {busy ? (
        <Spinner />
      ) : recording ? (
        <SquareIcon
          className="transition-transform"
          style={{ transform: `scale(${(0.8 + state.level * 0.5).toFixed(2)})` }}
        />
      ) : blocked === null ? (
        <MicIcon />
      ) : (
        <MicOffIcon className={cn("text-muted-foreground")} />
      )}
    </Button>
  );
}
