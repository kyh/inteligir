import { readFileSync } from "node:fs";
import nodePath from "node:path";
import { describe, expect, it } from "vitest";
import type { VaultService } from "../../vault/vault-service";
import { renameTagAcrossVault } from "../rename-tag";
import { bootIndexedVault, makeVaultDirs } from "./indexed-vault";

const boot = () => bootIndexedVault(makeVaultDirs("inteligir-knowledge-rename-tag-"));

describe("a tag rename across the vault", () => {
  it("rewrites every note holding the tag or its family, and the index agrees afterwards", async () => {
    const { root, service, knowledge } = boot();
    await service.write("a.md", "---\ntags: [project, keep]\n---\n\nOn #project now.\n");
    await service.write("b.md", "Nested #Project/alpha stays a family member.\n");
    await service.write("c.md", "No tag, though project is a word here.\n");

    expect(await knowledge.tagRenameCandidates("project")).toEqual(["a.md", "b.md"]);

    const result = await renameTagAcrossVault({ from: "project", knowledge, service, to: "work" });
    expect(result).toEqual({
      from: "project",
      rewritten: ["a.md", "b.md"],
      skipped: [],
      to: "work",
    });

    expect(readFileSync(nodePath.join(root, "a.md"), "utf-8")).toContain("On #work now.");
    expect(readFileSync(nodePath.join(root, "b.md"), "utf-8")).toBe(
      "Nested #work/alpha stays a family member.\n",
    );
    expect(readFileSync(nodePath.join(root, "c.md"), "utf-8")).toBe(
      "No tag, though project is a word here.\n",
    );

    const counted = await knowledge.tags();
    const tags = counted.map((entry) => entry.tag).toSorted();
    expect(tags).toEqual(["keep", "work", "work/alpha"]);
    expect(await knowledge.tagRenameCandidates("project")).toEqual([]);
  });

  it("refuses to overwrite a note that changed between the snapshot and the write", async () => {
    const { root, service, knowledge } = boot();
    await service.write("a.md", "First #project note.\n");
    await service.write("b.md", "Second #project note.\n");

    // the snapshot answers stale bytes for b.md, as a concurrent editor would leave them
    const stale: Pick<VaultService, "read" | "writeIfUnchanged"> = {
      read: async (path) =>
        path === "b.md"
          ? { content: "Second #project note, older.\n", path }
          : await service.read(path),
      writeIfUnchanged: async (path, expected, content) =>
        await service.writeIfUnchanged(path, expected, content),
    };
    const result = await renameTagAcrossVault({
      from: "project",
      knowledge,
      service: stale,
      to: "work",
    });
    expect(result.rewritten).toEqual(["a.md"]);
    expect(result.skipped).toEqual([{ path: "b.md", reason: "changed" }]);
    expect(readFileSync(nodePath.join(root, "b.md"), "utf-8")).toBe("Second #project note.\n");
  });
});
