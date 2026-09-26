import { PRODUCTION_CLOUD_ORIGIN } from "@repo/api/cloud/origin";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getCloudUrl } from "../cloud-url";

const VARIABLE = "EXPO_PUBLIC_CLOUD_URL";

describe("the phone's cloud origin", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("is the production origin when nothing names another", () => {
    // oxlint-disable-next-line unicorn/no-useless-undefined -- stubEnv unsets a variable only when handed undefined
    vi.stubEnv(VARIABLE, undefined);
    expect(getCloudUrl()).toBe(PRODUCTION_CLOUD_ORIGIN);
  });

  it("is the production origin when the variable is empty", () => {
    vi.stubEnv(VARIABLE, "  ");
    expect(getCloudUrl()).toBe(PRODUCTION_CLOUD_ORIGIN);
  });

  it("is the named origin, without the path it was given", () => {
    vi.stubEnv(VARIABLE, " http://localhost:8787/app/devices ");
    expect(getCloudUrl()).toBe("http://localhost:8787");
  });

  it.each(["localhost:8787", "not a url", "ftp://example.com", "https://"])(
    "refuses %j rather than guess",
    (value) => {
      vi.stubEnv(VARIABLE, value);
      expect(() => getCloudUrl()).toThrow(VARIABLE);
    },
  );
});
