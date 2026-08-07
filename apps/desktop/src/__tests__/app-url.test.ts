import { describe, expect, it } from "vitest";

import { parseAppOrigin, resolveAppOrigin, workspaceUrl } from "@/main/app-url";

describe("parseAppOrigin", () => {
  it("reduces a URL to its origin", () => {
    expect(parseAppOrigin("https://inteligir.com/app?x=1#y")).toBe("https://inteligir.com");
    expect(parseAppOrigin("http://localhost:5173/")).toBe("http://localhost:5173");
  });

  it("tolerates surrounding whitespace an env var picks up", () => {
    expect(parseAppOrigin("  https://inteligir.com  ")).toBe("https://inteligir.com");
  });

  it("refuses anything that is not an http(s) URL", () => {
    // A shell pinned to an opaque origin has a meaningless same-origin check,
    // so these fall through to the next source rather than being loaded.
    expect(parseAppOrigin("file:///Applications/Inteligir.app")).toBeNull();
    expect(parseAppOrigin("inteligir://today")).toBeNull();
    expect(parseAppOrigin("javascript:alert(1)")).toBeNull();
    expect(parseAppOrigin("inteligir.com")).toBeNull();
    expect(parseAppOrigin("")).toBeNull();
    expect(parseAppOrigin("   ")).toBeNull();
    expect(parseAppOrigin(undefined)).toBeNull();
  });
});

describe("resolveAppOrigin", () => {
  it("prefers the environment over the baked-in origin", () => {
    expect(
      resolveAppOrigin({ env: "http://localhost:5173", bundled: "https://inteligir.com" }),
    ).toBe("http://localhost:5173");
  });

  it("falls through to the baked-in origin", () => {
    expect(resolveAppOrigin({ env: undefined, bundled: "https://staging.example.com" })).toBe(
      "https://staging.example.com",
    );
  });

  it("falls through an UNUSABLE env value rather than failing to a blank origin", () => {
    expect(resolveAppOrigin({ env: "not a url", bundled: "https://inteligir.com" })).toBe(
      "https://inteligir.com",
    );
  });

  it("ships a default when nothing is configured", () => {
    expect(resolveAppOrigin({ env: undefined, bundled: undefined })).toBe("https://inteligir.com");
    expect(resolveAppOrigin({ env: "", bundled: "" })).toBe("https://inteligir.com");
  });
});

describe("workspaceUrl", () => {
  it("opens the product route on the resolved origin", () => {
    expect(workspaceUrl("https://inteligir.com")).toBe("https://inteligir.com/app");
  });
});
