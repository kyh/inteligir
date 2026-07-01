import { describe, it, expect } from "vitest";
import { reduce } from "../app/app-reducer";

describe("reduce", () => {
  // ---- LOGIN ----------------------------------------------------------------

  it("LOGIN from logged_out → logging_in + LOGIN effect", () => {
    const result = reduce({ phase: "logged_out" }, { type: "LOGIN" });
    expect(result).toEqual({ next: { phase: "logging_in" }, effect: "LOGIN" });
  });

  it("LOGIN from non-logged_out → null", () => {
    expect(reduce({ phase: "logging_in" }, { type: "LOGIN" })).toBeNull();
    expect(reduce({ phase: "ready", agent: "idle" }, { type: "LOGIN" })).toBeNull();
  });

  // ---- LOGIN_OK / LOGIN_FAIL ------------------------------------------------

  it("LOGIN_OK from logging_in → logged_in", () => {
    const result = reduce({ phase: "logging_in" }, { type: "LOGIN_OK" });
    expect(result).toEqual({ next: { phase: "logged_in" }, effect: null });
  });

  it("LOGIN_FAIL from logging_in → error", () => {
    const result = reduce({ phase: "logging_in" }, { type: "LOGIN_FAIL", message: "bad creds" });
    expect(result).toEqual({
      next: { phase: "error", prev: "logging_in", message: "bad creds" },
      effect: null,
    });
  });

  it("LOGIN_OK from wrong phase → null", () => {
    expect(reduce({ phase: "logged_out" }, { type: "LOGIN_OK" })).toBeNull();
  });

  // ---- SETUP ----------------------------------------------------------------

  it("SETUP from logged_in → setting_up + SETUP effect", () => {
    const result = reduce({ phase: "logged_in" }, { type: "SETUP" });
    expect(result).toEqual({ next: { phase: "setting_up" }, effect: "SETUP" });
  });

  it("SETUP from wrong phase → null", () => {
    expect(reduce({ phase: "logged_out" }, { type: "SETUP" })).toBeNull();
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

  // ---- LOGOUT ---------------------------------------------------------------

  it("LOGOUT from ready → logging_out + LOGOUT effect", () => {
    const result = reduce({ phase: "ready", agent: "idle" }, { type: "LOGOUT" });
    expect(result).toEqual({ next: { phase: "logging_out" }, effect: "LOGOUT" });
  });

  it("LOGOUT from error → logging_out + LOGOUT effect", () => {
    const result = reduce({ phase: "error", prev: "ready", message: "oops" }, { type: "LOGOUT" });
    expect(result).toEqual({ next: { phase: "logging_out" }, effect: "LOGOUT" });
  });

  it("LOGOUT from wrong phase → null", () => {
    expect(reduce({ phase: "logged_in" }, { type: "LOGOUT" })).toBeNull();
  });

  // ---- LOGOUT_OK / LOGOUT_FAIL ------------------------------------------------

  it("LOGOUT_OK from logging_out → logged_out", () => {
    const result = reduce({ phase: "logging_out" }, { type: "LOGOUT_OK" });
    expect(result).toEqual({ next: { phase: "logged_out" }, effect: null });
  });

  it("LOGOUT_FAIL from logging_out → error(logging_out), not a wedged logging_out", () => {
    const result = reduce({ phase: "logging_out" }, { type: "LOGOUT_FAIL", message: "rm failed" });
    expect(result).toEqual({
      next: { phase: "error", prev: "logging_out", message: "rm failed" },
      effect: null,
    });
  });

  it("LOGOUT_FAIL from wrong phase → null", () => {
    expect(
      reduce({ phase: "ready", agent: "idle" }, { type: "LOGOUT_FAIL", message: "x" }),
    ).toBeNull();
  });

  // ---- NEW_SESSION_OK / NEW_SESSION_FAIL --------------------------------------

  it("NEW_SESSION from ready/idle → NEW_SESSION effect, state unchanged", () => {
    const result = reduce({ phase: "ready", agent: "idle" }, { type: "NEW_SESSION" });
    expect(result).toEqual({ next: { phase: "ready", agent: "idle" }, effect: "NEW_SESSION" });
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
    expect(reduce({ phase: "logged_in" }, { type: "NEW_SESSION_FAIL", message: "x" })).toBeNull();
  });

  // ---- RETRY ----------------------------------------------------------------

  it("RETRY from error(logging_in) → logging_in + LOGIN", () => {
    const result = reduce(
      { phase: "error", prev: "logging_in", message: "fail" },
      { type: "RETRY" },
    );
    expect(result).toEqual({ next: { phase: "logging_in" }, effect: "LOGIN" });
  });

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

  it("RETRY from error(logging_out) → logging_out + LOGOUT", () => {
    const result = reduce(
      { phase: "error", prev: "logging_out", message: "fail" },
      { type: "RETRY" },
    );
    expect(result).toEqual({ next: { phase: "logging_out" }, effect: "LOGOUT" });
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
    expect(reduce({ phase: "logged_in" }, { type: "AGENT_START" })).toBeNull();
  });

  // ---- Unknown events -------------------------------------------------------

  it("unknown event type → null", () => {
    expect(
      Reflect.apply(reduce, undefined, [{ phase: "logged_out" }, { type: "UNKNOWN" }]),
    ).toBeNull();
  });
});
