import { realpathSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { isDefinedError, safe, toORPCError } from "@orpc/client";
import { vaultChangedMessageSchema } from "@repo/api/local/notifications";
import { legacyCommentsSidecarPath } from "@repo/notes/comments/sidecar-schema";
import { VAULT_ASSET_PATH, vaultAssetUrl } from "@repo/api/local/routes";
import { knowledgeSearchResponseSchema } from "@repo/api/local/knowledge/knowledge-schema";
import { giveNoteOwnId } from "@repo/api/local/vault/give-note-own-id";
import { restoreCommentStore } from "@repo/api/local/vault/restore-comment-store";
import {
  VAULT_ASSET_MAX_BYTES,
  VAULT_MAX_CONTENT_LENGTH,
  contentHashHex,
} from "@repo/api/local/vault/vault-schema";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import { bootTestApp, listenTestApp, TEST_MACHINE_NAME } from "../../__tests__/boot-app";
import { makeTempDir } from "../../__tests__/temp-dir";
import { writeDeviceCredential } from "../../cloud/credential-store";
import { WsBus } from "../../ws-bus";
import type { BusSocket } from "../../ws-bus";
import { runGit } from "../git-run";
import { createVaultRuntime } from "../vault-runtime";
import { hermeticGitEnv } from "./git-test-env";

// vitest types its asymmetric matchers `any`; naming one keeps the assertion typed.
const anyNumber: unknown = expect.any(Number);

const PNG = new Blob([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 255])], {
  type: "image/png",
});

describe("the vault routes", () => {
  it("writes through the API onto disk, lists and reads it back", async () => {
    const { client, vaultDir } = await bootTestApp();

    await client.vault.write({
      content: "# via API\n",
      guard: { kind: "overwrite" },
      path: "notes/api.md",
    });
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

    await client.vault.write({
      content: "# one\n",
      guard: { kind: "overwrite" },
      path: "notes/api.md",
    });
    await vault.git.commitNow();
    await client.vault.write({
      content: "# one\n# two\n",
      guard: { kind: "overwrite" },
      path: "notes/api.md",
    });
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

  it("checkpoints only the paths a commitNow names, and the whole dirty tree when it names none", async () => {
    const { client } = await bootTestApp();
    for (const notePath of ["notes/named.md", "notes/other.md"]) {
      // distinct bytes: --follow would read a byte-identical add as a rename of the first.
      await client.vault.write({
        content: `# ${notePath}\n`,
        guard: { kind: "overwrite" },
        path: notePath,
      });
    }

    expect(await client.vault.commitNow({ paths: ["notes/named.md"] })).toEqual({ files: 1 });
    const named = await client.vault.history({ path: "notes/named.md" });
    expect(named.revisions).toHaveLength(1);
    expect(await client.vault.history({ path: "notes/other.md" })).toEqual({ revisions: [] });

    expect(await client.vault.commitNow()).toEqual({ files: 1 });
    const other = await client.vault.history({ path: "notes/other.md" });
    expect(other.revisions).toHaveLength(1);
  });

  it("lists deleted docs, flushed or not, and a restore is a revision read plus an absent-guarded write", async () => {
    const { client, vault } = await bootTestApp();
    await client.vault.write({
      content: "# gone\n",
      guard: { kind: "overwrite" },
      path: "notes/gone.md",
    });
    await client.vault.write({
      content: "{}",
      guard: { kind: "overwrite" },
      path: "notes/gone.md.comments.json",
    });
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

    await client.vault.write({ content, guard: { kind: "absent" }, path: entry?.path ?? "" });
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
      client.vault.write({ content: "evil", guard: { kind: "overwrite" }, path: ".git/config" }),
    );
    expect(toORPCError(gitReachError).code).toBe("BAD_REQUEST");

    await client.vault.write({ content: "a", guard: { kind: "overwrite" }, path: "a.md" });
    await client.vault.write({ content: "b", guard: { kind: "overwrite" }, path: "b.md" });
    const [clobberError] = await safe(client.vault.rename({ from: "a.md", to: "b.md" }));
    expect(isDefinedError(clobberError) && clobberError.code).toBe("CONFLICT");

    const [removeMissError] = await safe(client.vault.remove({ path: "ghost.md" }));
    expect(isDefinedError(removeMissError) && removeMissError.code).toBe("NOT_FOUND");

    const [oversizedError] = await safe(
      client.vault.write({
        content: "x".repeat(VAULT_MAX_CONTENT_LENGTH + 1),
        guard: { kind: "overwrite" },
        path: "big.md",
      }),
    );
    expect(toORPCError(oversizedError).code).toBe("BAD_REQUEST");

    const [oversizedAsset] = await safe(
      client.vault.assetWrite({
        baseName: "big.png",
        dir: "assets",
        file: new Blob([new Uint8Array(VAULT_ASSET_MAX_BYTES + 1)]),
      }),
    );
    expect(isDefinedError(oversizedAsset) && oversizedAsset.code).toBe("PAYLOAD_TOO_LARGE");

    const [shadowedWrite] = await safe(
      client.vault.write({ content: "x", guard: { kind: "overwrite" }, path: "a.md/b.md" }),
    );
    expect(isDefinedError(shadowedWrite) && shadowedWrite.code).toBe("CONFLICT");

    const [shadowedAsset] = await safe(
      client.vault.assetWrite({ baseName: "shot.png", dir: "a.md", file: PNG }),
    );
    expect(isDefinedError(shadowedAsset) && shadowedAsset.code).toBe("CONFLICT");
  });

  it("carries a pasted attachment over the wire as a multipart Blob, byte-exact", async () => {
    const booted = await bootTestApp();
    const { client } = await listenTestApp(booted);

    const written = await client.vault.assetWrite({ baseName: "shot.png", dir: "", file: PNG });

    expect(written).toEqual({ path: "shot.png" });
    const onDisk = await readFile(path.join(booted.vaultDir, "shot.png"));
    expect(new Uint8Array(onDisk)).toEqual(new Uint8Array(await PNG.arrayBuffer()));
  });

  it("refuses a vault nested in the data dir at composition time", async () => {
    const instanceDir = makeTempDir("inteligir-vault-routes-");
    await expect(
      createVaultRuntime({
        dataDir: instanceDir,
        deviceName: () => "Test Mac",
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
    await client.vault.write({ content: "x", guard: { kind: "overwrite" }, path: "old.md" });

    expect(await client.vault.rename({ from: "old.md", to: "nested/new.md" })).toEqual({
      path: "nested/new.md",
      rewritten: [],
      skipped: [],
    });

    expect(await client.vault.remove({ path: "nested/new.md" })).toEqual({ ok: true });
  });

  it("applies a compare-and-swap write whose hash matches, refuses a stale one with current", async () => {
    const { client } = await bootTestApp();
    await client.vault.write({ content: "v1", guard: { kind: "overwrite" }, path: "cas.md" });
    const v1Hash = await contentHashHex("v1");

    expect(
      await client.vault.write({
        content: "v2",
        guard: { hash: v1Hash, kind: "expected" },
        path: "cas.md",
      }),
    ).toEqual({ path: "cas.md" });

    const [staleError] = await safe(
      client.vault.write({
        content: "v3",
        guard: { hash: v1Hash, kind: "expected" },
        path: "cas.md",
      }),
    );
    expect(isDefinedError(staleError) && staleError.code).toBe("CAS_MISMATCH");
    expect(
      isDefinedError(staleError) && staleError.code === "CAS_MISMATCH" && staleError.data,
    ).toEqual({ current: { content: "v2", hash: await contentHashHex("v2") } });

    const [ghostError] = await safe(
      client.vault.write({
        content: "x",
        guard: { hash: v1Hash, kind: "expected" },
        path: "ghost.md",
      }),
    );
    expect(isDefinedError(ghostError) && ghostError.code).toBe("CAS_MISMATCH");
    expect(
      isDefinedError(ghostError) && ghostError.code === "CAS_MISMATCH" && ghostError.data,
    ).toEqual({});
  });

  it("honors create-exclusive writes, and overwrites only when told to", async () => {
    const { client } = await bootTestApp();
    expect(
      await client.vault.write({ content: "new", guard: { kind: "absent" }, path: "fresh.md" }),
    ).toEqual({
      path: "fresh.md",
    });

    const [existsError] = await safe(
      client.vault.write({ content: "clobber", guard: { kind: "absent" }, path: "fresh.md" }),
    );
    expect(isDefinedError(existsError) && existsError.code).toBe("ALREADY_EXISTS");
    expect(await client.vault.read({ path: "fresh.md" })).toEqual({
      content: "new",
      path: "fresh.md",
    });

    await client.vault.write({
      content: "clobber",
      guard: { kind: "overwrite" },
      path: "fresh.md",
    });
    expect(await client.vault.read({ path: "fresh.md" })).toEqual({
      content: "clobber",
      path: "fresh.md",
    });
  });

  it("creates folders through the API and refuses a file-shadowed one", async () => {
    const { client } = await bootTestApp();

    expect(await client.vault.mkdir({ path: "projects/ideas" })).toEqual({
      path: "projects/ideas",
    });

    const tree = await client.vault.tree();
    expect(tree.entries).toContainEqual({ kind: "dir", path: "projects/ideas" });

    await client.vault.write({ content: "x", guard: { kind: "overwrite" }, path: "note.md" });
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

  it("names the service that syncs a vault in iCloud Drive, and runs no pass though signed in", async () => {
    const { client, dataDir, vaultDir } = await bootTestApp({
      remote: "derived",
      vaultPath: path.join("Library", "Mobile Documents", "com~apple~CloudDocs", "Notes"),
    });
    writeDeviceCredential(dataDir, {
      credential: `igd_${"a".repeat(64)}`,
      deviceId: "dev_1",
      userId: "usr_1",
    });
    await client.vault.write({ content: "# mine\n", guard: { kind: "overwrite" }, path: "a.md" });

    const expected = {
      conflicts: [],
      device: TEST_MACHINE_NAME,
      externalSync: { kind: "icloud-drive" },
      lastError: null,
      lastSyncAt: null,
      state: "no-remote",
    };
    expect(await client.vault.status()).toEqual(expected);
    expect(await client.vault.syncNow()).toEqual(expected);
    // a pass would have written the hosted url into the vault's config
    await expect(
      runGit(vaultDir, ["remote", "get-url", "origin"], { env: hermeticGitEnv() }),
    ).rejects.toThrow();
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
    const { bareRequest, vaultDir } = await bootTestApp();
    await writeFile(path.join(vaultDir, "picture.png"), "not really a png", "utf-8");
    const anonymous = await bareRequest(`${VAULT_ASSET_PATH}?path=picture.png`);
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

    await client.vault.write({ content: "ping", guard: { kind: "overwrite" }, path: "notify.md" });
    const sawVaultChange = frames.some(
      (frame) => vaultChangedMessageSchema.safeParse(JSON.parse(frame)).success,
    );
    expect(sawVaultChange).toBe(true);
  });
});

describe("a starter vault meeting a remote with history", () => {
  it("indexes the notes it took and forgets the starters it gave up", async () => {
    const remote = makeTempDir("inteligir-routes-remote-");
    await runGit(remote, ["init", "--bare", "-b", "main"], { env: hermeticGitEnv() });
    const other = await bootTestApp({ remote: () => ({ source: "explicit", url: remote }) });
    await other.client.vault.write({
      content: "# Field notes\n\nA quokka sighting.\n",
      guard: { kind: "overwrite" },
      path: "field-notes.md",
    });
    expect(await other.client.vault.syncNow()).toMatchObject({ state: "clean" });

    let signedIn = false;
    const { client } = await bootTestApp({
      remote: () => (signedIn ? { source: "explicit", url: remote } : null),
      seedsStarters: true,
    });
    const paths = async (q: string): Promise<string[]> => {
      const { results } = knowledgeSearchResponseSchema.parse(await client.knowledge.search({ q }));
      return results.map((result) => result.path).toSorted();
    };
    expect(await paths("door")).toEqual(["Kitchen Sink.md", "Welcome.md"]);
    expect(await paths("quokka")).toEqual([]);

    signedIn = true;
    expect(await client.vault.syncNow()).toMatchObject({ conflicts: [], state: "clean" });
    expect(await paths("quokka")).toEqual(["field-notes.md"]);
    expect(await paths("door")).toEqual([]);
  });
});

describe("a note's comment store goes with the note", () => {
  const NOTE_ID = "0f6a3b1e-5c2d-4e8f-9a7b-1c3d5e7f9a0b";
  const STORE = `.inteligir/comments/${NOTE_ID}.json`;
  const NOTE = `---\nid: ${NOTE_ID}\n---\n%%i:c1:start%%x%%i:c1:end%%\n`;

  it("is removed with the note, and the deleted-notes restore brings both back", async () => {
    const { client, vault } = await bootTestApp();
    await client.vault.write({
      content: NOTE,
      guard: { kind: "overwrite" },
      path: "notes/keep.md",
    });
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
    await client.vault.write({
      content: note.content,
      guard: { kind: "absent" },
      path: "notes/keep.md",
    });
    expect(await restoreCommentStore(client, note.content, sha)).toEqual({ kind: "restored" });

    const listed = await client.comments.list({ path: "notes/keep.md" });
    expect(listed.threads.map((thread) => thread.rootId)).toEqual(["c1"]);

    // the server's own refusals are the ones the composition reads as "kept" and "none".
    expect(await restoreCommentStore(client, note.content, sha)).toEqual({ kind: "kept" });
    const otherNote = note.content.replace(NOTE_ID, "never-commented");
    expect(await restoreCommentStore(client, otherNote, sha)).toEqual({ kind: "none" });
  });

  it("stays while a copy still carries the id", async () => {
    const { client } = await bootTestApp();
    await client.vault.write({
      content: NOTE,
      guard: { kind: "overwrite" },
      path: "notes/keep.md",
    });
    await client.comments.add({ id: "c1", path: "notes/keep.md", text: "kept" });
    await client.vault.write({
      content: NOTE,
      guard: { kind: "overwrite" },
      path: "notes/keep copy.md",
    });

    await client.vault.remove({ path: "notes/keep copy.md" });

    const listed = await client.comments.list({ path: "notes/keep.md" });
    expect(listed.threads.map((thread) => thread.rootId)).toEqual(["c1"]);
  });

  it("is copied for a copy given its own id, so the two notes' threads diverge", async () => {
    const { client } = await bootTestApp();
    await client.vault.write({
      content: NOTE,
      guard: { kind: "overwrite" },
      path: "notes/keep.md",
    });
    await client.comments.add({ id: "c1", path: "notes/keep.md", text: "kept" });
    await client.vault.write({
      content: NOTE,
      guard: { kind: "absent" },
      path: "notes/keep copy.md",
    });

    const given = await giveNoteOwnId(client, "notes/keep copy.md", NOTE_ID);
    if (given.kind !== "done") {
      throw new Error(`expected done, got ${given.kind}`);
    }
    expect(given.comments).toBe("copied");
    const copy = await client.vault.read({ path: "notes/keep copy.md" });
    expect(copy.content).toBe(NOTE.replace(NOTE_ID, given.id));
    const copiedStore = await client.vault.read({ path: `.inteligir/comments/${given.id}.json` });
    const sharedStore = await client.vault.read({ path: STORE });
    expect(copiedStore.content).toBe(sharedStore.content);

    await client.comments.add({ id: "c2", path: "notes/keep copy.md", text: "only the copy" });
    await client.vault.remove({ path: "notes/keep.md" });
    const [gone] = await safe(client.vault.read({ path: STORE }));
    expect(isDefinedError(gone) && gone.code).toBe("NOT_FOUND");
    const listed = await client.comments.list({ path: "notes/keep copy.md" });
    expect(listed.threads.map((thread) => thread.rootId).toSorted()).toEqual(["c1", "c2"]);
  });

  it("goes for every note under a removed folder, and a note without an id has none to remove", async () => {
    const { client } = await bootTestApp();
    await client.vault.write({ content: NOTE, guard: { kind: "overwrite" }, path: "box/a.md" });
    await client.comments.add({ id: "c1", path: "box/a.md", text: "a" });
    await client.vault.write({
      content: "no id\n",
      guard: { kind: "overwrite" },
      path: "box/plain.md",
    });

    await client.vault.remove({ path: "box" });

    const [gone] = await safe(client.vault.read({ path: STORE }));
    expect(isDefinedError(gone) && gone.code).toBe("NOT_FOUND");
    const tree = await client.vault.tree();
    expect(tree.entries.some((row) => row.path.startsWith("box"))).toBe(false);
  });

  it("never lets a doc past the read cap refuse the delete, alone or inside a folder", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    onTestFinished(() => {
      warn.mockRestore();
    });
    const { client, vaultDir } = await bootTestApp();
    const oversized = "x".repeat(VAULT_MAX_CONTENT_LENGTH + 1);
    await writeFile(path.join(vaultDir, "huge.txt"), oversized);

    expect(await client.vault.remove({ path: "huge.txt" })).toEqual({ ok: true });

    await client.vault.write({ content: NOTE, guard: { kind: "overwrite" }, path: "box/a.md" });
    await client.comments.add({ id: "c1", path: "box/a.md", text: "a" });
    await writeFile(path.join(vaultDir, "box", "huge.txt"), oversized);

    expect(await client.vault.remove({ path: "box" })).toEqual({ ok: true });

    const [gone] = await safe(client.vault.read({ path: STORE }));
    expect(isDefinedError(gone) && gone.code).toBe("NOT_FOUND");
    const tree = await client.vault.tree();
    expect(tree.entries.some((row) => row.path.startsWith("box"))).toBe(false);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("box/huge.txt"));
  });
});

describe("the comments routes", () => {
  it("answers a legacy fold that would replace a non-text id with the declared BAD_REQUEST", async () => {
    const { client, vaultDir } = await bootTestApp();
    await writeFile(path.join(vaultDir, "plan.md"), "---\nid: 42\n---\nnote\n");
    await writeFile(
      path.join(vaultDir, legacyCommentsSidecarPath("plan.md")),
      '{\n  "c1": { "text": "kept", "createdAt": 1, "updatedAt": 1 }\n}\n',
    );

    const [refused] = await safe(client.comments.list({ path: "plan.md" }));

    expect(isDefinedError(refused) && refused.code).toBe("BAD_REQUEST");
  });
});
