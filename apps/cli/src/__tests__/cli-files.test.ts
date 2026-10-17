// a file's whole life on the command line, against the real composition: saved as an item, deleted
// with its wrapper, listed in Deleted under it, and restored byte for byte.

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, truncate, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileTooLargeMessage } from "@repo/contract/local/items/items-schema";
import { vaultDeletedResponseSchema } from "@repo/contract/local/vault/vault-schema";
import { describe, expect, it, onTestFinished } from "vitest";
import { z } from "zod";
import { bootTestApp, listenTestApp, TEST_SERVER_TOKEN } from "../server/__tests__/boot-app";
import { loopbackOrigin } from "../server/server-file";
import { FIXTURE_FILE_PATH } from "./command-tree";
import { runCliForTest } from "./run-cli";

const sha256 = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");

const bootFiles = async () => {
  const booted = await bootTestApp();
  const { port } = await listenTestApp(booted);
  const baseUrl = loopbackOrigin(port);
  const cli = async (...argv: string[]) =>
    await runCliForTest({ argv, baseUrl, token: TEST_SERVER_TOKEN });
  const onDisk = (vaultPath: string): Uint8Array | null => {
    const absolute = path.join(booted.vaultDir, vaultPath);
    return existsSync(absolute) ? new Uint8Array(readFileSync(absolute)) : null;
  };
  return { booted, cli, onDisk };
};

const savedSchema = z.object({ path: z.string() });

const deletedSchema = vaultDeletedResponseSchema;

describe("a file on the command line", { timeout: 60_000 }, () => {
  it("saves a PDF as an item, deletes the original with it, and restores both byte-exact", async () => {
    const { booted, cli, onDisk } = await bootFiles();
    const original = new Uint8Array(readFileSync(FIXTURE_FILE_PATH));

    const saved = await cli("save", FIXTURE_FILE_PATH, "--json");
    expect(saved.code).toBe(0);
    const { path: wrapper } = savedSchema.parse(JSON.parse(saved.stdout));
    expect(wrapper).toBe("Unsorted/brochure.md");
    expect(onDisk("assets/brochure.pdf")).toEqual(original);
    await booted.vault.git.commitNow();

    const deleted = await cli("vault", "delete", wrapper);
    expect(deleted.code).toBe(0);
    // the original went with its wrapper: nothing else embeds it. the deletion is left
    // unflushed, as the auto-commit's quiet window leaves it, so the restore's own checkpoint
    // of the note must not split the two
    expect(onDisk("assets/brochure.pdf")).toBeNull();

    const listed = await cli("vault", "deleted", "--json");
    const { entries } = deletedSchema.parse(JSON.parse(listed.stdout));
    const byPath = new Map(entries.map((entry) => [entry.path, entry]));
    expect(byPath.get(wrapper)).toMatchObject({ heldBy: null, kind: "doc" });
    expect(byPath.get("assets/brochure.pdf")).toMatchObject({ heldBy: wrapper, kind: "file" });
    const human = await cli("vault", "deleted");
    expect(human.stdout).toContain(`assets/brochure.pdf\theld by ${wrapper}\n`);

    const sha = byPath.get(wrapper)?.sha ?? "";
    const restored = await cli("vault", "restore", wrapper, sha);
    expect(restored.stdout).toBe(`✔ Restored ${wrapper} to ${sha}, with 1 file\n`);
    const back = onDisk("assets/brochure.pdf");
    expect(back === null ? null : sha256(back)).toBe(sha256(original));
  });

  it("restores a deleted file alone, only where nothing stands, and answers --json", async () => {
    const { booted, cli, onDisk } = await bootFiles();
    const bytes = new Uint8Array([137, 80, 78, 71, 0, 0xff, 0xfe]);
    await mkdir(path.join(booted.vaultDir, "assets"), { recursive: true });
    await writeFile(path.join(booted.vaultDir, "assets", "loose.png"), bytes);
    await booted.vault.git.commitNow();
    await booted.vault.service.remove("assets/loose.png");
    await booted.vault.git.commitNow();
    const listed = await cli("vault", "deleted", "--json");
    const { entries } = deletedSchema.parse(JSON.parse(listed.stdout));
    const entry = entries.find((each) => each.path === "assets/loose.png");
    const sha = entry?.sha ?? "";

    const restored = await cli("vault", "restore", "assets/loose.png", sha, "--json");
    expect(restored.code).toBe(0);
    expect(JSON.parse(restored.stdout)).toEqual({ path: "assets/loose.png" });
    expect(onDisk("assets/loose.png")).toEqual(bytes);

    const again = await cli("vault", "restore", "assets/loose.png", sha, "--json");
    expect(again.code).toBe(1);
    expect(JSON.parse(again.stderr)).toMatchObject({ error: "ALREADY_EXISTS" });
  });

  it("refuses a file over 10 MB before any request", async () => {
    const { cli } = await bootFiles();
    const dir = await mkdtemp(path.join(tmpdir(), "inteligir-cli-files-"));
    onTestFinished(async () => {
      await rm(dir, { force: true, recursive: true });
    });
    const big = path.join(dir, "film.mp4");
    await writeFile(big, "");
    await truncate(big, 11 * 1024 * 1024);

    const refused = await cli("save", big, "--json");
    expect(refused.code).not.toBe(0);
    expect(JSON.parse(refused.stderr)).toEqual({
      error: "INVALID_USAGE",
      message: fileTooLargeMessage("film.mp4", 11 * 1024 * 1024),
    });
  });
});
