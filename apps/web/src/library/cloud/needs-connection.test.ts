import { createORPCErrorFromJson } from "@orpc/client";
import { describe, expect, it } from "vitest";

import { cellStanding } from "./needs-connection";

const refused = (code: string) =>
  createORPCErrorFromJson({ code, data: undefined, defined: true, message: code });

const NOT_FOUND = refused("NOT_FOUND");
const OFFLINE = new TypeError("Failed to fetch");

describe("where a read of the cell stands", () => {
  it("is its answer once it has one, however the read stands since", () => {
    expect(cellStanding({ data: 3, error: OFFLINE, fetchStatus: "paused" })).toStrictEqual({
      data: 3,
      kind: "answered",
    });
  });

  it("needs a connection while it waits for one, whatever an earlier try met", () => {
    expect(cellStanding({ data: undefined, error: null, fetchStatus: "paused" })).toStrictEqual({
      kind: "needs-connection",
    });
    expect(
      cellStanding({ data: undefined, error: NOT_FOUND, fetchStatus: "paused" }),
    ).toStrictEqual({ kind: "needs-connection" });
  });

  it("tells a thing the cell does not hold from a call that failed", () => {
    expect(cellStanding({ data: undefined, error: NOT_FOUND, fetchStatus: "idle" })).toStrictEqual({
      error: NOT_FOUND,
      kind: "missing",
    });
    expect(cellStanding({ data: undefined, error: OFFLINE, fetchStatus: "idle" })).toStrictEqual({
      error: OFFLINE,
      kind: "unreachable",
    });
    const refusal = refused("FORBIDDEN");
    expect(cellStanding({ data: undefined, error: refusal, fetchStatus: "idle" })).toStrictEqual({
      error: refusal,
      kind: "unreachable",
    });
  });

  it("is asked while nothing has answered", () => {
    expect(cellStanding({ data: undefined, error: null, fetchStatus: "fetching" })).toStrictEqual({
      kind: "loading",
    });
  });
});
