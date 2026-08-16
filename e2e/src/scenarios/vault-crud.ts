// Vault file CRUD through the typed client, with every mutation verified on
// disk — the vault is real files, so the wire answer alone proves nothing.

import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
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
    const tree = await api.vault.tree.$get();
    expect(tree.status === 200, `tree answered ${tree.status}`);
    const treeBody = await tree.json();
    expect(
      treeBody.entries.some((entry) => entry.kind === "file" && entry.path === "fixture.md"),
      "the pre-boot fixture file is listed",
    );

    ctx.log("write notes/hello.md");
    const write = await api.vault.file.$put({
      json: { path: "notes/hello.md", content: FIRST_CONTENT },
    });
    expect(write.status === 200, `write answered ${write.status}`);
    expectEq((await write.json()).path, "notes/hello.md", "write echoes the path");
    expectEq(
      await readFile(join(vaultDir, "notes", "hello.md"), "utf8"),
      FIRST_CONTENT,
      "written bytes on disk",
    );

    ctx.log("read it back and overwrite");
    const read = await api.vault.file.$get({ query: { path: "notes/hello.md" } });
    expect(read.status === 200, `read answered ${read.status}`);
    expectEq((await read.json()).content, FIRST_CONTENT, "read-back content");

    const overwrite = await api.vault.file.$put({
      json: { path: "notes/hello.md", content: SECOND_CONTENT },
    });
    expect(overwrite.status === 200, `overwrite answered ${overwrite.status}`);
    expectEq(
      await readFile(join(vaultDir, "notes", "hello.md"), "utf8"),
      SECOND_CONTENT,
      "overwritten bytes on disk",
    );

    ctx.log("rename notes/hello.md -> notes/renamed.md");
    const rename = await api.vault.rename.$post({
      json: { from: "notes/hello.md", to: "notes/renamed.md" },
    });
    expect(rename.status === 200, `rename answered ${rename.status}`);
    expect(!existsSync(join(vaultDir, "notes", "hello.md")), "old path gone on disk");
    // Rename records the old stem in frontmatter aliases so wiki links keep
    // resolving; the body must ride along byte-intact below it.
    const renamedBytes = await readFile(join(vaultDir, "notes", "renamed.md"), "utf8");
    expect(renamedBytes.endsWith(SECOND_CONTENT), "renamed body bytes intact on disk");
    expect(
      renamedBytes.startsWith("---\n") && renamedBytes.includes("- hello"),
      "old stem recorded in frontmatter aliases",
    );
    const readOld = await api.vault.file.$get({ query: { path: "notes/hello.md" } });
    expect(readOld.status === 404, `old path read answered ${readOld.status}`);

    ctx.log("rename onto an existing file is refused, and refuses on disk too");
    const preCollide = await readFile(join(vaultDir, "notes", "renamed.md"), "utf8");
    const collide = await api.vault.rename.$post({
      json: { from: "notes/renamed.md", to: "fixture.md" },
    });
    expect(collide.status === 409, `colliding rename answered ${collide.status}`);
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
    const remove = await api.vault.delete.$post({ json: { path: "notes/renamed.md" } });
    expect(remove.status === 200, `delete answered ${remove.status}`);
    expect(!existsSync(join(vaultDir, "notes", "renamed.md")), "deleted on disk");
    const readGone = await api.vault.file.$get({ query: { path: "notes/renamed.md" } });
    expect(readGone.status === 404, `deleted path read answered ${readGone.status}`);

    ctx.log("path refusals, and the disk stays untouched");
    const gitHeadBefore = await readFile(join(vaultDir, ".git", "HEAD"), "utf8");
    const traversalRead = await api.vault.file.$get({ query: { path: "../escape.md" } });
    expect(traversalRead.status === 400, `traversal read answered ${traversalRead.status}`);
    const traversalWrite = await api.vault.file.$put({
      json: { path: "../escape.md", content: "x" },
    });
    expect(traversalWrite.status === 400, `traversal write answered ${traversalWrite.status}`);
    expect(!existsSync(join(vaultDir, "..", "escape.md")), "no file escaped the vault root");
    const gitWrite = await api.vault.file.$put({
      json: { path: ".git/hooks/pwn.md", content: "x" },
    });
    expect(gitWrite.status === 400, `.git write answered ${gitWrite.status}`);
    expect(!existsSync(join(vaultDir, ".git", "hooks", "pwn.md")), ".git target was not created");
    expectEq(
      await readFile(join(vaultDir, ".git", "HEAD"), "utf8"),
      gitHeadBefore,
      ".git/HEAD bytes unchanged",
    );
  },
};
