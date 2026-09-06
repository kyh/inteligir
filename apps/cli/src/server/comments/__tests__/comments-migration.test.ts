import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { noopNotifier } from "@repo/domain/notifier";
import { describe, expect, it } from "vitest";
import { makeTempDir } from "../../__tests__/temp-dir";
import { createVaultService } from "../../vault/vault-service";
import {
  commentsStorePath,
  legacyCommentsSidecarPath,
  serializeSidecar,
} from "@repo/notes/comments/sidecar-schema";
import { frontmatterId } from "@repo/notes/markdown/frontmatter";
import { identityLock } from "../../__tests__/identity-lock";
import { migrateLegacyCommentSidecars } from "../comments-migration";
import { createCommentsService } from "../comments-service";

const AT = 1_707_900_000;
const ENTRY = { c1: { text: "kept", createdAt: AT, updatedAt: AT, source: "user" as const } };

describe("the boot sweep over legacy sidecars", () => {
  it("folds every one with a note beside it, and names the ones it leaves", async () => {
    const root = join(makeTempDir("inteligir-comments-migration-"), "vault");
    mkdirSync(join(root, "deep"), { recursive: true });
    const vault = createVaultService({ lock: identityLock, notifier: noopNotifier, root });
    const comments = createCommentsService(vault, () => AT);

    writeFileSync(join(root, "a.md"), "note a\n");
    writeFileSync(join(root, legacyCommentsSidecarPath("a.md")), serializeSidecar(ENTRY));
    writeFileSync(join(root, "deep", "b.md"), "---\nid: b-note\n---\nnote b\n");
    writeFileSync(join(root, legacyCommentsSidecarPath("deep/b.md")), serializeSidecar(ENTRY));
    writeFileSync(join(root, legacyCommentsSidecarPath("gone.md")), serializeSidecar(ENTRY));
    writeFileSync(join(root, "c.md"), "note c\n");
    writeFileSync(join(root, legacyCommentsSidecarPath("c.md")), "{broken");

    const warnings: string[] = [];
    const migrated = await migrateLegacyCommentSidecars({
      vault,
      comments,
      warn: (message) => warnings.push(message),
    });

    expect(migrated).toBe(2);
    const idOfA = frontmatterId(readFileSync(join(root, "a.md"), "utf8"));
    expect(idOfA).not.toBeNull();
    expect(existsSync(join(root, commentsStorePath(idOfA ?? "")))).toBe(true);
    expect(existsSync(join(root, commentsStorePath("b-note")))).toBe(true);
    expect(existsSync(join(root, legacyCommentsSidecarPath("a.md")))).toBe(false);
    expect(existsSync(join(root, legacyCommentsSidecarPath("deep/b.md")))).toBe(false);
    expect(existsSync(join(root, legacyCommentsSidecarPath("gone.md")))).toBe(true);
    expect(readFileSync(join(root, legacyCommentsSidecarPath("c.md")), "utf8")).toBe("{broken");
    expect(warnings.map((line) => line.split(":")[0] ?? "").toSorted()).toEqual([
      "c.md.comments.json",
      "gone.md.comments.json",
    ]);
  });
});
