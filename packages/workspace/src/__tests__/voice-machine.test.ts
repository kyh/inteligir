import { describe, expect, it, vi } from "vitest";

import { VoiceMachine } from "@repo/workspace/voice/voice-machine";

describe("VoiceMachine", () => {
  it("starts in idle", () => {
    const m = new VoiceMachine();
    expect(m.state.kind).toBe("idle");
    expect(m.generation).toBe(0);
  });

  it("user_toggle_on transitions idle → connecting", () => {
    const m = new VoiceMachine();
    m.dispatch({ type: "user_toggle_on" });
    expect(m.state.kind).toBe("connecting");
  });

  it("connect_failed transitions to error and bumps generation", () => {
    const m = new VoiceMachine();
    const initialGen = m.generation;
    m.dispatch({ type: "user_toggle_on" });
    m.dispatch({ type: "connect_failed", message: "boom" });
    expect(m.state.kind).toBe("error");
    expect(m.generation).toBeGreaterThan(initialGen);
  });

  it("connect_ok transitions to listening", () => {
    const m = new VoiceMachine();
    m.dispatch({ type: "user_toggle_on" });
    m.dispatch({ type: "connect_ok" });
    expect(m.state.kind).toBe("listening");
  });

  it("transcript_partial updates currentTranscript", () => {
    const m = new VoiceMachine();
    m.dispatch({ type: "user_toggle_on" });
    m.dispatch({ type: "connect_ok" });
    m.dispatch({ type: "transcript_partial", text: "hello" });
    expect(m.state.kind).toBe("listening");
    if (m.state.kind === "listening") expect(m.state.currentTranscript).toBe("hello");
  });

  it("transcript_final clears partial", () => {
    const m = new VoiceMachine();
    m.dispatch({ type: "user_toggle_on" });
    m.dispatch({ type: "connect_ok" });
    m.dispatch({ type: "transcript_partial", text: "hello" });
    m.dispatch({ type: "transcript_final", text: "hello world" });
    if (m.state.kind === "listening") expect(m.state.currentTranscript).toBe("");
  });

  it("reset returns to idle and bumps generation", () => {
    const m = new VoiceMachine();
    const initialGen = m.generation;
    m.dispatch({ type: "user_toggle_on" });
    m.dispatch({ type: "reset" });
    expect(m.state.kind).toBe("idle");
    expect(m.generation).toBeGreaterThan(initialGen);
  });

  it("pipeline_error from listening transitions to error and bumps generation", () => {
    const m = new VoiceMachine();
    m.dispatch({ type: "user_toggle_on" });
    m.dispatch({ type: "connect_ok" });
    const genBefore = m.generation;
    m.dispatch({ type: "pipeline_error", message: "audio device gone" });
    expect(m.state.kind).toBe("error");
    expect(m.generation).toBeGreaterThan(genBefore);
  });

  it("subscribers are notified on every transition", () => {
    const m = new VoiceMachine();
    const states: string[] = [];
    m.subscribe((s) => states.push(s.kind));
    m.dispatch({ type: "user_toggle_on" });
    m.dispatch({ type: "connect_ok" });
    expect(states).toEqual(["connecting", "listening"]);
  });

  it("no-op transitions don't notify subscribers", () => {
    const m = new VoiceMachine();
    const listener = vi.fn();
    m.subscribe(listener);
    // connect_ok in idle should be ignored.
    m.dispatch({ type: "connect_ok" });
    expect(listener).not.toHaveBeenCalled();
  });
});
