import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
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
const ENTRY = { c1: { createdAt: AT, source: "user" as const, text: "kept", updatedAt: AT } };

describe("the boot sweep over legacy sidecars", () => {
  it("folds every one with a note beside it, and names the ones it leaves", async () => {
    const root = path.join(makeTempDir("inteligir-comments-migration-"), "vault");
    mkdirSync(path.join(root, "deep"), { recursive: true });
    const vault = createVaultService({ lock: identityLock, notifier: noopNotifier, root });
    const comments = createCommentsService(vault, () => AT);

    writeFileSync(path.join(root, "a.md"), "note a\n");
    writeFileSync(path.join(root, legacyCommentsSidecarPath("a.md")), serializeSidecar(ENTRY));
    writeFileSync(path.join(root, "deep", "b.md"), "---\nid: b-note\n---\nnote b\n");
    writeFileSync(path.join(root, legacyCommentsSidecarPath("deep/b.md")), serializeSidecar(ENTRY));
    writeFileSync(path.join(root, legacyCommentsSidecarPath("gone.md")), serializeSidecar(ENTRY));
    writeFileSync(path.join(root, "c.md"), "note c\n");
    writeFileSync(path.join(root, legacyCommentsSidecarPath("c.md")), "{broken");

    const warnings: string[] = [];
    const migrated = await migrateLegacyCommentSidecars({
      comments,
      vault,
      warn: (message) => {
        warnings.push(message);
      },
    });

    expect(migrated).toBe(2);
    const idOfA = frontmatterId(readFileSync(path.join(root, "a.md"), "utf-8"));
    expect(idOfA).not.toBeNull();
    expect(existsSync(path.join(root, commentsStorePath(idOfA ?? "")))).toBe(true);
    expect(existsSync(path.join(root, commentsStorePath("b-note")))).toBe(true);
    expect(existsSync(path.join(root, legacyCommentsSidecarPath("a.md")))).toBe(false);
    expect(existsSync(path.join(root, legacyCommentsSidecarPath("deep/b.md")))).toBe(false);
    expect(existsSync(path.join(root, legacyCommentsSidecarPath("gone.md")))).toBe(true);
    expect(readFileSync(path.join(root, legacyCommentsSidecarPath("c.md")), "utf-8")).toBe(
      "{broken",
    );
    expect(warnings.map((line) => line.split(":")[0] ?? "").toSorted()).toEqual([
      "c.md.comments.json",
      "gone.md.comments.json",
    ]);
  });
});
