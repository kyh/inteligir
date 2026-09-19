import { Button } from "@repo/ui/components/button";
import { Spinner } from "@repo/ui/components/spinner";
import { toast } from "@repo/ui/components/sonner";
import { cn } from "@repo/ui/lib/cn";
import type { VoiceStatusResponse } from "@repo/api/local/voice/voice-schema";
import { MicIcon, MicOffIcon, SquareIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { socketOrigin } from "../socket-origin";
import { downloadPercent } from "../voice-hooks";
import { voiceStreamUrl } from "@repo/api/local/routes";
import { browserDictationSocket, DictationStreamClient } from "./dictation-stream";
import { microphoneProblem, startStreamingCapture } from "./dictation";
import type { DictationState, StreamCaptureHandle } from "./dictation";

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

export const micBlockedReason = (status?: VoiceStatusResponse): string | null => {
  if (status === undefined) {
    return "Checking whether this machine can transcribe…";
  }
  switch (status.state) {
    case "unavailable": {
      return status.detail;
    }
    case "no-model": {
      return `Dictation needs the ${status.model.label} model (${Math.round(status.model.sizeBytes / 1_000_000)} MB). Turn on voice input in Settings.`;
    }
    case "downloading": {
      return `Downloading ${status.model.label} — ${downloadPercent(status.receivedBytes, status.model.sizeBytes)}%`;
    }
    case "preparing": {
      return "Preparing the speech model — this happens once.";
    }
    case "ready": {
      return null;
    }
    default: {
      const exhaustive: never = status;
      return exhaustive;
    }
  }
};

const micLabel = (kind: DictationState["kind"], blocked: string | null): string => {
  if (kind === "recording") {
    return "Stop dictating";
  }
  if (kind === "finalizing") {
    return "Transcribing";
  }
  return blocked ?? "Dictate";
};

export const MicButton = ({ status, onTranscript, onPartial, disabled }: MicButtonProps) => {
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
    return () => {
      clearInterval(timer);
    };
  }, [state.kind]);

  const blocked = micBlockedReason(status);

  const begin = (): void => {
    setState({ kind: "requesting" });
    const client = new DictationStreamClient({
      createSocket: () => browserDictationSocket(voiceStreamUrl(socketOrigin())),
      handlers: {
        onError: (message) => {
          stopSession();
          setState({ kind: "idle" });
          toast.error(message);
        },
        onFinal: (transcript) => {
          stopSession();
          setState({ kind: "idle" });
          if (transcript === "") {
            toast.error("Nothing was said in that recording.");
          } else {
            onTranscript(transcript);
          }
        },
        onPartial: (partial) => {
          onPartial(partial);
        },
      },
    });
    clientRef.current = client;
    client.start();
    void (async () => {
      try {
        captureRef.current = await startStreamingCapture((pcm) => {
          client.pushPcm(pcm);
        });
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
  const label = micLabel(state.kind, blocked);
  let glyph: React.ReactNode;
  if (busy) {
    glyph = <Spinner />;
  } else if (state.kind === "recording") {
    glyph = (
      <SquareIcon
        className="transition-transform"
        style={{ transform: `scale(${(0.8 + state.level * 0.5).toFixed(2)})` }}
      />
    );
  } else if (blocked === null) {
    glyph = <MicIcon />;
  } else {
    glyph = <MicOffIcon className={cn("text-muted-foreground")} />;
  }

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
      {glyph}
    </Button>
  );
};
