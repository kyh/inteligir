import { createORPCErrorFromJson } from "@orpc/client";
import { describe, expect, it } from "vitest";

import { retryUnlessRefused, sessionEnded } from "./v1";

const defined = (code: string) =>
  createORPCErrorFromJson({ code, data: undefined, defined: true, message: code });

describe("a cell call that did not land", () => {
  it("is asked again only when it met no answer, never for a refusal it declared", () => {
    expect(retryUnlessRefused(0, new TypeError("Failed to fetch"))).toBe(true);
    expect(retryUnlessRefused(3, new TypeError("Failed to fetch"))).toBe(false);
    expect(retryUnlessRefused(0, defined("NOT_FOUND"))).toBe(false);
  });

  it("ends the page's session on a signed-out or deleted account, and on nothing else", () => {
    expect(sessionEnded(defined("UNAUTHORIZED"))).toBe(true);
    expect(sessionEnded(defined("GONE"))).toBe(true);
    expect(sessionEnded(defined("INVALID_CREDENTIALS"))).toBe(false);
    expect(sessionEnded(new Error("offline"))).toBe(false);
  });
});
