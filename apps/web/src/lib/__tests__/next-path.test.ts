// Where sign-in is allowed to send someone afterwards.
//
// Two claims, and they pull in opposite directions: a pairing request has to
// survive the round trip WHOLE — `state` above all, since losing it means the
// callback the user then approves is inert — while the destination itself must
// never become a way to bounce a signed-in visitor off this origin.

import { PAIR_APPROVE_PATH } from "@repo/api/cloud/pairing/pairing-schema";
import { describe, expect, it } from "vitest";
import { internalNextPath } from "../next-path";

describe("the sign-in return path", () => {
  it("carries a pairing request's parameters through unchanged", () => {
    const pairHref = `${PAIR_APPROVE_PATH}?redirect=${encodeURIComponent(
      "http://127.0.0.1:4664/pair/callback",
    )}&state=${"a".repeat(32)}&name=Work+laptop`;

    const returned = internalNextPath(pairHref);
    expect(returned).toBe(pairHref);

    // The one that must not be lost: without it the approval binds to nothing.
    const search = new URLSearchParams(new URL(returned ?? "", "http://x.test").search);
    expect(search.get("state")).toBe("a".repeat(32));
    expect(search.get("redirect")).toBe("http://127.0.0.1:4664/pair/callback");
    expect(search.get("name")).toBe("Work laptop");
  });

  it("carries the mobile deep-link redirect through the same round trip", () => {
    // The encoded custom scheme is the shape most likely to be mangled by a
    // path guard; `toBe` pins the whole href, encoding included.
    const pairHref = `${PAIR_APPROVE_PATH}?redirect=${encodeURIComponent(
      "inteligir://pair/callback",
    )}&state=${"b".repeat(32)}&name=Phone`;

    expect(internalNextPath(pairHref)).toBe(pairHref);
  });

  it("keeps a fragment, which is part of where someone was", () => {
    expect(internalNextPath("/app/devices?tab=all#row-3")).toBe("/app/devices?tab=all#row-3");
  });

  it("refuses everything that leaves this origin", () => {
    for (const value of [
      undefined,
      "",
      "https://evil.example/steal",
      "//evil.example/steal",
      "/\\evil.example/steal",
      "http:/evil.example",
      "javascript:alert(1)",
      "app/devices",
    ]) {
      expect(internalNextPath(value), String(value)).toBeNull();
    }
  });
});
