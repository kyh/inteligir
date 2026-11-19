import { dbSuite } from "@repo/db/test-database";
import { describe, expect, it, vi } from "vitest";

import { authPost, ORIGIN } from "../test-support/auth-requests.test-utils";

const DEPLOYMENT_HOST = vi.hoisted(() => {
  const host = "inteligir-a1b2c3d4e-team.vercel.app";
  process.env.VERCEL_URL = host;

  return host;
});

const signInFrom = async (origin: string) =>
  (await authPost(
    "/sign-in/email",
    { origin },
    { email: "nobody@example.test", password: "not-the-password" },
  )) satisfies Response;

dbSuite("a sign-in's origin", () => {
  describe("Better Auth", () => {
    it("takes a sign-in from the deployment's own address, as from the app's", async () => {
      for (const origin of [ORIGIN, `https://${DEPLOYMENT_HOST}`]) {
        const response = await signInFrom(origin);
        expect(response.status).toBe(401);
      }
    });

    it("refuses a sign-in from another deployment's address", async () => {
      const response = await signInFrom("https://inteligir-other-team.vercel.app");
      expect(response.status).toBe(403);
      await expect(response.json()).resolves.toMatchObject({ code: "INVALID_ORIGIN" });
    });
  });
});
