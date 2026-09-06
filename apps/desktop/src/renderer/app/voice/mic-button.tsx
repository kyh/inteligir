import { Button } from "@repo/ui/components/button";
import { Spinner } from "@repo/ui/components/spinner";
import { toast } from "@repo/ui/components/sonner";
import { cn } from "cn";
import type { VoiceStatusResponse } from "@repo/api/local/voice/voice-schema";
import { MicIcon, MicOffIcon, SquareIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { socketOrigin } from "../socket-origin";
import { downloadPercent } from "../voice-hooks";
import { voiceStreamUrl } from "@repo/api/local/routes";
import { browserDictationSocket, DictationStreamClient } from "./dictation-stream";
import {
  microphoneProblem,
  startStreamingCapture,
  type DictationState,
  type StreamCaptureHandle,
} from "./dictation";

const METER_INTERVAL_MS = 100;

// A finalize a wedged worker never answers must not strand the button in
// `finalizing`.
const FINALIZE_TIMEOUT_MS = 15_000;

export interface MicButtonProps {
  status: VoiceStatusResponse | undefined;
  onTranscript: (transcript: string) => void;
  onPartial: (partial: string | null) => void;
  disabled: boolean;
}

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

export function MicButton({ status, onTranscript, onPartial, disabled }: MicButtonProps) {
  const [state, setState] = useState<DictationState>({ kind: "idle" });
  const captureRef = useRef<StreamCaptureHandle | null>(null);
  const clientRef = useRef<DictationStreamClient | null>(null);
  const finalizeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Touches refs and props only; each caller pairs it with its own setState.
  const stopSession = (): void => {
    if (finalizeTimerRef.current !== null) {
      clearTimeout(finalizeTimerRef.current);
      finalizeTimerRef.current = null;
    }
    captureRef.current?.stop();
    captureRef.current = null;
    clientRef.current?.cancel();
    clientRef.current = null;
    onPartial(null);
  };

  // The unmount cleanup needs the latest teardown: a stale `onPartial` would
  // leave the preview orphaned.
  const stopSessionRef = useRef(stopSession);
  useEffect(() => {
    stopSessionRef.current = stopSession;
  });
  useEffect(
    () => () => {
      stopSessionRef.current();
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
    const client = new DictationStreamClient({
      createSocket: () => browserDictationSocket(voiceStreamUrl(socketOrigin())),
      handlers: {
        onPartial: (partial) => onPartial(partial),
        onFinal: (transcript) => {
          stopSession();
          setState({ kind: "idle" });
          if (transcript !== "") {
            onTranscript(transcript);
          } else {
            toast.error("Nothing was said in that recording.");
          }
        },
        onError: (message) => {
          stopSession();
          setState({ kind: "idle" });
          toast.error(message);
        },
      },
    });
    clientRef.current = client;
    client.start();
    void (async () => {
      try {
        captureRef.current = await startStreamingCapture((pcm) => client.pushPcm(pcm));
        // The session may have been cancelled while permission was pending.
        if (clientRef.current === client) {
          setState({ kind: "recording", level: 0 });
          // "" shows the preview as "Listening…" until the first partial.
          onPartial("");
        } else {
          captureRef.current?.stop();
          captureRef.current = null;
        }
      } catch (error) {
        stopSession();
        setState({ kind: "idle" });
        toast.error(microphoneProblem(error));
      }
    })();
  };

  const finish = (): void => {
    const client = clientRef.current;
    if (client === null) {
      stopSession();
      setState({ kind: "idle" });
      return;
    }
    // Microphone first, so no frame arrives after the finalize.
    captureRef.current?.stop();
    captureRef.current = null;
    onPartial(null);
    setState({ kind: "finalizing" });
    client.finalize();
    finalizeTimerRef.current = setTimeout(() => {
      stopSession();
      setState({ kind: "idle" });
      toast.error("Dictation timed out before it finished.");
    }, FINALIZE_TIMEOUT_MS);
  };

  const recording = state.kind === "recording";
  const busy = state.kind === "requesting" || state.kind === "finalizing";
  const label = recording
    ? "Stop dictating"
    : state.kind === "finalizing"
      ? "Transcribing"
      : (blocked ?? "Dictate");

  return (
    <Button
      size="icon-compact"
      variant={recording ? "primary" : "ghost"}
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
