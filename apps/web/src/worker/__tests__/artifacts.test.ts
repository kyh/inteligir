import { cloudErrorSchema } from "@repo/api/cloud/errors";
import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { deviceHeaders, ORIGIN, pairDevice, signUpUser } from "./cloud-helpers";

// The Artifacts mint seam. Cloudflare Artifacts is beta-gated for this account
// (API error 10004 until access lands), so the flag-ON path — repo create +
// token mint against the documented REST surface — CANNOT be exercised here;
// these tests pin the flag-off contract and the auth gate, which is everything
// a client can observe today. When access lands: set ARTIFACTS_ENABLED plus
// the two Cloudflare credentials and drive the mint once by hand before
// trusting it (src/worker/artifacts.ts documents the surface it calls).

describe("artifacts mint (flag off)", () => {
  it("answers the typed not-enabled envelope to a paired device", async () => {
    const { bearer } = await signUpUser("artifacts-off@example.test");
    const { credential } = await pairDevice(bearer, "Laptop");

    const response = await SELF.fetch(`${ORIGIN}/v1/artifacts/mint`, {
      method: "POST",
      headers: deviceHeaders(credential),
    });
    expect(response.status).toBe(503);
    const envelope = cloudErrorSchema.parse(await response.json());
    expect(envelope.error.code).toBe("artifacts-not-enabled");
  });

  it("still demands the device credential before answering anything", async () => {
    const response = await SELF.fetch(`${ORIGIN}/v1/artifacts/mint`, { method: "POST" });
    expect(response.status).toBe(401);
    expect(cloudErrorSchema.parse(await response.json()).error.code).toBe("unauthorized");
  });
});
