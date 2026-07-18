import { describe, it, expect } from "vitest";
import { reduce } from "../app/app-reducer";
import type { AppState, MachineEvent } from "@repo/features/app-state";

describe("reduce", () => {
  // ---- SETUP ----------------------------------------------------------------

  it("SETUP from starting → setting_up + SETUP effect", () => {
    const result = reduce({ phase: "starting" }, { type: "SETUP" });
    expect(result).toEqual({ next: { phase: "setting_up" }, effect: "SETUP" });
  });

  it("SETUP from wrong phase → null (no double-run while setting_up)", () => {
    expect(reduce({ phase: "setting_up" }, { type: "SETUP" })).toBeNull();
    expect(reduce({ phase: "ready", agent: "idle" }, { type: "SETUP" })).toBeNull();
  });

  // ---- SETUP_OK / SETUP_FAIL ------------------------------------------------

  it("SETUP_OK from setting_up → ready/idle", () => {
    const result = reduce({ phase: "setting_up" }, { type: "SETUP_OK" });
    expect(result).toEqual({ next: { phase: "ready", agent: "idle" }, effect: null });
  });

  it("SETUP_FAIL from setting_up → error", () => {
    const result = reduce({ phase: "setting_up" }, { type: "SETUP_FAIL", message: "network" });
    expect(result).toEqual({
      next: { phase: "error", prev: "setting_up", message: "network" },
      effect: null,
    });
  });

  it("SETUP_OK from wrong phase → null", () => {
    expect(reduce({ phase: "starting" }, { type: "SETUP_OK" })).toBeNull();
  });

  // ---- RESET_APP_DATA -------------------------------------------------------

  it("RESET_APP_DATA from ready → setting_up + RESET effect", () => {
    const result = reduce({ phase: "ready", agent: "idle" }, { type: "RESET_APP_DATA" });
    expect(result).toEqual({ next: { phase: "setting_up" }, effect: "RESET" });
  });

  it("RESET_APP_DATA from error → setting_up + RESET effect", () => {
    const result = reduce(
      { phase: "error", prev: "ready", message: "oops" },
      { type: "RESET_APP_DATA" },
    );
    expect(result).toEqual({ next: { phase: "setting_up" }, effect: "RESET" });
  });

  it("RESET_APP_DATA from pre-ready phases → null", () => {
    expect(reduce({ phase: "starting" }, { type: "RESET_APP_DATA" })).toBeNull();
    expect(reduce({ phase: "setting_up" }, { type: "RESET_APP_DATA" })).toBeNull();
  });

  // ---- NEW_SESSION ----------------------------------------------------------

  it("NEW_SESSION from ready/idle → NEW_SESSION effect, state unchanged", () => {
    const result = reduce({ phase: "ready", agent: "idle" }, { type: "NEW_SESSION" });
    expect(result).toEqual({ next: { phase: "ready", agent: "idle" }, effect: "NEW_SESSION" });
  });

  it("NEW_SESSION while busy → null", () => {
    expect(reduce({ phase: "ready", agent: "busy" }, { type: "NEW_SESSION" })).toBeNull();
  });

  it("NEW_SESSION_FAIL from ready → error(ready) so RETRY can restart the agent", () => {
    const result = reduce(
      { phase: "ready", agent: "idle" },
      { type: "NEW_SESSION_FAIL", message: "start broke" },
    );
    expect(result).toEqual({
      next: { phase: "error", prev: "ready", message: "start broke" },
      effect: null,
    });
  });

  it("NEW_SESSION_FAIL from wrong phase → null", () => {
    expect(reduce({ phase: "starting" }, { type: "NEW_SESSION_FAIL", message: "x" })).toBeNull();
  });

  // ---- RETRY ----------------------------------------------------------------

  it("RETRY from error(setting_up) → setting_up + SETUP", () => {
    const result = reduce(
      { phase: "error", prev: "setting_up", message: "fail" },
      { type: "RETRY" },
    );
    expect(result).toEqual({ next: { phase: "setting_up" }, effect: "SETUP" });
  });

  it("RETRY from error(ready) → setting_up + SETUP", () => {
    const result = reduce({ phase: "error", prev: "ready", message: "fail" }, { type: "RETRY" });
    expect(result).toEqual({ next: { phase: "setting_up" }, effect: "SETUP" });
  });

  it("RETRY from non-error → null", () => {
    expect(reduce({ phase: "ready", agent: "idle" }, { type: "RETRY" })).toBeNull();
  });

  // ---- AGENT_START / AGENT_END ----------------------------------------------

  it("AGENT_START from ready → ready/busy", () => {
    const result = reduce({ phase: "ready", agent: "idle" }, { type: "AGENT_START" });
    expect(result).toEqual({ next: { phase: "ready", agent: "busy" }, effect: null });
  });

  it("AGENT_END from ready → ready/idle", () => {
    const result = reduce({ phase: "ready", agent: "busy" }, { type: "AGENT_END" });
    expect(result).toEqual({ next: { phase: "ready", agent: "idle" }, effect: null });
  });

  it("AGENT_START from non-ready → null", () => {
    expect(reduce({ phase: "starting" }, { type: "AGENT_START" })).toBeNull();
  });

  // ---- Guest invariant ------------------------------------------------------

  it("no event ever produces a login-flavored phase (guest is the only identity)", () => {
    const states: AppState[] = [
      { phase: "starting" },
      { phase: "setting_up" },
      { phase: "ready", agent: "idle" },
      { phase: "ready", agent: "busy" },
      { phase: "error", prev: "setting_up", message: "m" },
      { phase: "error", prev: "ready", message: "m" },
    ];
    const events: MachineEvent[] = [
      { type: "SETUP" },
      { type: "RESET_APP_DATA" },
      { type: "RETRY" },
      { type: "NEW_SESSION" },
      { type: "SETUP_OK" },
      { type: "SETUP_FAIL", message: "m" },
      { type: "NEW_SESSION_OK" },
      { type: "NEW_SESSION_FAIL", message: "m" },
      { type: "AGENT_START" },
      { type: "AGENT_END" },
    ];
    const reachable = new Set<string>();
    for (const state of states) {
      for (const event of events) {
        const result = reduce(state, event);
        if (result) reachable.add(result.next.phase);
      }
    }
    expect([...reachable].toSorted()).toEqual(["error", "ready", "setting_up"]);
  });

  // ---- Unknown events -------------------------------------------------------

  it("unknown event type → null", () => {
    expect(
      Reflect.apply(reduce, undefined, [{ phase: "starting" }, { type: "UNKNOWN" }]),
    ).toBeNull();
  });
});
