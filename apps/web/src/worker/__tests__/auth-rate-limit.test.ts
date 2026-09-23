import { SELF } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CALLER_IP_HEADER } from "../rate-limit";
import { ORIGIN } from "./cloud-helpers";

// two hops: Better Auth trusts a forwarded chain only when it holds exactly one address
const FORWARDED_CHAIN = "198.51.100.7, 198.51.100.8";

// past the ceiling of any window the auth routes set
const ATTEMPT_CAP = 20;

const signInFrom = async (callerIp: string): Promise<Response> =>
  await SELF.fetch(`${ORIGIN}/api/auth/sign-in/email`, {
    body: JSON.stringify({ email: "nobody@example.test", password: "not-the-password" }),
    headers: {
      "content-type": "application/json",
      [CALLER_IP_HEADER]: callerIp,
      origin: ORIGIN,
      "x-forwarded-for": FORWARDED_CHAIN,
    },
    method: "POST",
  });

const spendSignInWindow = async (callerIp: string): Promise<void> => {
  for (let attempt = 0; attempt < ATTEMPT_CAP; attempt += 1) {
    const response = await signInFrom(callerIp);
    if (response.status === 429) {
      return;
    }
    expect(response.status).toBe(401);
  }
  throw new Error(`the sign-in window for ${callerIp} never shut`);
};

describe("Better Auth's limiter", () => {
  // the suite config keeps the limiter off so suites do not 429 on one another
  let wasDisabled = "";
  beforeEach(() => {
    wasDisabled = env.RATE_LIMIT_DISABLED;
    env.RATE_LIMIT_DISABLED = "false";
  });
  afterEach(() => {
    env.RATE_LIMIT_DISABLED = wasDisabled;
  });

  it("keys a sign-in on the edge's caller address, whatever x-forwarded-for carries", async () => {
    await spendSignInWindow("203.0.113.10");

    const other = await signInFrom("203.0.113.11");
    expect(other.status).toBe(401);
  });

  it("never spends a window on a session read", async () => {
    for (let read = 0; read < ATTEMPT_CAP; read += 1) {
      const response = await SELF.fetch(`${ORIGIN}/api/auth/get-session`, {
        headers: { [CALLER_IP_HEADER]: "203.0.113.20", origin: ORIGIN },
      });
      expect(response.status).toBe(200);
    }
  });
});
