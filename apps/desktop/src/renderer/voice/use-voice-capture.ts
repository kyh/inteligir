// ---------------------------------------------------------------------------
// useVoiceCapture — the renderer's push-to-talk STT lifecycle as a hook.
// Wraps startSTT (which owns getUserMedia + the worklet + the IPC session)
// with the state a capture UI needs: a phase, the live transcript, and
// start/cancel/confirm. Extracted from the composer so the race handling is
// reusable and lives beside the rest of renderer/voice; when hands-free voice
// returns, this is also where a single STT-session arbiter belongs (main's
// recognizer is a singleton — two uncoordinated clients would finalize each
// other's streams).
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useRef, useState } from "react";

import { toast } from "@repo/ui/components/sonner";
import { toErrorMessage } from "@repo/features/wire-helpers";
import { startSTT, type STTHandle } from "@renderer/voice/stt";

/** The capture lifecycle. `starting` shows the listening surface immediately
 * (mic permission + recognizer spin-up can take a beat); `stopping` covers the
 * await on the recognizer's tail transcript. */
export type VoicePhase = "idle" | "starting" | "listening" | "stopping";

/** Join transcript segments with a single space, tolerating empty sides. */
function joinTranscript(a: string, b: string): string {
  if (!a) return b;
  if (!b) return a;
  return `${a} ${b}`;
}

export function useVoiceCapture(): {
  phase: VoicePhase;
  /** Finalized utterances + the live partial, joined for display. */
  transcript: string;
  start: () => Promise<void>;
  /** Abandon the session; tail transcripts are dropped. */
  cancel: () => void;
  /** Stop the recognizer, await its tail, and resolve with the final
   * transcript ("" when nothing was heard or the session was cancelled). */
  confirm: () => Promise<string>;
} {
  const [phase, setPhase] = useState<VoicePhase>("idle");
  const [transcript, setTranscript] = useState("");
  const handleRef = useRef<STTHandle | null>(null);
  // Session counter: bumping it orphans in-flight callbacks (tail transcripts
  // after cancel, a startSTT that resolves after the user backed out) so they
  // can't mutate the next session's state.
  const sessionRef = useRef(0);
  // Finalized utterances + the live partial that replaces itself. A ref (not
  // state) because confirm() reads it after `await handle.stop()`, where a
  // state closure would be stale.
  const textRef = useRef({ committed: "", partial: "" });

  const start = useCallback(async () => {
    if (handleRef.current || phase !== "idle") return;
    const session = ++sessionRef.current;
    textRef.current = { committed: "", partial: "" };
    setTranscript("");
    setPhase("starting");
    try {
      const handle = await startSTT(
        (text, isFinal) => {
          if (sessionRef.current !== session) return;
          if (isFinal) {
            textRef.current.committed = joinTranscript(textRef.current.committed, text);
            textRef.current.partial = "";
          } else {
            textRef.current.partial = text;
          }
          setTranscript(joinTranscript(textRef.current.committed, textRef.current.partial));
        },
        (error) => {
          if (sessionRef.current !== session) return;
          toast.error(`Voice input error: ${error}`);
        },
      );
      if (sessionRef.current !== session) {
        // The user backed out while the mic was still spinning up.
        void handle.stop();
        return;
      }
      handleRef.current = handle;
      setPhase("listening");
    } catch (err) {
      if (sessionRef.current !== session) return;
      setPhase("idle");
      toast.error(`Voice input unavailable: ${toErrorMessage(err)}`);
    }
  }, [phase]);

  const cancel = useCallback(() => {
    // Orphan the session FIRST so tail transcripts are dropped.
    sessionRef.current++;
    setPhase("idle");
    const handle = handleRef.current;
    handleRef.current = null;
    if (handle) void handle.stop();
  }, []);

  const confirm = useCallback(async (): Promise<string> => {
    const session = sessionRef.current;
    const handle = handleRef.current;
    handleRef.current = null;
    if (handle) {
      // stop() forwards the recognizer's tail transcript through onTranscript
      // before resolving — await it so the trailing words are included.
      setPhase("stopping");
      await handle.stop();
    }
    if (sessionRef.current !== session) return ""; // cancelled while stopping
    sessionRef.current++;
    setPhase("idle");
    return joinTranscript(textRef.current.committed, textRef.current.partial).trim();
  }, []);

  // Unmount: orphan the session and drop the mic.
  useEffect(
    () => () => {
      sessionRef.current++;
      const handle = handleRef.current;
      handleRef.current = null;
      if (handle) void handle.stop();
    },
    [],
  );

  return { phase, transcript, start, cancel, confirm };
}
