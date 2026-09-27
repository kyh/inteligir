import { describe, expect, it } from "vitest";
import { createCloudClient } from "../cloud-client";
import type { CloudClient, CloudFetch } from "../cloud-client";

// what the call's deadline does to a body still arriving: the stream errors with the signal's reason
const abortedMidBody = (status: number): Response =>
  new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"commit":'));
        controller.error(new DOMException("The operation was aborted.", "AbortError"));
      },
    }),
    { headers: { "content-type": "application/json" }, status },
  );

const clientAnswering = (answer: () => Response): CloudClient => {
  const fetch: CloudFetch = async () => await Promise.resolve(answer());
  return createCloudClient({ baseUrl: "https://cloud.test", credential: "igd_test", fetch });
};

describe("a body cut off mid-transfer", () => {
  it("reads as unreachable, never as a body this build cannot read", async () => {
    const client = clientAnswering(() => abortedMidBody(200));

    const listed = await client.listDevices();
    expect(listed.ok || listed.failure.kind).toBe("unreachable");
    const files = await client.vaultFiles({ paths: ["a.md"], ref: "b".repeat(40) });
    expect(files.ok || files.failure.kind).toBe("unreachable");
  });

  it("reads as unreachable on a vault commit, whatever the status", async () => {
    for (const status of [200, 409]) {
      const client = clientAnswering(() => abortedMidBody(status));
      const committed = await client.vaultCommit({
        changes: [
          { base: null, content: { encoding: "utf-8", text: "x" }, op: "put", path: "a.md" },
        ],
      });
      expect(committed.ok || committed.failure.kind, `HTTP ${status}`).toBe("unreachable");
    }
  });

  it("reads as unreachable on a refusal whose envelope never arrived", async () => {
    const client = clientAnswering(() => abortedMidBody(403));

    const refused = await client.account();
    expect(refused.ok || refused.failure.kind).toBe("unreachable");
  });

  it("stays malformed when the body arrived whole and is not what the route answers", async () => {
    const client = clientAnswering(() => Response.json({ unexpected: true }));

    const listed = await client.listDevices();
    expect(listed.ok || listed.failure.kind).toBe("malformed");
  });
});
