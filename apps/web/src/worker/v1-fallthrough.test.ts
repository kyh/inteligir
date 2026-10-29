import { cloudErrorSchema } from "@repo/contract/cloud/errors";
import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { buildHeaders, ORIGIN } from "./test-support/cloud-helpers";

describe("the /v1 fallthrough", () => {
  it("answers an unknown route with the error envelope every /v1 client parses", async () => {
    const response = await exports.default.fetch(`${ORIGIN}/v1/no-such-route`, {
      headers: buildHeaders(),
    });
    expect(response.status).toBe(404);
    expect(cloudErrorSchema.parse(await response.json()).error.code).toBe("not-found");
  });

  it("keeps plain text outside /v1, where no client reads the envelope", async () => {
    const response = await exports.default.fetch(`${ORIGIN}/api/no-such-route`);
    expect(response.status).toBe(404);
    expect(await response.text()).toBe("not found");
  });
});
