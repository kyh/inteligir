import { createORPCErrorFromJson } from "@orpc/client";
import { describe, expect, it } from "vitest";

import { refusalText } from "./needs-connection";

const FALLBACK = "That couldn't be done. Try again.";

describe("what a failed cell call says", () => {
  it("says a refusal the contract declares in its own sentence", () => {
    const refused = createORPCErrorFromJson({
      code: "QUOTA",
      data: undefined,
      defined: true,
      message: "Your library is full.",
    });
    expect(refusalText(refused, FALLBACK)).toBe("Your library is full.");
  });

  it("says the screen's fallback for no answer, a fault and anything else, never its words", () => {
    expect(refusalText(new TypeError("Failed to fetch"), FALLBACK)).toBe(FALLBACK);
    const fault = createORPCErrorFromJson({
      code: "INTERNAL_SERVER_ERROR",
      data: undefined,
      defined: false,
      message: "Internal server error",
    });
    expect(refusalText(fault, FALLBACK)).toBe(FALLBACK);
    expect(refusalText(undefined, FALLBACK)).toBe(FALLBACK);
  });
});
