// Vault file CRUD through the typed client, with every mutation verified on
// disk — the vault is real files, so the wire answer alone proves nothing.

import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { isDefinedError, safe } from "@orpc/client";
import { expect, expectEq } from "../harness/assert";
import type { Scenario } from "../harness/scenario";

const FIXTURE_CONTENT = "# Seeded fixture\n";
const FIRST_CONTENT = "# Hello\n\nWritten by the e2e harness.\n";
const SECOND_CONTENT = "# Hello again\n\nOverwritten by the e2e harness.\n";

export const vaultCrud: Scenario = {
  name: "vault-crud",
  description: "write/read/rename/delete via the typed client + on-disk assertions",
  async run(ctx) {
    const app = await ctx.boot({
      name: "solo",
      seedVault: async (vaultDir) => {
        await writeFile(join(vaultDir, "fixture.md"), FIXTURE_CONTENT, "utf8");
      },
    });
    const { api, vaultDir } = app;

    ctx.log("listing the seeded tree");
    const tree = await api.vault.tree();
    expect(
      tree.entries.some((entry) => entry.kind === "file" && entry.path === "fixture.md"),
      "the pre-boot fixture file is listed",
    );

    ctx.log("write notes/hello.md");
    const write = await api.vault.write({ path: "notes/hello.md", content: FIRST_CONTENT });
    expectEq(write.path, "notes/hello.md", "write echoes the path");
    expectEq(
      await readFile(join(vaultDir, "notes", "hello.md"), "utf8"),
      FIRST_CONTENT,
      "written bytes on disk",
    );

    ctx.log("read it back and overwrite");
    const read = await api.vault.read({ path: "notes/hello.md" });
    expectEq(read.content, FIRST_CONTENT, "read-back content");

    await api.vault.write({ path: "notes/hello.md", content: SECOND_CONTENT });
    expectEq(
      await readFile(join(vaultDir, "notes", "hello.md"), "utf8"),
      SECOND_CONTENT,
      "overwritten bytes on disk",
    );

    ctx.log("rename notes/hello.md -> notes/renamed.md");
    await api.vault.rename({ from: "notes/hello.md", to: "notes/renamed.md" });
    expect(!existsSync(join(vaultDir, "notes", "hello.md")), "old path gone on disk");
    // Rename records the old stem in frontmatter aliases so wiki links keep
    // resolving; the body must ride along byte-intact below it.
    const renamedBytes = await readFile(join(vaultDir, "notes", "renamed.md"), "utf8");
    expect(renamedBytes.endsWith(SECOND_CONTENT), "renamed body bytes intact on disk");
    expect(
      renamedBytes.startsWith("---\n") && renamedBytes.includes("- hello"),
      "old stem recorded in frontmatter aliases",
    );
    const [readOldError] = await safe(api.vault.read({ path: "notes/hello.md" }));
    const readOldRefusal = isDefinedError(readOldError) ? readOldError.code : String(readOldError);
    expect(readOldRefusal === "NOT_FOUND", `old path read refused with ${readOldRefusal}`);

    ctx.log("rename onto an existing file is refused, and refuses on disk too");
    const preCollide = await readFile(join(vaultDir, "notes", "renamed.md"), "utf8");
    const [collideError] = await safe(
      api.vault.rename({ from: "notes/renamed.md", to: "fixture.md" }),
    );
    const collideRefusal = isDefinedError(collideError) ? collideError.code : String(collideError);
    expect(collideRefusal === "CONFLICT", `colliding rename refused with ${collideRefusal}`);
    expectEq(
      await readFile(join(vaultDir, "notes", "renamed.md"), "utf8"),
      preCollide,
      "refused rename leaves the source in place",
    );
    expectEq(
      await readFile(join(vaultDir, "fixture.md"), "utf8"),
      FIXTURE_CONTENT,
      "refused rename leaves the target bytes untouched",
    );

    ctx.log("delete notes/renamed.md");
    await api.vault.remove({ path: "notes/renamed.md" });
    expect(!existsSync(join(vaultDir, "notes", "renamed.md")), "deleted on disk");
    const [readGoneError] = await safe(api.vault.read({ path: "notes/renamed.md" }));
    const readGoneRefusal = isDefinedError(readGoneError)
      ? readGoneError.code
      : String(readGoneError);
    expect(readGoneRefusal === "NOT_FOUND", `deleted path read refused with ${readGoneRefusal}`);

    ctx.log("path refusals, and the disk stays untouched");
    const gitHeadBefore = await readFile(join(vaultDir, ".git", "HEAD"), "utf8");
    const [traversalReadError] = await safe(api.vault.read({ path: "../escape.md" }));
    const traversalReadRefusal = isDefinedError(traversalReadError)
      ? traversalReadError.code
      : String(traversalReadError);
    expect(
      traversalReadRefusal === "INVALID_PATH",
      `traversal read refused with ${traversalReadRefusal}`,
    );
    const [traversalWriteError] = await safe(
      api.vault.write({ path: "../escape.md", content: "x" }),
    );
    const traversalWriteRefusal = isDefinedError(traversalWriteError)
      ? traversalWriteError.code
      : String(traversalWriteError);
    expect(
      traversalWriteRefusal === "INVALID_PATH",
      `traversal write refused with ${traversalWriteRefusal}`,
    );
    expect(!existsSync(join(vaultDir, "..", "escape.md")), "no file escaped the vault root");
    const [gitWriteError] = await safe(
      api.vault.write({ path: ".git/hooks/pwn.md", content: "x" }),
    );
    const gitWriteRefusal = isDefinedError(gitWriteError)
      ? gitWriteError.code
      : String(gitWriteError);
    expect(gitWriteRefusal === "INVALID_PATH", `.git write refused with ${gitWriteRefusal}`);
    expect(!existsSync(join(vaultDir, ".git", "hooks", "pwn.md")), ".git target was not created");
    expectEq(
      await readFile(join(vaultDir, ".git", "HEAD"), "utf8"),
      gitHeadBefore,
      ".git/HEAD bytes unchanged",
    );
  },
};
