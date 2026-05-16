// ---------------------------------------------------------------------------
// Voice state machine — single source of truth for renderer-side voice state.
//
// Replaces the per-callsite "capture pipeline reference at entry, compare
// after every await" pattern with a centralized generation counter. Every
// transition that cancels in-flight work bumps the generation; async actions
// capture the generation at entry and check it at completion. The machine
// itself decides whether a transition cancels in-flight work, so callers
// can't forget to bump.
// ---------------------------------------------------------------------------

import type { VoiceModelStateEvent } from "@/shared/ipc";

export type VoiceState =
  | { kind: "idle" }
  | { kind: "downloading_model"; progress: VoiceModelStateEvent | null }
  | { kind: "connecting" }
  | { kind: "listening"; currentTranscript: string }
  | { kind: "error"; message: string };

export type VoiceEvent =
  | { type: "user_toggle_on" }
  | { type: "model_status_received"; status: "ready" | "missing" }
  | { type: "model_progress"; progress: VoiceModelStateEvent }
  | { type: "model_download_ok" }
  | { type: "model_download_failed"; message: string }
  | { type: "connect_ok" }
  | { type: "connect_failed"; message: string }
  | { type: "transcript_partial"; text: string }
  | { type: "transcript_final"; text: string }
  | { type: "pipeline_disconnected" }
  | { type: "pipeline_error"; message: string }
  | { type: "reset" };

const IDLE: VoiceState = { kind: "idle" };

type Transition = { state: VoiceState; cancelInFlight?: boolean };

function reduce(state: VoiceState, event: VoiceEvent): Transition {
  // Reset is unconditional — always returns to idle and cancels everything.
  if (event.type === "reset") return { state: IDLE, cancelInFlight: true };
  // pipeline_error / pipeline_disconnected are valid in any active state.
  if (event.type === "pipeline_error") {
    return { state: { kind: "error", message: event.message }, cancelInFlight: true };
  }
  if (event.type === "pipeline_disconnected") {
    return state.kind === "idle" ? { state } : { state: IDLE, cancelInFlight: true };
  }

  switch (state.kind) {
    case "idle":
    case "error":
      if (event.type === "user_toggle_on") {
        return { state: { kind: "downloading_model", progress: null } };
      }
      return { state };

    case "downloading_model":
      switch (event.type) {
        case "model_status_received":
          return event.status === "ready" ? { state: { kind: "connecting" } } : { state };
        case "model_progress":
          return { state: { kind: "downloading_model", progress: event.progress } };
        case "model_download_ok":
          return { state: { kind: "connecting" } };
        case "model_download_failed":
          return {
            state: { kind: "error", message: event.message },
            cancelInFlight: true,
          };
        default:
          return { state };
      }

    case "connecting":
      switch (event.type) {
        case "connect_ok":
          return { state: { kind: "listening", currentTranscript: "" } };
        case "connect_failed":
          return {
            state: { kind: "error", message: event.message },
            cancelInFlight: true,
          };
        default:
          return { state };
      }

    case "listening":
      switch (event.type) {
        case "transcript_partial":
          return { state: { kind: "listening", currentTranscript: event.text } };
        case "transcript_final":
          // Final emission also clears the partial — the agent handles routing.
          return { state: { kind: "listening", currentTranscript: "" } };
        default:
          return { state };
      }
  }
}

export class VoiceMachine {
  private _state: VoiceState = IDLE;
  private _generation = 0;
  private readonly listeners = new Set<(state: VoiceState) => void>();

  get state(): VoiceState {
    return this._state;
  }

  /** Token captured by async ops; if it changes, the op's result is stale. */
  get generation(): number {
    return this._generation;
  }

  subscribe(listener: (state: VoiceState) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  dispatch(event: VoiceEvent): void {
    const { state: next, cancelInFlight } = reduce(this._state, event);
    if (next === this._state) return;
    if (cancelInFlight) this._generation += 1;
    this._state = next;
    for (const listener of this.listeners) listener(this._state);
  }
}
