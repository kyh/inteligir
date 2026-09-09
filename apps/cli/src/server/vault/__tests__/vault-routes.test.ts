import { realpathSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { isDefinedError, safe, toORPCError } from "@orpc/client";
import { vaultChangedMessageSchema } from "@repo/api/local/notifications";
import { VAULT_ASSET_PATH, vaultAssetUrl } from "@repo/api/local/routes";
import {
  VAULT_ASSET_MAX_BYTES,
  VAULT_MAX_CONTENT_LENGTH,
  contentHashHex,
} from "@repo/api/local/vault/vault-schema";
import { describe, expect, it } from "vitest";
import { bootTestApp } from "../../__tests__/boot-app";
import { makeTempDir } from "../../__tests__/temp-dir";
import { WsBus } from "../../ws-bus";
import type { BusSocket } from "../../ws-bus";
import { createVaultRuntime } from "../vault-runtime";
import { hermeticGitEnv } from "./git-test-env";

// vitest types its asymmetric matchers `any`; naming one keeps the assertion typed.
const anyNumber: unknown = expect.any(Number);

describe("the vault routes", () => {
  it("writes through the API onto disk, lists and reads it back", async () => {
    const { client, vaultDir } = await bootTestApp();

    await client.vault.write({ content: "# via API\n", path: "notes/api.md" });
    expect(await readFile(path.join(vaultDir, "notes", "api.md"), "utf-8")).toBe("# via API\n");

    const tree = await client.vault.tree();
    // on macOS tmpdir() is spelled through /var → /private/var.
    expect(tree.root).toBe(realpathSync(vaultDir));
    expect(tree.entries).toEqual([
      { kind: "dir", path: "notes" },
      { kind: "file", modifiedMs: anyNumber, path: "notes/api.md" },
    ]);

    expect(await client.vault.read({ path: "notes/api.md" })).toEqual({
      content: "# via API\n",
      path: "notes/api.md",
    });
  });

  it("answers a note's history, and the bytes one revision held", async () => {
    const { client, vault } = await bootTestApp();

    await client.vault.write({ content: "# one\n", path: "notes/api.md" });
    await vault.git.commitNow();
    await client.vault.write({ content: "# one\n# two\n", path: "notes/api.md" });
    await vault.git.commitNow();

    const { revisions } = await client.vault.history({ path: "notes/api.md" });
    // the initialize commit never touched this path, so --follow does not list it.
    expect(revisions).toHaveLength(2);
    expect(revisions[0]?.subject).toBe("vault: update notes/api.md");
    expect(revisions[0]?.path).toBe("notes/api.md");
    expect(revisions[0]?.authorName).toBe("inteligir");
    expect(revisions[0]?.authorEmail).toBe("vault@inteligir.local");

    const [, oldest] = revisions;
    expect(
      await client.vault.revision({ path: oldest?.path ?? "", sha: oldest?.sha ?? "" }),
    ).toEqual({ content: "# one\n" });

    expect(await client.vault.history({ path: "notes/uncommitted.md" })).toEqual({
      revisions: [],
    });

    const [absentError] = await safe(
      client.vault.revision({ path: "notes/gone.md", sha: oldest?.sha ?? "" }),
    );
    expect(isDefinedError(absentError) && absentError.code).toBe("NOT_FOUND");

    const [shaError] = await safe(client.vault.revision({ path: "notes/api.md", sha: "HEAD" }));
    expect(toORPCError(shaError).code).toBe("BAD_REQUEST");
  });

  it("lists deleted docs, flushed or not, and a restore is a revision read plus an ifAbsent write", async () => {
    const { client, vault } = await bootTestApp();
    await client.vault.write({ content: "# gone\n", path: "notes/gone.md" });
    await client.vault.write({ content: "{}", path: "notes/gone.md.comments.json" });
    await vault.git.commitNow();
    await client.vault.remove({ path: "notes/gone.md" });
    await client.vault.remove({ path: "notes/gone.md.comments.json" });

    // the auto-commit is session-shaped: a note deleted seconds ago is in no commit yet.
    const unflushed = await client.vault.deleted();
    expect(unflushed.entries.map((entry) => entry.path)).toEqual(["notes/gone.md"]);

    await vault.git.commitNow();
    const { entries } = await client.vault.deleted();
    expect(entries.map((entry) => entry.path)).toEqual(["notes/gone.md"]);
    const [entry] = entries;
    const { content } = await client.vault.revision({
      path: entry?.path ?? "",
      sha: entry?.sha ?? "",
    });
    expect(content).toBe("# gone\n");

    await client.vault.write({ content, ifAbsent: true, path: entry?.path ?? "" });
    expect(await client.vault.read({ path: "notes/gone.md" })).toEqual({
      content: "# gone\n",
      path: "notes/gone.md",
    });
    const unflushedDeletions = await client.vault.deleted();
    expect(unflushedDeletions.entries).toEqual([]);
  });

  it("answers refusals with their declared classes", async () => {
    const { client } = await bootTestApp();

    const [missError] = await safe(client.vault.read({ path: "nope.md" }));
    expect(isDefinedError(missError) && missError.code).toBe("NOT_FOUND");

    const [traversalError] = await safe(client.vault.read({ path: "../escape.md" }));
    expect(toORPCError(traversalError).code).toBe("BAD_REQUEST");

    const [gitReachError] = await safe(
      client.vault.write({ content: "evil", path: ".git/config" }),
    );
    expect(toORPCError(gitReachError).code).toBe("BAD_REQUEST");

    await client.vault.write({ content: "a", path: "a.md" });
    await client.vault.write({ content: "b", path: "b.md" });
    const [clobberError] = await safe(client.vault.rename({ from: "a.md", to: "b.md" }));
    expect(isDefinedError(clobberError) && clobberError.code).toBe("CONFLICT");

    const [removeMissError] = await safe(client.vault.remove({ path: "ghost.md" }));
    expect(isDefinedError(removeMissError) && removeMissError.code).toBe("NOT_FOUND");

    const [oversizedError] = await safe(
      client.vault.write({ content: "x".repeat(VAULT_MAX_CONTENT_LENGTH + 1), path: "big.md" }),
    );
    expect(toORPCError(oversizedError).code).toBe("BAD_REQUEST");

    const [oversizedAsset] = await safe(
      client.vault.assetWrite({
        baseName: "big.png",
        bytesBase64: "A".repeat(Math.ceil(((VAULT_ASSET_MAX_BYTES + 1) * 4) / 3)),
        dir: "assets",
      }),
    );
    expect(isDefinedError(oversizedAsset) && oversizedAsset.code).toBe("PAYLOAD_TOO_LARGE");
  });

  it("refuses a vault nested in the data dir at composition time", async () => {
    const instanceDir = makeTempDir("inteligir-vault-routes-");
    await expect(
      createVaultRuntime({
        dataDir: instanceDir,
        gitEnv: hermeticGitEnv(),
        notifier: new WsBus(),
        remote: () => null,
        syncIntervalMs: null,
        vaultDir: path.join(instanceDir, "vault"),
        watch: false,
      }),
    ).rejects.toThrow(/must be disjoint/u);
  });

  it("renames and deletes through the API", async () => {
    const { client } = await bootTestApp();
    await client.vault.write({ content: "x", path: "old.md" });

    expect(await client.vault.rename({ from: "old.md", to: "nested/new.md" })).toEqual({
      path: "nested/new.md",
      rewritten: [],
      skipped: [],
    });

    expect(await client.vault.remove({ path: "nested/new.md" })).toEqual({ ok: true });
  });

  it("applies a compare-and-swap write whose hash matches, refuses a stale one with current", async () => {
    const { client } = await bootTestApp();
    await client.vault.write({ content: "v1", path: "cas.md" });
    const v1Hash = await contentHashHex("v1");

    expect(
      await client.vault.write({ content: "v2", expectedHash: v1Hash, path: "cas.md" }),
    ).toEqual({ path: "cas.md" });

    const [staleError] = await safe(
      client.vault.write({ content: "v3", expectedHash: v1Hash, path: "cas.md" }),
    );
    expect(isDefinedError(staleError) && staleError.code).toBe("CAS_MISMATCH");
    expect(
      isDefinedError(staleError) && staleError.code === "CAS_MISMATCH" && staleError.data,
    ).toEqual({ current: { content: "v2", hash: await contentHashHex("v2") } });

    const [ghostError] = await safe(
      client.vault.write({ content: "x", expectedHash: v1Hash, path: "ghost.md" }),
    );
    expect(isDefinedError(ghostError) && ghostError.code).toBe("CAS_MISMATCH");
    expect(
      isDefinedError(ghostError) && ghostError.code === "CAS_MISMATCH" && ghostError.data,
    ).toEqual({});
  });

  it("honors create-exclusive writes and refuses both guards together", async () => {
    const { client } = await bootTestApp();
    expect(await client.vault.write({ content: "new", ifAbsent: true, path: "fresh.md" })).toEqual({
      path: "fresh.md",
    });

    const [existsError] = await safe(
      client.vault.write({ content: "clobber", ifAbsent: true, path: "fresh.md" }),
    );
    expect(isDefinedError(existsError) && existsError.code).toBe("ALREADY_EXISTS");

    const [bothError] = await safe(
      client.vault.write({
        content: "x",
        expectedHash: await contentHashHex("new"),
        ifAbsent: true,
        path: "fresh.md",
      }),
    );
    expect(toORPCError(bothError).code).toBe("BAD_REQUEST");
  });

  it("creates folders through the API and refuses a file-shadowed one", async () => {
    const { client } = await bootTestApp();

    expect(await client.vault.mkdir({ path: "projects/ideas" })).toEqual({
      path: "projects/ideas",
    });

    const tree = await client.vault.tree();
    expect(tree.entries).toContainEqual({ kind: "dir", path: "projects/ideas" });

    await client.vault.write({ content: "x", path: "note.md" });
    const [shadowedError] = await safe(client.vault.mkdir({ path: "note.md" }));
    expect(isDefinedError(shadowedError) && shadowedError.code).toBe("CONFLICT");
  });

  it("answers status and sync-now as no-remote when no remote is configured", async () => {
    const { client } = await bootTestApp();

    const reported = await client.vault.status();
    expect(reported.state).toBe("no-remote");
    const synced = await client.vault.syncNow();
    expect(synced.state).toBe("no-remote");
  });

  it("serves an image asset with a pinned type, a sandbox CSP and an ETag", async () => {
    const { request, vaultDir } = await bootTestApp();
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"></svg>';
    await writeFile(path.join(vaultDir, "picture.svg"), svg, "utf-8");

    const asset = await request(`${VAULT_ASSET_PATH}?path=picture.svg`);
    expect(asset.status).toBe(200);
    expect(asset.headers.get("content-type")).toBe("image/svg+xml");
    expect(asset.headers.get("x-content-type-options")).toBe("nosniff");
    // without the sandbox, navigating to this URL runs the SVG's script on the app's origin.
    expect(asset.headers.get("content-security-policy")).toBe("default-src 'none'; sandbox");
    expect(await asset.text()).toBe(svg);

    const etag = asset.headers.get("etag");
    expect(etag).not.toBeNull();
    const revalidated = await request(`${VAULT_ASSET_PATH}?path=picture.svg`, {
      headers: { "if-none-match": etag ?? "" },
    });
    expect(revalidated.status).toBe(304);
  });

  it("refuses an asset whose extension is not an image type it serves", async () => {
    const { request, vaultDir } = await bootTestApp();
    await writeFile(path.join(vaultDir, "page.html"), "<script>alert(1)</script>", "utf-8");

    const refused = await request(`${VAULT_ASSET_PATH}?path=page.html`);
    expect(refused.status).toBe(400);
    expect(await refused.text()).toContain("not an image type this vault serves");

    const missing = await request(`${VAULT_ASSET_PATH}?path=absent.png`);
    expect(missing.status).toBe(404);
  });

  it("passes the markdown path VERBATIM to containment — no client-side normalization", async () => {
    const { request, vaultDir } = await bootTestApp();
    await writeFile(path.join(vaultDir, "my picture.png"), "png-bytes", "utf-8");

    const encoded = vaultAssetUrl("", "my picture.png");
    expect(encoded).toBe(`${VAULT_ASSET_PATH}?path=my%20picture.png`);
    const spaced = await request(encoded);
    expect(spaced.status).toBe(200);

    const traversal = await request(vaultAssetUrl("", "../escape.png"));
    expect(traversal.status).toBe(400);
  });

  it("refuses an asset request that carries no device token", async () => {
    const { composed, vaultDir } = await bootTestApp();
    await writeFile(path.join(vaultDir, "picture.png"), "not really a png", "utf-8");
    const anonymous = await composed.app.request(`${VAULT_ASSET_PATH}?path=picture.png`);
    expect(anonymous.status).toBe(401);
  });

  it("fans a mutation out to vault subscribers on the ws bus", async () => {
    const { client, bus } = await bootTestApp();
    const frames: string[] = [];
    const socket: BusSocket = {
      close: () => {},
      readyState: 1,
      send: (data) => {
        frames.push(data);
      },
    };
    bus.registerClient(socket);
    bus.subscribe(socket, { kind: "vault" });

    await client.vault.write({ content: "ping", path: "notify.md" });
    const sawVaultChange = frames.some(
      (frame) => vaultChangedMessageSchema.safeParse(JSON.parse(frame)).success,
    );
    expect(sawVaultChange).toBe(true);
  });
});

describe("a note's comment store goes with the note", () => {
  const NOTE_ID = "0f6a3b1e-5c2d-4e8f-9a7b-1c3d5e7f9a0b";
  const STORE = `.inteligir/comments/${NOTE_ID}.json`;
  const NOTE = `---\nid: ${NOTE_ID}\n---\n%%i:c1:start%%x%%i:c1:end%%\n`;

  it("is removed with the note, and the deleted-notes restore brings both back", async () => {
    const { client, vault } = await bootTestApp();
    await client.vault.write({ content: NOTE, path: "notes/keep.md" });
    await client.comments.add({ id: "c1", path: "notes/keep.md", text: "kept" });
    await vault.git.commitNow();

    await client.vault.remove({ path: "notes/keep.md" });
    const [gone] = await safe(client.vault.read({ path: STORE }));
    expect(isDefinedError(gone) && gone.code).toBe("NOT_FOUND");
    await vault.git.commitNow();

    const deleted = await client.vault.deleted();
    const entry = deleted.entries.find((row) => row.path === "notes/keep.md");
    expect(entry).toBeDefined();
    const sha = entry?.sha ?? "";
    const note = await client.vault.revision({ path: "notes/keep.md", sha });
    await client.vault.write({ content: note.content, ifAbsent: true, path: "notes/keep.md" });
    const store = await client.vault.revision({ path: STORE, sha });
    await client.vault.write({ content: store.content, ifAbsent: true, path: STORE });

    const listed = await client.comments.list({ path: "notes/keep.md" });
    expect(listed.threads.map((thread) => thread.rootId)).toEqual(["c1"]);
  });

  it("goes for every note under a removed folder, and a note without an id has none to remove", async () => {
    const { client } = await bootTestApp();
    await client.vault.write({ content: NOTE, path: "box/a.md" });
    await client.comments.add({ id: "c1", path: "box/a.md", text: "a" });
    await client.vault.write({ content: "no id\n", path: "box/plain.md" });

    await client.vault.remove({ path: "box" });

    const [gone] = await safe(client.vault.read({ path: STORE }));
    expect(isDefinedError(gone) && gone.code).toBe("NOT_FOUND");
    const tree = await client.vault.tree();
    expect(tree.entries.some((row) => row.path.startsWith("box"))).toBe(false);
  });
});
