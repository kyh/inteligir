import type { UnlinkedMentionWire } from "@repo/api/local/knowledge/knowledge-schema";
import { contentHashHex } from "@repo/api/local/vault/vault-schema";
import type { VaultWriteRequest } from "@repo/api/local/vault/vault-schema";
import { describe, expect, it, vi } from "vitest";
import { linkMentionInNote, linkMentionMessage } from "../link-mention";
import type { LinkMentionApi } from "../link-mention";

const mention: UnlinkedMentionWire = {
  after: " on Monday.",
  before: "We revisit the ",
  column: 15,
  count: 1,
  length: 7,
  line: 1,
  path: "a.md",
  text: "roadmap",
  title: "a",
};

const apiOver = (content: string): LinkMentionApi & { writes: VaultWriteRequest[] } => {
  const writes: VaultWriteRequest[] = [];
  return {
    vault: {
      read: vi.fn<LinkMentionApi["vault"]["read"]>().mockResolvedValue({ content, path: "a.md" }),
      write: vi.fn(async (input: VaultWriteRequest) => {
        writes.push(input);
        return { hash: "x", path: "a.md" };
      }),
    },
    writes,
  };
};

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
        content: "We revisit the [[Roadmap|roadmap]] on Monday.\n",
        expectedHash: await contentHashHex(content),
        path: "a.md",
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
    api.vault.read = vi.fn<LinkMentionApi["vault"]["read"]>().mockRejectedValue(new Error("gone"));
    const outcome = await linkMentionInNote(api, mention, "Roadmap");
    expect(outcome.kind).toBe("failed");
    expect(linkMentionMessage(outcome, "a.md")).toMatch(/^Could not link from a\.md/u);
  });
});
