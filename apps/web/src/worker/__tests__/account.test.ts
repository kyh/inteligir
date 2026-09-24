import { ACCOUNT_API_PATHS, accountResponseSchema } from "@repo/api/cloud/account/account-schema";
import { cloudErrorSchema } from "@repo/api/cloud/errors";
import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { deviceHeaders, emitted, ORIGIN, loginDevice, signUpUser } from "./cloud-helpers";

// `GET /v1/account` — the row that lets the product NAME the account an
// install syncs as (the account is the entitlement; Settings shows whose).

const ACCOUNT = `${ORIGIN}${ACCOUNT_API_PATHS.account}`;

describe("the account row", () => {
  it("refuses the wire without a credential", async () => {
    const response = await SELF.fetch(ACCOUNT);
    expect(response.status).toBe(401);
  });

  it("answers the credential's own account email", async () => {
    const { bearer } = await signUpUser("whoami@example.test");
    const { credential } = await loginDevice(bearer, "Laptop");
    const response = await SELF.fetch(ACCOUNT, { headers: deviceHeaders(credential) });
    expect(response.status).toBe(200);
    const account = emitted(accountResponseSchema, await response.text());
    expect(account.email).toBe("whoami@example.test");
    expect(account.id.length).toBeGreaterThan(0);
  });
});

describe("the /v1 fallthrough", () => {
  it("answers an unknown route with the error envelope every /v1 client parses", async () => {
    const response = await SELF.fetch(`${ORIGIN}/v1/no-such-route`);
    expect(response.status).toBe(404);
    expect(cloudErrorSchema.parse(await response.json()).error.code).toBe("not-found");
  });

  it("keeps plain text outside /v1, where no client reads the envelope", async () => {
    const response = await SELF.fetch(`${ORIGIN}/api/no-such-route`);
    expect(response.status).toBe(404);
    expect(await response.text()).toBe("not found");
  });
});
