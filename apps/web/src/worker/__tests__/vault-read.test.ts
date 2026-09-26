import {
  VAULT_API_PATHS,
  VAULT_ASSET_MAX_BYTES,
  VAULT_FILE_MAX_BYTES,
  VAULT_FILES_MAX_PATHS,
  VAULT_FILES_MAX_RESPONSE_BYTES,
  vaultFileResponseSchema,
  vaultFilesResponseSchema,
  vaultTreeResponseSchema,
} from "@repo/api/cloud/vault/vault-schema";
import { cloudErrorSchema } from "@repo/api/cloud/errors";
import { SELF } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { vaultRepoName } from "../vault/git-remote";
import { treeListingPrefix, treeListingSlot } from "../vault/tree-listing";
import {
  deviceHeaders,
  emitted,
  ORIGIN,
  loginDevice,
  postVaultRead,
  signUpUser,
  userIdOf,
} from "./cloud-helpers";
import type { VaultReadBody } from "./cloud-helpers";
import { pushVaultFiles, ZERO_OID } from "./git-pack";

const TREE = `${ORIGIN}${VAULT_API_PATHS.tree}`;
const FILES = `${ORIGIN}${VAULT_API_PATHS.files}`;

const errorCode = async (response: Response): Promise<string> =>
  emitted(cloudErrorSchema, await response.text()).error.code;

const readTree = async (credential: string, query: VaultReadBody): Promise<Response> =>
  await postVaultRead(VAULT_API_PATHS.tree, deviceHeaders(credential), query);

const readFile = async (credential: string, query: VaultReadBody): Promise<Response> =>
  await postVaultRead(VAULT_API_PATHS.file, deviceHeaders(credential), query);

const readAsset = async (credential: string, query: VaultReadBody): Promise<Response> =>
  await postVaultRead(VAULT_API_PATHS.asset, deviceHeaders(credential), query);

// the form installs before the body form send, which the Worker answers for as long as one exists
const getRead = async (
  path: string,
  credential: string,
  query: Record<string, string>,
): Promise<Response> =>
  await SELF.fetch(`${ORIGIN}${path}?${new URLSearchParams(query).toString()}`, {
    headers: deviceHeaders(credential),
  });

const loginAndPush = async (email: string, files: Parameters<typeof pushVaultFiles>[2]) => {
  const { bearer } = await signUpUser(email);
  const { credential } = await loginDevice(bearer, "Laptop");
  const pushed = await pushVaultFiles(credential, "vault: initialize", files, ZERO_OID);
  expect(pushed.response.status).toBe(200);
  expect(await pushed.response.text()).toContain("unpack ok");
  return { bearer, commit: pushed.commit, credential };
};

// the phone's paging: the first page resolves the head, every later one pins what it answered.
const pageWholeTree = async (credential: string, limit: number, ref?: string) => {
  const paths: string[] = [];
  const commits = new Set<string>();
  let pinned = ref;
  let after: string | undefined;
  do {
    const response = await readTree(credential, { after, limit, ref: pinned });
    expect(response.status).toBe(200);
    const page = emitted(vaultTreeResponseSchema, await response.text());
    commits.add(page.commit);
    paths.push(...page.entries.map((entry) => entry.path));
    pinned = page.commit;
    after = page.next ?? undefined;
  } while (after !== undefined);
  return { commits: [...commits], paths };
};

const MANY_FOLDERS = [
  "a.md",
  "inbox/today.md",
  "notes/b.md",
  "notes/deep/c.md",
  "notes/deep/d.md",
  "notes/deep/deeper/e.md",
  "projects/f.md",
  "projects/x/g.md",
  "z.md",
];

describe("vault read rows", () => {
  it("refuses the wire without a credential", async () => {
    const tree = await postVaultRead(VAULT_API_PATHS.tree, {}, {});
    expect(tree.status).toBe(401);
    expect(await errorCode(tree)).toBe("unauthorized");
  });

  it("answers not-found for an account with no hosted vault — without creating one", async () => {
    const { bearer } = await signUpUser("vault-read-none@example.test");
    const { credential } = await loginDevice(bearer, "Laptop");
    const tree = await readTree(credential, {});
    expect(tree.status).toBe(404);
    expect(await errorCode(tree)).toBe("not-found");
  });

  it("lists the pushed tree flat, and pages it by path cursor at one commit", async () => {
    const { credential, commit } = await loginAndPush("vault-read-tree@example.test", [
      { content: "# a\n", path: "a.md" },
      { content: "# b\n", path: "notes/b.md" },
      { content: "# c\n", path: "notes/deep/c.md" },
    ]);

    const first = await readTree(credential, { limit: 2 });
    expect(first.status).toBe(200);
    const pageOne = emitted(vaultTreeResponseSchema, await first.text());
    expect(pageOne.commit).toBe(commit);
    expect(pageOne.entries.map((entry) => entry.path)).toEqual(["a.md", "notes/b.md"]);
    expect(pageOne.next).toBe("notes/b.md");

    const second = await readTree(credential, {
      after: pageOne.next ?? undefined,
      limit: 2,
      ref: pageOne.commit,
    });
    const pageTwo = emitted(vaultTreeResponseSchema, await second.text());
    expect(pageTwo.commit).toBe(commit);
    expect(pageTwo.entries.map((entry) => entry.path)).toEqual(["notes/deep/c.md"]);
    expect(pageTwo.next).toBeNull();
  });

  it("keeps the head's listing once, and pages a many-folder vault from it", async () => {
    const { bearer, commit, credential } = await loginAndPush(
      "vault-read-kept@example.test",
      MANY_FOLDERS.map((path) => ({ content: `# ${path}\n`, path })),
    );
    const slot = treeListingSlot(env.PACK_CACHE, vaultRepoName(await userIdOf(bearer)));

    expect(await pageWholeTree(credential, 1)).toEqual({ commits: [commit], paths: MANY_FOLDERS });
    const kept = await slot.read(commit);
    expect(kept?.map((entry) => entry.path)).toEqual(MANY_FOLDERS);

    // what the slot holds is what a pinned page answers, which is how a page skips the walk
    await slot.write(commit, [{ oid: "d".repeat(40), path: "only-in-the-slot.md", size: 1 }]);
    const pinned = await readTree(credential, { ref: commit });
    expect(
      emitted(vaultTreeResponseSchema, await pinned.text()).entries.map((entry) => entry.path),
    ).toEqual(["only-in-the-slot.md"]);
  });

  it("walks a pinned page the slot does not hold, and leaves the slot to the newer head", async () => {
    const { bearer, commit, credential } = await loginAndPush(
      "vault-read-walked@example.test",
      MANY_FOLDERS.map((path) => ({ content: `# ${path}\n`, path })),
    );
    const slot = treeListingSlot(env.PACK_CACHE, vaultRepoName(await userIdOf(bearer)));
    const newerHead = "b".repeat(40);
    await slot.write(newerHead, []);

    expect(await pageWholeTree(credential, 1, commit)).toEqual({
      commits: [commit],
      paths: MANY_FOLDERS,
    });
    expect(await slot.read(newerHead)).toEqual([]);
    expect(await slot.read(commit)).toBeNull();
  });

  it("walks again over a listing kept in an older shape, and keeps it with oids", async () => {
    const { bearer, commit, credential } = await loginAndPush("vault-read-old-slot@example.test", [
      { content: "# a\n", path: "a.md" },
    ]);
    const repo = vaultRepoName(await userIdOf(bearer));
    const slot = treeListingSlot(env.PACK_CACHE, repo);
    const filled = await readTree(credential, {});
    expect(filled.status).toBe(200);
    const kept = await env.PACK_CACHE.list({ prefix: treeListingPrefix(repo) });
    expect(kept.objects).toHaveLength(1);
    for (const object of kept.objects) {
      await env.PACK_CACHE.put(object.key, JSON.stringify([{ path: "a.md", size: 4 }]), {
        customMetadata: { commit },
      });
    }
    expect(await slot.read(commit)).toBeNull();

    const tree = await readTree(credential, {});
    const { entries } = emitted(vaultTreeResponseSchema, await tree.text());
    expect(entries).toEqual([
      { oid: expect.stringMatching(/^[0-9a-f]{40}$/u), path: "a.md", size: 4 },
    ]);
    expect(await slot.read(commit)).toEqual(entries);
  });

  it("omits an entry the contract's path grammar refuses, rather than failing the page", async () => {
    // git accepts these names; the wire's parse does not, so listing them would hand the phone a 200 it refuses whole
    const { credential } = await loginAndPush("vault-read-grammar@example.test", [
      { content: "# a\n", path: "a.md" },
      { content: "# backslash\n", path: "a\\b.md" },
      { content: "# under a refused directory\n", path: "2024\\q1/c.md" },
    ]);
    const tree = await readTree(credential, {});
    expect(tree.status).toBe(200);
    expect(
      emitted(vaultTreeResponseSchema, await tree.text()).entries.map((entry) => entry.path),
    ).toEqual(["a.md"]);
  });

  it("answers a file's text with the commit and blob oid", async () => {
    const { credential, commit } = await loginAndPush("vault-read-file@example.test", [
      { content: "# hello\n\nfrom the vault\n", path: "notes/hello.md" },
    ]);
    const response = await readFile(credential, { path: "notes/hello.md" });
    expect(response.status).toBe(200);
    const file = emitted(vaultFileResponseSchema, await response.text());
    expect(file.commit).toBe(commit);
    expect(file.path).toBe("notes/hello.md");
    expect(file.content).toBe("# hello\n\nfrom the vault\n");
    expect(file.oid).toMatch(/^[0-9a-f]{40}$/u);
  });

  it("lists each file under the oid the file route answers for it at that commit", async () => {
    const { credential, commit } = await loginAndPush("vault-read-oid@example.test", [
      { content: "# a\n", path: "a.md" },
      { content: "# b\n", path: "notes/b.md" },
    ]);
    const tree = await readTree(credential, { ref: commit });
    const { entries } = emitted(vaultTreeResponseSchema, await tree.text());
    expect(entries.map((entry) => entry.path)).toEqual(["a.md", "notes/b.md"]);
    for (const entry of entries) {
      const response = await readFile(credential, { path: entry.path, ref: commit });
      expect(emitted(vaultFileResponseSchema, await response.text()).oid).toBe(entry.oid);
    }
    expect(entries[0]?.oid).not.toBe(entries[1]?.oid);
  });

  it("serves a filename holding a percent sign — git allows it, the cell decodes", async () => {
    const { credential } = await loginAndPush("vault-read-percent@example.test", [
      { content: "# done\n", path: "100%done.md" },
    ]);
    const response = await readFile(credential, { path: "100%done.md" });
    expect(response.status).toBe(200);
    expect(emitted(vaultFileResponseSchema, await response.text()).content).toBe("# done\n");
    const tree = await readTree(credential, {});
    expect(
      emitted(vaultTreeResponseSchema, await tree.text()).entries.map((entry) => entry.path),
    ).toContain("100%done.md");
  });

  it("answers not-found for a path the revision does not carry", async () => {
    const { credential } = await loginAndPush("vault-read-miss@example.test", [
      { content: "# a\n", path: "a.md" },
    ]);
    const response = await readFile(credential, { path: "gone.md" });
    expect(response.status).toBe(404);
    expect(await errorCode(response)).toBe("not-found");
  });

  it("keeps the wire text-only: binary refuses, and so does the byte ceiling", async () => {
    const invalidUtf8 = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0xff, 0xfe]);
    const huge = new Uint8Array(VAULT_FILE_MAX_BYTES + 1).fill(0x61);
    const { credential } = await loginAndPush("vault-read-binary@example.test", [
      { content: invalidUtf8, path: "image.png" },
      { content: huge, path: "huge.md" },
    ]);

    const binary = await readFile(credential, { path: "image.png" });
    expect(binary.status).toBe(400);
    expect(await errorCode(binary)).toBe("bad-request");

    const oversize = await readFile(credential, { path: "huge.md" });
    expect(oversize.status).toBe(413);
    expect(await errorCode(oversize)).toBe("file-too-large");
  });

  it("keeps two users' vaults apart on the read wire too", async () => {
    const alpha = await loginAndPush("vault-read-alpha@example.test", [
      { content: "alpha's note\n", path: "secret.md" },
    ]);
    const beta = await signUpUser("vault-read-beta@example.test");
    const betaDevice = await loginDevice(beta.bearer, "Laptop");

    const asBeta = await readFile(betaDevice.credential, { path: "secret.md", ref: alpha.commit });
    expect(asBeta.status).toBe(404);
  });

  it("refuses a malformed path, a stray field or a body that is no JSON at parse", async () => {
    const { credential } = await loginAndPush("vault-read-path@example.test", [
      { content: "# a\n", path: "a.md" },
    ]);
    for (const query of [
      { path: "../escape.md" },
      { path: "/rooted.md" },
      { path: "a//b.md" },
      { extra: true, path: "a.md" },
    ]) {
      const response = await readFile(credential, query);
      expect(response.status, JSON.stringify(query)).toBe(400);
      expect(await errorCode(response)).toBe("bad-request");
    }
    const notJson = await SELF.fetch(`${ORIGIN}${VAULT_API_PATHS.file}`, {
      body: "path=a.md",
      headers: { ...deviceHeaders(credential), "content-type": "application/json" },
      method: "POST",
    });
    expect(notJson.status).toBe(400);
    expect(await errorCode(notJson)).toBe("bad-request");
  });
});

const postFiles = async (auth: Record<string, string>, body: VaultReadBody): Promise<Response> =>
  await postVaultRead(VAULT_API_PATHS.files, auth, body);

const readBatch = async (response: Response) =>
  emitted(vaultFilesResponseSchema, await response.text());

describe("the vault batch route", () => {
  it("answers each path's text and oid, and names what it could not answer", async () => {
    const invalidUtf8 = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0xff, 0xfe]);
    const huge = new Uint8Array(VAULT_FILE_MAX_BYTES + 1).fill(0x61);
    const { credential, commit } = await loginAndPush("vault-batch-read@example.test", [
      { content: "# a\n", path: "a.md" },
      { content: "# b\n", path: "notes/b.md" },
      { content: invalidUtf8, path: "image.png" },
      { content: huge, path: "huge.md" },
    ]);
    const response = await postFiles(deviceHeaders(credential), {
      paths: ["notes/b.md", "gone.md", "image.png", "huge.md", "a.md"],
      ref: commit,
    });
    expect(response.status).toBe(200);
    const batch = await readBatch(response);

    const tree = await readTree(credential, { ref: commit });
    const oids = new Map(
      emitted(vaultTreeResponseSchema, await tree.text()).entries.map((entry) => [
        entry.path,
        entry.oid,
      ]),
    );
    expect(batch).toEqual({
      commit,
      deferred: [],
      files: [
        { content: "# b\n", oid: oids.get("notes/b.md"), path: "notes/b.md" },
        { content: "# a\n", oid: oids.get("a.md"), path: "a.md" },
      ],
      missing: ["gone.md"],
      refused: [
        { code: "not-text", path: "image.png" },
        { code: "file-too-large", path: "huge.md" },
      ],
    });
  });

  it("defers what passes the byte budget, and a follow-up completes the set", async () => {
    const third = Math.floor(VAULT_FILES_MAX_RESPONSE_BYTES / 3) + 1;
    const bodyOf = (fill: string): string => fill.repeat(third);
    const { credential, commit } = await loginAndPush("vault-batch-budget@example.test", [
      { content: bodyOf("a"), path: "a.md" },
      { content: bodyOf("b"), path: "b.md" },
      { content: bodyOf("c"), path: "c.md" },
    ]);
    const auth = deviceHeaders(credential);
    const first = await readBatch(
      await postFiles(auth, { paths: ["a.md", "b.md", "c.md", "gone.md"], ref: commit }),
    );
    expect(first.files.map((file) => file.path)).toEqual(["a.md", "b.md"]);
    expect(first.deferred).toEqual(["c.md", "gone.md"]);
    expect(first.missing).toEqual([]);

    const rest = await readBatch(await postFiles(auth, { paths: first.deferred, ref: commit }));
    expect(rest.files.map((file) => [file.path, file.content])).toEqual([["c.md", bodyOf("c")]]);
    expect(rest.missing).toEqual(["gone.md"]);
    expect(rest.deferred).toEqual([]);
  });

  it("refuses a batch it cannot read as one: too many paths, a repeat, no ref, or a GET", async () => {
    const { credential, commit } = await loginAndPush("vault-batch-shape@example.test", [
      { content: "# a\n", path: "a.md" },
    ]);
    const tooMany = Array.from({ length: VAULT_FILES_MAX_PATHS + 1 }, (_, index) => `n${index}.md`);
    for (const body of [
      { paths: tooMany, ref: commit },
      { paths: [], ref: commit },
      { paths: ["a.md", "a.md"], ref: commit },
      { paths: ["a.md"] },
      { paths: ["../escape.md"], ref: commit },
      { extra: true, paths: ["a.md"], ref: commit },
    ]) {
      const response = await postFiles(deviceHeaders(credential), body);
      expect(response.status, JSON.stringify(body).slice(0, 80)).toBe(400);
      expect(await errorCode(response)).toBe("bad-request");
    }
    const get = await SELF.fetch(`${FILES}?ref=${commit}`, { headers: deviceHeaders(credential) });
    expect(get.status).toBe(400);
    expect(await errorCode(get)).toBe("bad-request");
  });

  it("answers not-found for a revision the vault does not hold, rather than every path missing", async () => {
    const { credential } = await loginAndPush("vault-batch-ref@example.test", [
      { content: "# a\n", path: "a.md" },
    ]);
    const response = await postFiles(deviceHeaders(credential), {
      paths: ["a.md"],
      ref: "b".repeat(40),
    });
    expect(response.status).toBe(404);
    expect(await errorCode(response)).toBe("not-found");
  });

  it("refuses the wire without a credential", async () => {
    const response = await postFiles({}, { paths: ["a.md"], ref: "c".repeat(40) });
    expect(response.status).toBe(401);
    expect(await errorCode(response)).toBe("unauthorized");
  });

  it("keeps two users' vaults apart on the batch wire too", async () => {
    const alpha = await loginAndPush("vault-batch-alpha@example.test", [
      { content: "alpha's note\n", path: "secret.md" },
    ]);
    const beta = await signUpUser("vault-batch-beta@example.test");
    const betaDevice = await loginDevice(beta.bearer, "Phone");
    const asBeta = await postFiles(deviceHeaders(betaDevice.credential), {
      paths: ["secret.md"],
      ref: alpha.commit,
    });
    expect(asBeta.status).toBe(404);
  });
});

const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0xff]);

describe("the vault asset route", () => {
  it("answers an image embed's raw bytes with the allowlist's type", async () => {
    const { credential, commit } = await loginAndPush("vault-asset-read@example.test", [
      { content: PNG_BYTES, path: "media/diagram.png" },
    ]);
    const response = await readAsset(credential, { path: "media/diagram.png", ref: commit });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("content-security-policy")).toBe("default-src 'none'; sandbox");
    expect(response.headers.get("cache-control")).toBe("private, max-age=31536000, immutable");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(PNG_BYTES);
  });

  it("refuses the wire without a credential", async () => {
    const response = await postVaultRead(
      VAULT_API_PATHS.asset,
      {},
      { path: "a.png", ref: "c".repeat(40) },
    );
    expect(response.status).toBe(401);
    expect(await errorCode(response)).toBe("unauthorized");
  });

  it("requires the pinning ref — an unpinned read names no immutable bytes", async () => {
    const { credential } = await loginAndPush("vault-asset-ref@example.test", [
      { content: PNG_BYTES, path: "a.png" },
    ]);
    const response = await readAsset(credential, { path: "a.png" });
    expect(response.status).toBe(400);
    expect(await errorCode(response)).toBe("bad-request");
  });

  it("refuses an extension outside the allowlist — never a fallback type", async () => {
    const { credential, commit } = await loginAndPush("vault-asset-ext@example.test", [
      { content: "# text\n", path: "notes.md" },
    ]);
    for (const path of ["notes.md", "script.html", "no-extension"]) {
      const response = await readAsset(credential, { path, ref: commit });
      expect(response.status).toBe(400);
      expect(await errorCode(response)).toBe("bad-request");
    }
  });

  it("answers not-found for a path the revision does not carry", async () => {
    const { credential, commit } = await loginAndPush("vault-asset-miss@example.test", [
      { content: PNG_BYTES, path: "a.png" },
    ]);
    const response = await readAsset(credential, { path: "gone.png", ref: commit });
    expect(response.status).toBe(404);
    expect(await errorCode(response)).toBe("not-found");
  });

  it("refuses bytes over the asset ceiling", async () => {
    const huge = new Uint8Array(VAULT_ASSET_MAX_BYTES + 1).fill(0x61);
    const { credential, commit } = await loginAndPush("vault-asset-huge@example.test", [
      { content: huge, path: "huge.png" },
    ]);
    const response = await readAsset(credential, { path: "huge.png", ref: commit });
    expect(response.status).toBe(413);
    expect(await errorCode(response)).toBe("file-too-large");
  });

  it("keeps two users' vaults apart on the asset wire too", async () => {
    const alpha = await loginAndPush("vault-asset-alpha@example.test", [
      { content: PNG_BYTES, path: "secret.png" },
    ]);
    const beta = await signUpUser("vault-asset-beta@example.test");
    const betaDevice = await loginDevice(beta.bearer, "Laptop");
    const asBeta = await readAsset(betaDevice.credential, {
      path: "secret.png",
      ref: alpha.commit,
    });
    expect(asBeta.status).toBe(404);
  });
});

describe("the GET form a stale install still sends", () => {
  it("answers the tree, a file and an asset from the URL's query exactly as from the body", async () => {
    const { credential, commit } = await loginAndPush("vault-read-stale@example.test", [
      { content: "# a\n", path: "a.md" },
      { content: PNG_BYTES, path: "media/α β.png" },
      { content: "# b\n", path: "notes/b c.md" },
    ]);

    const pageOne = await getRead(VAULT_API_PATHS.tree, credential, { limit: "2" });
    expect(pageOne.status).toBe(200);
    const listed = emitted(vaultTreeResponseSchema, await pageOne.text());
    const posted = await readTree(credential, { limit: 2 });
    expect(listed).toEqual(emitted(vaultTreeResponseSchema, await posted.text()));
    expect(listed.next).toBe("media/α β.png");
    const pageTwo = await getRead(VAULT_API_PATHS.tree, credential, {
      after: "media/α β.png",
      limit: "2",
      ref: commit,
    });
    expect(
      emitted(vaultTreeResponseSchema, await pageTwo.text()).entries.map((entry) => entry.path),
    ).toEqual(["notes/b c.md"]);

    const file = await getRead(VAULT_API_PATHS.file, credential, { path: "notes/b c.md" });
    expect(file.status).toBe(200);
    const postedFile = await readFile(credential, { path: "notes/b c.md" });
    expect(emitted(vaultFileResponseSchema, await file.text())).toEqual(
      emitted(vaultFileResponseSchema, await postedFile.text()),
    );

    const asset = await getRead(VAULT_API_PATHS.asset, credential, {
      path: "media/α β.png",
      ref: commit,
    });
    expect(asset.status).toBe(200);
    expect(asset.headers.get("content-type")).toBe("image/png");
    expect(asset.headers.get("cache-control")).toBe("private, max-age=31536000, immutable");
    expect(new Uint8Array(await asset.arrayBuffer())).toEqual(PNG_BYTES);
  });

  it("refuses what the body form refuses: no credential, no vault, a query it cannot read", async () => {
    const anonymous = await SELF.fetch(`${TREE}?limit=1`);
    expect(anonymous.status).toBe(401);
    expect(await errorCode(anonymous)).toBe("unauthorized");

    const { bearer } = await signUpUser("vault-read-stale-none@example.test");
    const { credential } = await loginDevice(bearer, "Phone");
    const noVault = await getRead(VAULT_API_PATHS.tree, credential, {});
    expect(noVault.status).toBe(404);
    expect(await errorCode(noVault)).toBe("not-found");

    const unpinned = await getRead(VAULT_API_PATHS.asset, credential, { path: "a.png" });
    expect(unpinned.status).toBe(400);
    expect(await errorCode(unpinned)).toBe("bad-request");
  });
});
