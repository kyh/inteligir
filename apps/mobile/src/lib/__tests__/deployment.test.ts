import { describe, expect, it } from "vitest";

import { parseDeploymentOrigin } from "../deployment";

describe("parseDeploymentOrigin", () => {
  it("reduces a URL to its origin", () => {
    expect(parseDeploymentOrigin("https://inteligir.com/app?x=1")).toBe("https://inteligir.com");
    expect(parseDeploymentOrigin("http://192.168.1.20:5173/")).toBe("http://192.168.1.20:5173");
  });

  it("tolerates the whitespace an env var picks up", () => {
    expect(parseDeploymentOrigin("  https://inteligir.com  ")).toBe("https://inteligir.com");
  });

  it("refuses anything that is not an http(s) URL", () => {
    // Falling through to the shipped default beats sending a bearer token to
    // a URL nobody can debug.
    expect(parseDeploymentOrigin("inteligir.com")).toBeNull();
    expect(parseDeploymentOrigin("expo://localhost")).toBeNull();
    expect(parseDeploymentOrigin("")).toBeNull();
    expect(parseDeploymentOrigin("   ")).toBeNull();
    expect(parseDeploymentOrigin(undefined)).toBeNull();
  });
});
