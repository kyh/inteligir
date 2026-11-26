import { describe, expect, it } from "vitest";

import { LIBRARY_PAGE_PATH } from "@repo/contract/library-page";

import { authPageHref, authPageSearchSchema, internalNextPath, signedInLanding } from "./next-path";

describe("the sign-in return path", () => {
  it("carries a same-document path's query through unchanged", () => {
    const href = `/library?item=${encodeURIComponent("it_1")}&name=Work+laptop`;

    const returned = internalNextPath(href);
    expect(returned).toBe(href);

    const search = new URLSearchParams(new URL(returned ?? "", "http://x.test").search);
    expect(search.get("item")).toBe("it_1");
    expect(search.get("name")).toBe("Work laptop");
  });

  it("keeps a fragment, which is part of where someone was", () => {
    expect(internalNextPath("/library/settings?tab=all#account")).toBe(
      "/library/settings?tab=all#account",
    );
  });

  it("refuses everything that leaves this origin", () => {
    for (const value of [
      undefined,
      "",
      "https://evil.example/steal",
      "//evil.example/steal",
      "/\\evil.example/steal",
      "/.//evil.example/steal",
      "/..//evil.example/steal",
      "/%2e//evil.example/steal",
      "/./\\evil.example/steal",
      "http:/evil.example",
      // oxlint-disable-next-line eslint/no-script-url -- the hostile href this asserts is rejected
      "javascript:alert(1)",
      "library/settings",
    ]) {
      expect(internalNextPath(value), String(value)).toBeNull();
    }
  });

  it.each(["//evil.example/steal", "/\\evil.example/steal", "/.//evil.example/steal"])(
    "is no way back an account page links on, for %s",
    (stranger) => {
      expect(authPageSearchSchema.parse({ next: stranger }).next).toBeUndefined();
    },
  );
});

describe("where a sign-in or a sign-up lands", () => {
  it("follows a way back that stays on this origin", () => {
    const consent = "/connect/authorize?client_id=claude#top";
    expect(signedInLanding(consent)).toBe(consent);
  });

  it("lands in the library with no way back, or one that leaves this origin", () => {
    expect(signedInLanding(authPageSearchSchema.parse({}).next)).toBe(LIBRARY_PAGE_PATH);
    expect(signedInLanding("//evil.example/steal")).toBe(LIBRARY_PAGE_PATH);
  });
});

describe("a link between account pages", () => {
  it("carries the way back whole, or none", () => {
    const way = "/connect/authorize?client_id=c1&state=s1";
    const href = authPageHref("/app/sign-up", way);
    expect(new URL(href, "http://x.test").searchParams.get("next")).toBe(way);
    expect(authPageHref("/app/sign-up")).toBe("/app/sign-up");
  });
});
