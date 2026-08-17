import { describe, expect, it } from "vitest";
import {
  DEFAULT_SERVER_PORT,
  healthUrl,
  planServerStart,
  resolvePort,
  serverOrigin,
  windowUrl,
} from "../server-target";

describe("serverOrigin", () => {
  it("is loopback by address, never by name", () => {
    // `localhost` resolves to ::1 on some machines and 127.0.0.1 on others,
    // and the two are different origins to the pin.
    expect(serverOrigin(4664)).toBe("http://127.0.0.1:4664");
  });
});

describe("resolvePort", () => {
  it.each([undefined, "", "   "])("falls back to the app's own default for %o", (raw) => {
    expect(resolvePort(raw)).toBe(DEFAULT_SERVER_PORT);
  });

  it("takes a valid port from the environment", () => {
    expect(resolvePort(" 4700 ")).toBe(4700);
  });

  it.each(["0", "65536", "4700.5", "http://x", "abc"])(
    "refuses %o rather than defaulting",
    (raw) => {
      expect(resolvePort(raw)).toEqual({
        error: `INTELIGIR_PORT must be a valid TCP port (got "${raw}")`,
      });
    },
  );
});

describe("planServerStart", () => {
  it("adopts a server that already answered", () => {
    expect(planServerStart(true)).toBe("adopt");
  });

  it("spawns one when nothing answered", () => {
    expect(planServerStart(false)).toBe("spawn");
  });
});

describe("windowUrl", () => {
  it("is the origin's root", () => {
    expect(windowUrl("http://127.0.0.1:4664")).toBe("http://127.0.0.1:4664/");
  });

  it("refuses a non-http origin instead of loading one", () => {
    expect(() => windowUrl("file:///tmp")).toThrow(/http\(s\) URL/u);
  });
});

describe("healthUrl", () => {
  it("names the app's health route", () => {
    expect(healthUrl("http://127.0.0.1:4664")).toBe("http://127.0.0.1:4664/api/v1/health");
  });
});
