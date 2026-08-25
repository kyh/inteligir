// The vault API surface over the composed app: contract row → handler →
// service → disk, plus the ws invalidation a mutation must produce.

import { realpathSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { isDefinedError, safe, toORPCError } from "@orpc/client";
import { vaultChangedMessageSchema } from "@repo/api/local/notifications";
import { VAULT_ASSET_PATH, vaultAssetUrl } from "@repo/api/local/routes";
import { VAULT_MAX_CONTENT_LENGTH, contentHashHex } from "@repo/api/local/vault/vault-schema";
import { describe, expect, it } from "vitest";
import { bootTestApp } from "../../__tests__/boot-app";
import { makeTempDir } from "../../__tests__/temp-dir";
import { WsBus, type BusSocket } from "../../ws-bus";
import { createVaultRuntime } from "../vault-runtime";
import { hermeticGitEnv } from "./git-test-env";

describe("the vault routes", () => {
  it("writes through the API onto disk, lists and reads it back", async () => {
    const { client, vaultDir } = await bootTestApp();

    await client.vault.write({ path: "notes/api.md", content: "# via API\n" });
    expect(await readFile(join(vaultDir, "notes", "api.md"), "utf8")).toBe("# via API\n");

    const tree = await client.vault.tree();
    // The service reports its PHYSICAL root (symlinks resolved) — on macOS
    // tmpdir() itself is spelled through /var → /private/var.
    expect(tree.root).toBe(realpathSync(vaultDir));
    expect(tree.entries).toEqual([
      { kind: "dir", path: "notes" },
      { kind: "file", modifiedMs: expect.any(Number), path: "notes/api.md" },
    ]);

    expect(await client.vault.read({ path: "notes/api.md" })).toEqual({
      path: "notes/api.md",
      content: "# via API\n",
    });
  });

  it("answers refusals with their declared classes", async () => {
    const { client } = await bootTestApp();

    const [missError] = await safe(client.vault.read({ path: "nope.md" }));
    expect(isDefinedError(missError) && missError.code).toBe("NOT_FOUND");

    // The path grammar is on the request schema, so a traversal is refused by
    // the validator before a handler can be entered with it.
    const [traversalError] = await safe(client.vault.read({ path: "../escape.md" }));
    expect(toORPCError(traversalError).code).toBe("BAD_REQUEST");

    const [gitReachError] = await safe(
      client.vault.write({ path: ".git/config", content: "evil" }),
    );
    expect(toORPCError(gitReachError).code).toBe("BAD_REQUEST");

    await client.vault.write({ path: "a.md", content: "a" });
    await client.vault.write({ path: "b.md", content: "b" });
    const [clobberError] = await safe(client.vault.rename({ from: "a.md", to: "b.md" }));
    expect(isDefinedError(clobberError) && clobberError.code).toBe("CONFLICT");

    const [removeMissError] = await safe(client.vault.remove({ path: "ghost.md" }));
    expect(isDefinedError(removeMissError) && removeMissError.code).toBe("NOT_FOUND");

    const [oversizedError] = await safe(
      client.vault.write({ path: "big.md", content: "x".repeat(VAULT_MAX_CONTENT_LENGTH + 1) }),
    );
    expect(toORPCError(oversizedError).code).toBe("BAD_REQUEST");
  });

  it("refuses a vault nested in the data dir at composition time", async () => {
    const instanceDir = makeTempDir("inteligir-vault-routes-");
    await expect(
      createVaultRuntime({
        vaultDir: join(instanceDir, "vault"),
        vaultRemote: null,
        dataDir: instanceDir,
        notifier: new WsBus(),
        watch: false,
        syncIntervalMs: null,
        gitEnv: hermeticGitEnv(),
      }),
    ).rejects.toThrow(/must be disjoint/);
  });

  it("renames and deletes through the API", async () => {
    const { client } = await bootTestApp();
    await client.vault.write({ path: "old.md", content: "x" });

    expect(await client.vault.rename({ from: "old.md", to: "nested/new.md" })).toEqual({
      path: "nested/new.md",
      rewritten: [],
      skipped: [],
    });

    expect(await client.vault.remove({ path: "nested/new.md" })).toEqual({ ok: true });
  });

  it("applies a compare-and-swap write whose hash matches, refuses a stale one with current", async () => {
    const { client } = await bootTestApp();
    await client.vault.write({ path: "cas.md", content: "v1" });
    const v1Hash = await contentHashHex("v1");

    expect(
      await client.vault.write({ path: "cas.md", content: "v2", expectedHash: v1Hash }),
    ).toEqual({ path: "cas.md" });

    const [staleError] = await safe(
      client.vault.write({ path: "cas.md", content: "v3", expectedHash: v1Hash }),
    );
    expect(isDefinedError(staleError) && staleError.code).toBe("CAS_MISMATCH");
    // The refusal carries what the file holds now, which is what the client
    // merges (diff3) and retries against.
    expect(
      isDefinedError(staleError) && staleError.code === "CAS_MISMATCH" && staleError.data,
    ).toEqual({ current: { content: "v2", hash: await contentHashHex("v2") } });

    const [ghostError] = await safe(
      client.vault.write({ path: "ghost.md", content: "x", expectedHash: v1Hash }),
    );
    expect(isDefinedError(ghostError) && ghostError.code).toBe("CAS_MISMATCH");
    // A file that no longer exists has nothing to merge against.
    expect(
      isDefinedError(ghostError) && ghostError.code === "CAS_MISMATCH" && ghostError.data,
    ).toEqual({});
  });

  it("honors create-exclusive writes and refuses both guards together", async () => {
    const { client } = await bootTestApp();
    expect(await client.vault.write({ path: "fresh.md", content: "new", ifAbsent: true })).toEqual({
      path: "fresh.md",
    });

    const [existsError] = await safe(
      client.vault.write({ path: "fresh.md", content: "clobber", ifAbsent: true }),
    );
    expect(isDefinedError(existsError) && existsError.code).toBe("ALREADY_EXISTS");

    const [bothError] = await safe(
      client.vault.write({
        path: "fresh.md",
        content: "x",
        ifAbsent: true,
        expectedHash: await contentHashHex("new"),
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

    await client.vault.write({ path: "note.md", content: "x" });
    const [shadowedError] = await safe(client.vault.mkdir({ path: "note.md" }));
    expect(isDefinedError(shadowedError) && shadowedError.code).toBe("CONFLICT");
  });

  it("answers status and sync-now as no-remote when no remote is configured", async () => {
    const { client } = await bootTestApp();

    expect((await client.vault.status()).state).toBe("no-remote");
    expect((await client.vault.syncNow()).state).toBe("no-remote");
  });

  it("serves an image asset with a pinned type, a sandbox CSP and an ETag", async () => {
    const { request, vaultDir } = await bootTestApp();
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"></svg>';
    await writeFile(join(vaultDir, "picture.svg"), svg, "utf8");

    const asset = await request(`${VAULT_ASSET_PATH}?path=picture.svg`);
    expect(asset.status).toBe(200);
    expect(asset.headers.get("content-type")).toBe("image/svg+xml");
    expect(asset.headers.get("x-content-type-options")).toBe("nosniff");
    // Without the sandbox, NAVIGATING to this URL would run the SVG's script
    // on the app's own origin — with a vault a git remote can write into.
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
    await writeFile(join(vaultDir, "page.html"), "<script>alert(1)</script>", "utf8");

    const refused = await request(`${VAULT_ASSET_PATH}?path=page.html`);
    expect(refused.status).toBe(400);
    expect(await refused.text()).toContain("not an image type this vault serves");

    const missing = await request(`${VAULT_ASSET_PATH}?path=absent.png`);
    expect(missing.status).toBe(404);
  });

  it("passes the markdown path VERBATIM to containment — no client-side normalization", async () => {
    // The client sends the raw path (only URL-encoded, `vaultAssetUrl`) and the
    // SERVER decides: a name that needs encoding round-trips to disk, and a
    // traversal is refused by the vault's own containment, not by the builder.
    // This is the narrowing that replaced the old client-side decode/normalize.
    const { request, vaultDir } = await bootTestApp();
    await writeFile(join(vaultDir, "my picture.png"), "png-bytes", "utf8");

    // encodeURIComponent in the builder, decoded back by the handler's
    // searchParams — the two must agree or a spaced name 404s.
    const encoded = vaultAssetUrl("", "my picture.png");
    expect(encoded).toBe(`${VAULT_ASSET_PATH}?path=my%20picture.png`);
    const spaced = await request(encoded);
    expect(spaced.status).toBe(200);

    // A traversal is a .png (media check passes) that containment refuses.
    const traversal = await request(vaultAssetUrl("", "../escape.png"));
    expect(traversal.status).toBe(400);
  });

  it("refuses an asset request that carries no device token", async () => {
    const { composed, vaultDir } = await bootTestApp();
    await writeFile(join(vaultDir, "picture.png"), "not really a png", "utf8");
    // The bytes come from a vault a git remote can write into and are served
    // from this origin, so the asset route is behind the same gate as the rest
    // — a page that guessed the port cannot even learn that a path exists.
    const anonymous = await composed.app.request(`${VAULT_ASSET_PATH}?path=picture.png`);
    expect(anonymous.status).toBe(401);
  });

  it("fans a mutation out to vault subscribers on the ws bus", async () => {
    const { client, bus } = await bootTestApp();
    const frames: string[] = [];
    const socket: BusSocket = {
      close: () => {},
      readyState: 1,
      send: (data) => frames.push(data),
    };
    bus.registerClient(socket);
    bus.subscribe(socket, { kind: "vault" });

    await client.vault.write({ path: "notify.md", content: "ping" });
    const sawVaultChange = frames.some(
      (frame) => vaultChangedMessageSchema.safeParse(JSON.parse(frame)).success,
    );
    expect(sawVaultChange).toBe(true);
  });
});
