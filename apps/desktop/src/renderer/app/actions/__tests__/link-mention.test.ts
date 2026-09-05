import type { UnlinkedMentionWire } from "@repo/api/local/knowledge/knowledge-schema";
import { contentHashHex, type VaultWriteRequest } from "@repo/api/local/vault/vault-schema";
import { describe, expect, it, vi } from "vitest";
import { linkMentionInNote, linkMentionMessage, type LinkMentionApi } from "../link-mention";

const mention: UnlinkedMentionWire = {
  path: "a.md",
  title: "a",
  line: 1,
  column: 15,
  length: 7,
  before: "We revisit the ",
  text: "roadmap",
  after: " on Monday.",
  count: 1,
};

function apiOver(content: string): LinkMentionApi & { writes: VaultWriteRequest[] } {
  const writes: VaultWriteRequest[] = [];
  return {
    writes,
    vault: {
      read: vi.fn(() => Promise.resolve({ path: "a.md", content })),
      write: vi.fn((input: VaultWriteRequest) => {
        writes.push(input);
        return Promise.resolve({ path: "a.md", hash: "x" });
      }),
    },
  };
}

describe("linking an unlinked mention", () => {
  it("writes the wrapped bytes with the hash of what it read", async () => {
    const content = "We revisit the roadmap on Monday.\n";
    const api = apiOver(content);
    expect(await linkMentionInNote(api, mention, "Roadmap")).toEqual({
      kind: "written",
      result: undefined,
    });
    expect(api.writes).toEqual([
      {
        path: "a.md",
        content: "We revisit the [[Roadmap|roadmap]] on Monday.\n",
        expectedHash: await contentHashHex(content),
      },
    ]);
  });

  it("writes nothing when the note no longer holds those bytes there", async () => {
    const api = apiOver("Rewritten since.\n");
    expect(await linkMentionInNote(api, mention, "Roadmap")).toEqual({ kind: "changed" });
    expect(api.writes).toEqual([]);
  });

  it("reports a refused read by name", async () => {
    const api = apiOver("");
    api.vault.read = vi.fn(() => Promise.reject(new Error("gone")));
    const outcome = await linkMentionInNote(api, mention, "Roadmap");
    expect(outcome.kind).toBe("failed");
    expect(linkMentionMessage(outcome, "a.md")).toMatch(/^Could not link from a\.md/u);
  });
});
