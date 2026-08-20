// jsdom cannot exercise real keepalive semantics (surviving page unload is a
// browser networking behavior); what this covers is the request SHAPE — the
// route, method, body and the keepalive flag itself.

import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { sendKeepaliveWrite } from "../keepalive-write";

describe("sendKeepaliveWrite", () => {
  it("fires a keepalive PUT at the vault write route with the plain body", () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 200 }));
    sendKeepaliveWrite("http://127.0.0.1:4664", "notes/a.md", "content\n", fetchImpl);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [input, init] = fetchImpl.mock.calls[0] ?? [];
    const url = input instanceof URL || input instanceof Request ? null : input;
    expect(url).toBe("http://127.0.0.1:4664/api/v1/vault/file");
    expect(init).toMatchObject({ method: "PUT", keepalive: true });
    const sent = z.string().safeParse(init?.body);
    const body: unknown = sent.success ? JSON.parse(sent.data) : null;
    expect(body).toEqual({ path: "notes/a.md", content: "content\n" });
  });

  it("swallows a rejected fetch — the page is unloading", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockRejectedValue(new Error("aborted"));
    expect(() => sendKeepaliveWrite("http://x", "a.md", "c", fetchImpl)).not.toThrow();
    await Promise.resolve();
  });
});
