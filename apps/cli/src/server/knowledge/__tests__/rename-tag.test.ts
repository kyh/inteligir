import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { noopNotifier } from "@repo/domain/notifier";
import { describe, expect, it, onTestFinished } from "vitest";
import { makeTempDir } from "../../__tests__/temp-dir";
import { createVaultService, type VaultService } from "../../vault/vault-service";
import { createKnowledgeRuntime, type KnowledgeRuntime } from "../knowledge-runtime";
import { renameTagAcrossVault } from "../rename-tag";
import { identityLock } from "../../__tests__/identity-lock";

function boot() {
  const instanceDir = makeTempDir("inteligir-knowledge-rename-tag-");
  const root = join(instanceDir, "vault");
  const dataDir = join(instanceDir, "data");
  mkdirSync(root, { recursive: true });
  mkdirSync(dataDir, { recursive: true });
  let sink: KnowledgeRuntime | null = null;
  const service = createVaultService({
    root,
    lock: identityLock,
    notifier: noopNotifier,
    onMutated: (paths) => sink?.noteVaultChange({ kind: "paths", paths }),
  });
  const knowledge = createKnowledgeRuntime({ dataDir, vault: service, vaultRoot: root });
  sink = knowledge;
  onTestFinished(() => knowledge.dispose());
  return { root, service, knowledge };
}

describe("a tag rename across the vault", () => {
  it("rewrites every note holding the tag or its family, and the index agrees afterwards", async () => {
    const { root, service, knowledge } = boot();
    await service.write("a.md", "---\ntags: [project, keep]\n---\n\nOn #project now.\n");
    await service.write("b.md", "Nested #Project/alpha stays a family member.\n");
    await service.write("c.md", "No tag, though project is a word here.\n");

    expect(await knowledge.tagRenameCandidates("project")).toEqual(["a.md", "b.md"]);

    const result = await renameTagAcrossVault({ service, knowledge, from: "project", to: "work" });
    expect(result).toEqual({
      from: "project",
      to: "work",
      rewritten: ["a.md", "b.md"],
      skipped: [],
    });

    expect(readFileSync(join(root, "a.md"), "utf8")).toContain("On #work now.");
    expect(readFileSync(join(root, "b.md"), "utf8")).toBe(
      "Nested #work/alpha stays a family member.\n",
    );
    expect(readFileSync(join(root, "c.md"), "utf8")).toBe(
      "No tag, though project is a word here.\n",
    );

    const tags = (await knowledge.tags()).map((entry) => entry.tag).toSorted();
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
        path === "b.md" ? { path, content: "Second #project note, older.\n" } : service.read(path),
      writeIfUnchanged: (path, expected, content) =>
        service.writeIfUnchanged(path, expected, content),
    };
    const result = await renameTagAcrossVault({
      service: stale,
      knowledge,
      from: "project",
      to: "work",
    });
    expect(result.rewritten).toEqual(["a.md"]);
    expect(result.skipped).toEqual([{ path: "b.md", reason: "changed" }]);
    expect(readFileSync(join(root, "b.md"), "utf8")).toBe("Second #project note.\n");
  });
});
