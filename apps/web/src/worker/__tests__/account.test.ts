import { ACCOUNT_API_PATHS, accountResponseSchema } from "@repo/api/cloud/account/account-schema";
import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { deviceHeaders, ORIGIN, pairDevice, signUpUser } from "./cloud-helpers";

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
    const { credential } = await pairDevice(bearer, "Laptop");
    const response = await SELF.fetch(ACCOUNT, { headers: deviceHeaders(credential) });
    expect(response.status).toBe(200);
    expect(accountResponseSchema.parse(await response.json())).toEqual({
      email: "whoami@example.test",
    });
  });
});
