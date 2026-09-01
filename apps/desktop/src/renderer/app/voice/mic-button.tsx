// The composer's microphone: hold the state machine, draw one button, stream
// the words as they are spoken. It never sends — dictation is input, not a
// command channel, so the words land in the composer for the user to read and
// edit. Live now (issue #578): frames go up a websocket as the user speaks,
// partials come back for the dock to preview, and the final splices in on stop.
//
// THE BUTTON NEVER HIDES. With no model it is disabled and its label says what
// it needs, because an affordance that disappears asks the reader to already
// suspect it existed; on a machine with no usable runtime it says that instead.
// Both are the sentence the server sent, not one this file invented.

import { Button } from "@repo/ui/components/button";
import { Spinner } from "@repo/ui/components/spinner";
import { toast } from "@repo/ui/components/sonner";
import { cn } from "@repo/ui/lib/utils";
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

/** Fast enough to read as live, slow enough that a meter costs a handful of
 *  renders a second rather than sixty. */
const METER_INTERVAL_MS = 100;

/** A finalize that never answers (a wedged worker) must not strand the button
 *  in `finalizing` forever — far longer than a tail decode, short enough that a
 *  user is not left waiting on nothing. */
const FINALIZE_TIMEOUT_MS = 15_000;

export interface MicButtonProps {
  status: VoiceStatusResponse | undefined;
  /** Called with the authoritative transcript on release; the composer decides
   *  where it lands. */
  onTranscript: (transcript: string) => void;
  /** The live partial to preview while recording, or null when dictation ends
   *  (final, cancel, or error) — the composer renders it outside the field. */
  onPartial: (partial: string | null) => void;
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

export function MicButton({ status, onTranscript, onPartial, disabled }: MicButtonProps) {
  const [state, setState] = useState<DictationState>({ kind: "idle" });
  const captureRef = useRef<StreamCaptureHandle | null>(null);
  const clientRef = useRef<DictationStreamClient | null>(null);
  const finalizeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Stop the microphone, drop the socket, and clear the live preview — the
  // teardown every exit path runs. It touches only refs and props, never state,
  // so a caller pairs it with its own `setState`.
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

  // The unmount cleanup must run the LATEST teardown (a stale `onPartial` would
  // leave the preview orphaned), so it reaches it through a ref kept current.
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
          // Show the preview immediately ("Listening…") — the first real partial
          // replaces the empty string as soon as words are recognized.
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
    // Stop the microphone first, so no frame arrives after the finalize; the
    // socket stays open until the server answers the final.
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
