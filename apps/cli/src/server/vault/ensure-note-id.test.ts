import { describe, expect, it } from "vitest";
import { frontmatterId } from "@repo/notes/markdown/frontmatter";
import { isUuidWikiAlias } from "@repo/notes/markdown/remark-wiki-link";
import { ensureNoteId } from "./ensure-note-id";
import type { ReadLane } from "./read-slots";
import type { VaultService } from "./vault-service";

const vaultOver = (
  files: Map<string, string>,
  lanes: (ReadLane | undefined)[] = [],
): Pick<VaultService, "read" | "writeIfUnchanged"> => ({
  read: async (path, lane) => {
    lanes.push(lane);
    return await Promise.resolve({ content: files.get(path) ?? "", path });
  },
  writeIfUnchanged: async (path, expected, content) => {
    if (files.get(path) !== expected) {
      return await Promise.resolve({ applied: false, reason: "changed" });
    }
    files.set(path, content);
    return await Promise.resolve({ applied: true, path });
  },
});

describe("a note given an id", () => {
  it("is minted a uuid, the form the `[[Title|uuid]]` tier resolves, and carries it", async () => {
    const files = new Map([["plan.md", "# Plan\n"]]);
    const outcome = await ensureNoteId(vaultOver(files), "plan.md", "# Plan\n");
    if (outcome.kind !== "id") {
      throw new Error(`expected an id, got ${outcome.kind}`);
    }
    expect(outcome.minted).toBe(true);
    expect(isUuidWikiAlias(outcome.id)).toBe(true);
    expect(frontmatterId(files.get("plan.md") ?? "")).toBe(outcome.id);
  });

  it("re-reads a note that moved under the write in the lane its caller read it in", async () => {
    const files = new Map([["plan.md", "# Plan, edited\n"]]);
    const lanes: (ReadLane | undefined)[] = [];
    const outcome = await ensureNoteId(
      vaultOver(files, lanes),
      "plan.md",
      "# Plan\n",
      "background",
    );
    expect(outcome.kind).toBe("id");
    expect(lanes).toEqual(["background"]);
    expect(files.get("plan.md")).toContain("# Plan, edited");
  });
});
