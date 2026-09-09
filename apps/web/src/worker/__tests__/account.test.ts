// oxlint-disable typescript/no-deprecated -- SELF is the only fetcher that runs in the tests'
// own isolate; the cloudflare:workers loopback binding stands a second worker up, and its
// first fetch costs seconds enough to time a test out.
import { ACCOUNT_API_PATHS, accountResponseSchema } from "@repo/api/cloud/account/account-schema";
import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { deviceHeaders, ORIGIN, loginDevice, signUpUser } from "./cloud-helpers";

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
    const account = accountResponseSchema.parse(await response.json());
    expect(account.email).toBe("whoami@example.test");
    expect(account.id.length).toBeGreaterThan(0);
  });
});
