import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { ORPCError, safe } from "@orpc/client";
import { expect, expectEq } from "../harness/assert";
import type { Scenario } from "../harness/scenario";

const FIXTURE_CONTENT = "# Seeded fixture\n";
const FIRST_CONTENT = "# Hello\n\nWritten by the e2e harness.\n";
const SECOND_CONTENT = "# Hello again\n\nOverwritten by the e2e harness.\n";

const refusalClass = (cause: unknown): string =>
  cause instanceof ORPCError ? String(cause.code) : String(cause);

export const vaultCrud: Scenario = {
  description: "write/read/rename/delete via the typed client + on-disk assertions",
  name: "vault-crud",
  async run(ctx) {
    const app = await ctx.boot({
      name: "solo",
      seedVault: async (vaultDir) => {
        await writeFile(path.join(vaultDir, "fixture.md"), FIXTURE_CONTENT, "utf-8");
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
    const write = await api.vault.write({ content: FIRST_CONTENT, path: "notes/hello.md" });
    expectEq(write.path, "notes/hello.md", "write echoes the path");
    expectEq(
      await readFile(path.join(vaultDir, "notes", "hello.md"), "utf-8"),
      FIRST_CONTENT,
      "written bytes on disk",
    );

    ctx.log("read it back and overwrite");
    const read = await api.vault.read({ path: "notes/hello.md" });
    expectEq(read.content, FIRST_CONTENT, "read-back content");

    await api.vault.write({ content: SECOND_CONTENT, path: "notes/hello.md" });
    expectEq(
      await readFile(path.join(vaultDir, "notes", "hello.md"), "utf-8"),
      SECOND_CONTENT,
      "overwritten bytes on disk",
    );

    ctx.log("rename notes/hello.md -> notes/renamed.md");
    await api.vault.rename({ from: "notes/hello.md", to: "notes/renamed.md" });
    expect(!existsSync(path.join(vaultDir, "notes", "hello.md")), "old path gone on disk");
    const renamedBytes = await readFile(path.join(vaultDir, "notes", "renamed.md"), "utf-8");
    expect(renamedBytes.endsWith(SECOND_CONTENT), "renamed body bytes intact on disk");
    expect(
      renamedBytes.startsWith("---\n") && renamedBytes.includes("- hello"),
      "old stem recorded in frontmatter aliases",
    );
    const [readOldError] = await safe(api.vault.read({ path: "notes/hello.md" }));
    const readOldRefusal = refusalClass(readOldError);
    expect(readOldRefusal === "NOT_FOUND", `old path read refused with ${readOldRefusal}`);

    ctx.log("rename onto an existing file is refused, and refuses on disk too");
    const preCollide = await readFile(path.join(vaultDir, "notes", "renamed.md"), "utf-8");
    const [collideError] = await safe(
      api.vault.rename({ from: "notes/renamed.md", to: "fixture.md" }),
    );
    const collideRefusal = refusalClass(collideError);
    expect(collideRefusal === "CONFLICT", `colliding rename refused with ${collideRefusal}`);
    expectEq(
      await readFile(path.join(vaultDir, "notes", "renamed.md"), "utf-8"),
      preCollide,
      "refused rename leaves the source in place",
    );
    expectEq(
      await readFile(path.join(vaultDir, "fixture.md"), "utf-8"),
      FIXTURE_CONTENT,
      "refused rename leaves the target bytes untouched",
    );

    ctx.log("delete notes/renamed.md");
    await api.vault.remove({ path: "notes/renamed.md" });
    expect(!existsSync(path.join(vaultDir, "notes", "renamed.md")), "deleted on disk");
    const [readGoneError] = await safe(api.vault.read({ path: "notes/renamed.md" }));
    const readGoneRefusal = refusalClass(readGoneError);
    expect(readGoneRefusal === "NOT_FOUND", `deleted path read refused with ${readGoneRefusal}`);

    ctx.log("path refusals, and the disk stays untouched");
    const gitHeadBefore = await readFile(path.join(vaultDir, ".git", "HEAD"), "utf-8");
    // the path grammar rides the input schema, so the validator refuses (BAD_REQUEST), never a
    // handler.
    for (const escaping of ["../escape.md", ".git/hooks/pwn.md"]) {
      const [readError] = await safe(api.vault.read({ path: escaping }));
      expect(
        refusalClass(readError) === "BAD_REQUEST",
        `reading ${escaping} refused with ${refusalClass(readError)}`,
      );
      const [writeError] = await safe(api.vault.write({ content: "x", path: escaping }));
      expect(
        refusalClass(writeError) === "BAD_REQUEST",
        `writing ${escaping} refused with ${refusalClass(writeError)}`,
      );
    }
    expect(!existsSync(path.join(vaultDir, "..", "escape.md")), "no file escaped the vault root");
    expect(
      !existsSync(path.join(vaultDir, ".git", "hooks", "pwn.md")),
      ".git target was not created",
    );
    expectEq(
      await readFile(path.join(vaultDir, ".git", "HEAD"), "utf-8"),
      gitHeadBefore,
      ".git/HEAD bytes unchanged",
    );
  },
};
