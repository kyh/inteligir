import { VAULT_GIT_MAX_PUSH_BYTES } from "@repo/api/cloud/vault/vault-git";
import { VAULT_API_PATHS } from "@repo/api/cloud/vault/vault-schema";
import { runInDurableObject, SELF } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { describe, expect, it, vi } from "vitest";
import { packCachePrefixes, vaultRepoName } from "../vault/git-remote";
import { vaultStorageCap } from "../vault/receive-pack";
import { treeListingPrefix } from "../vault/tree-listing";
import {
  deviceHeaders,
  openSocket,
  ORIGIN,
  loginDevice,
  sessionHeaders,
  signUpUser,
  userIdOf,
} from "./cloud-helpers";
import {
  cloneVault,
  pushNothingDeclaring,
  pushVaultFiles,
  randomBytes,
  ZERO_OID,
} from "./git-pack";

const REMOTE = `${ORIGIN}/v1/git/vault.git`;

describe("vault git remote auth", () => {
  it("refuses the wire without a credential, with the Basic challenge", async () => {
    const response = await SELF.fetch(`${REMOTE}/info/refs?service=git-receive-pack`);
    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toContain("Basic");
  });

  it("refuses an unknown credential on both carriers", async () => {
    const fake = `igd_${"0".repeat(64)}`;
    const bearer = await SELF.fetch(`${REMOTE}/info/refs?service=git-receive-pack`, {
      headers: { authorization: `Bearer ${fake}` },
    });
    expect(bearer.status).toBe(401);
    const basic = await SELF.fetch(`${REMOTE}/info/refs?service=git-receive-pack`, {
      headers: { authorization: `Basic ${btoa(`x:${fake}`)}` },
    });
    expect(basic.status).toBe(401);
  });

  it("serves the receive-pack advertisement to a Bearer credential", async () => {
    const { bearer } = await signUpUser("vault-git-bearer@example.test");
    const { credential } = await loginDevice(bearer, "Laptop");
    const response = await SELF.fetch(`${REMOTE}/info/refs?service=git-receive-pack`, {
      headers: deviceHeaders(credential),
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe(
      "application/x-git-receive-pack-advertisement",
    );
  });

  it("accepts the credential as a Basic password — stock git's carrier", async () => {
    const { bearer } = await signUpUser("vault-git-basic@example.test");
    const { credential } = await loginDevice(bearer, "Laptop");
    const response = await SELF.fetch(`${REMOTE}/info/refs?service=git-receive-pack`, {
      headers: { authorization: `Basic ${btoa(`x:${credential}`)}` },
    });
    expect(response.status).toBe(200);
  });

  it("answers 404 on the fetch leg of a vault never pushed", async () => {
    const { bearer } = await signUpUser("vault-git-empty@example.test");
    const { credential } = await loginDevice(bearer, "Laptop");
    const response = await SELF.fetch(`${REMOTE}/info/refs?service=git-upload-pack`, {
      headers: deviceHeaders(credential),
    });
    expect(response.status).toBe(404);
  });

  it("refuses an upload-pack body that declares no length", async () => {
    const { bearer } = await signUpUser("vault-git-chunked@example.test");
    const { credential } = await loginDevice(bearer, "Laptop");
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("0000"));
        controller.close();
      },
    });
    const response = await SELF.fetch(`${REMOTE}/git-upload-pack`, {
      body,
      headers: {
        ...deviceHeaders(credential),
        "content-type": "application/x-git-upload-pack-request",
      },
      method: "POST",
    });
    expect(response.status).toBe(413);
  });

  it("keeps the JSON API and admin surface off the wire", async () => {
    const { bearer } = await signUpUser("vault-git-surface@example.test");
    const { credential } = await loginDevice(bearer, "Laptop");
    const api = await SELF.fetch(`${REMOTE}/api/refs`, { headers: deviceHeaders(credential) });
    expect(api.status).toBe(404);
    const admin = await SELF.fetch(`${REMOTE}/`, {
      headers: deviceHeaders(credential),
      method: "DELETE",
    });
    expect(admin.status).toBe(404);
  });
});

describe("vault git remote round-trip", () => {
  it("pushes, advertises what was pushed, and pings every device but the pusher", async () => {
    const { bearer } = await signUpUser("vault-git-push@example.test");
    const pusher = await loginDevice(bearer, "Laptop");
    const other = await loginDevice(bearer, "Phone");

    const pusherSocket = await openSocket(pusher.credential, "desktop");
    const otherSocket = await openSocket(other.credential, "desktop");

    const first = await pushVaultFiles(
      pusher.credential,
      "vault: initialize",
      [{ content: "# hello\n", path: "welcome.md" }],
      ZERO_OID,
    );
    expect(first.response.status).toBe(200);
    expect(await first.response.text()).toContain("unpack ok");

    await vi.waitFor(() => {
      expect(otherSocket.frames).toContainEqual({ type: "vault" });
    });
    expect(pusherSocket.frames).not.toContainEqual({ type: "vault" });

    const refs = await SELF.fetch(`${REMOTE}/info/refs?service=git-upload-pack`, {
      headers: deviceHeaders(other.credential),
    });
    expect(refs.status).toBe(200);
    expect(await refs.text()).toContain(first.commit);

    const second = await pushVaultFiles(
      pusher.credential,
      "vault: update welcome.md",
      [{ content: "# hello again\n", path: "welcome.md" }],
      first.commit,
      { parent: first.commit },
    );
    expect(second.response.status).toBe(200);
    expect(await second.response.text()).toContain("unpack ok");
  });

  it("keeps two users' vaults apart — the URL never names a repo", async () => {
    const alpha = await signUpUser("vault-git-alpha@example.test");
    const alphaDevice = await loginDevice(alpha.bearer, "Laptop");
    const beta = await signUpUser("vault-git-beta@example.test");
    const betaDevice = await loginDevice(beta.bearer, "Laptop");

    const pushed = await pushVaultFiles(
      alphaDevice.credential,
      "vault: initialize",
      [{ content: "alpha's note\n", path: "secret.md" }],
      ZERO_OID,
    );
    expect(pushed.response.status).toBe(200);

    const refs = await SELF.fetch(`${REMOTE}/info/refs?service=git-upload-pack`, {
      headers: deviceHeaders(betaDevice.credential),
    });
    expect(refs.status).toBe(404);
  });
});

describe("the push cap", () => {
  it("refuses a push declaring more than the cap with a 413 before reading it, and takes the next push", async () => {
    const { bearer } = await signUpUser("vault-git-cap@example.test");
    const { credential } = await loginDevice(bearer, "Laptop");

    const refused = await pushNothingDeclaring(credential, VAULT_GIT_MAX_PUSH_BYTES + 1);
    expect(refused.status).toBe(413);
    expect(await refused.text()).toContain("MiB limit");
    const refs = await SELF.fetch(`${REMOTE}/info/refs?service=git-upload-pack`, {
      headers: deviceHeaders(credential),
    });
    expect(refs.status).toBe(404);

    const next = await pushVaultFiles(
      credential,
      "vault: initialize",
      [{ content: "# hello\n", path: "welcome.md" }],
      ZERO_OID,
      { length: "undeclared" },
    );
    expect(next.response.status).toBe(200);
    expect(await next.response.text()).toContain("unpack ok");
  });
});

// room for a push's command, pack header, tree, commit and trailer around its file's bytes
const PUSH_OVERHEAD_BYTES = 1024;

const MAX_FILL_ROUNDS = 8;

const storedIn = async (repo: string): Promise<number> => {
  const { storedBytes } = await env.REPO.getByName(repo).usage();
  return storedBytes;
};

const roomIn = async (repo: string): Promise<number> =>
  vaultStorageCap(env) - (await storedIn(repo));

const headOf = async (repo: string): Promise<string | undefined> => {
  const head = await env.REPO.getByName(repo).readCommit();
  return head?.oid;
};

const openVault = async (
  email: string,
): Promise<{ credential: string; repo: string; head: string }> => {
  const { bearer } = await signUpUser(email);
  const { credential } = await loginDevice(bearer, "Laptop");
  const pushed = await pushVaultFiles(
    credential,
    "vault: initialize",
    [{ content: "# hello\n", path: "welcome.md" }],
    ZERO_OID,
  );
  expect(pushed.response.status).toBe(200);
  await pushed.response.arrayBuffer();
  return { credential, head: pushed.commit, repo: vaultRepoName(await userIdOf(bearer)) };
};

// pushes that each fit the room left, until none is: how many that takes is the cell's to say,
// since it keeps a pack in whole pages
const fillVault = async (credential: string, repo: string, head: string): Promise<string> => {
  let tip = head;
  for (let round = 0; round < MAX_FILL_ROUNDS; round += 1) {
    const room = await roomIn(repo);
    if (room <= 0) {
      return tip;
    }
    const pushed = await pushVaultFiles(
      credential,
      `vault: fill ${String(round)}`,
      [{ content: randomBytes(Math.max(1, room - PUSH_OVERHEAD_BYTES)), path: "fill.bin" }],
      tip,
      { parent: tip },
    );
    expect(
      pushed.response.status,
      `fill round ${String(round)}, ${String(room)} bytes of room`,
    ).toBe(200);
    expect(await pushed.response.text()).toContain("ok refs/heads/main");
    tip = pushed.commit;
  }
  throw new Error(`the vault still had room after ${String(MAX_FILL_ROUNDS)} fitting pushes`);
};

describe("the storage cap", () => {
  it("counts what the cell keeps, a streamed pack's R2 bytes and a deleted file's history included", async () => {
    const vault = await openVault("vault-cap-usage@example.test");
    const fresh = await storedIn(vault.repo);

    const declared = await pushVaultFiles(
      vault.credential,
      "vault: add scan.png",
      [{ content: randomBytes(100_000), path: "scan.png" }],
      vault.head,
      { parent: vault.head },
    );
    expect(await declared.response.text()).toContain("ok refs/heads/main");
    const afterDeclared = await storedIn(vault.repo);
    expect(afterDeclared).toBeGreaterThan(fresh);

    const streamed = await pushVaultFiles(
      vault.credential,
      "vault: add photo.png",
      [{ content: randomBytes(100_000), path: "photo.png" }],
      declared.commit,
      { length: "undeclared", parent: declared.commit },
    );
    expect(await streamed.response.text()).toContain("ok refs/heads/main");
    const afterStreamed = await storedIn(vault.repo);
    expect(afterStreamed - afterDeclared).toBeGreaterThanOrEqual(100_000);

    const deleted = await pushVaultFiles(
      vault.credential,
      "vault: delete both",
      [{ content: "# hello\n", path: "welcome.md" }],
      streamed.commit,
      { parent: streamed.commit },
    );
    expect(await deleted.response.text()).toContain("ok refs/heads/main");
    expect(await storedIn(vault.repo)).toBeGreaterThanOrEqual(afterStreamed);
  });

  it("refuses a push past the room left with a 507, declared or streamed, and moves no ref", async () => {
    const vault = await openVault("vault-cap-crossing@example.test");
    const room = await roomIn(vault.repo);
    expect(room).toBeGreaterThan(0);

    for (const length of ["declared", "undeclared"] as const) {
      const crossing = await pushVaultFiles(
        vault.credential,
        "vault: add scan.png",
        [{ content: randomBytes(room + PUSH_OVERHEAD_BYTES), path: "scan.png" }],
        vault.head,
        { length, parent: vault.head },
      );
      expect(crossing.response.status, length).toBe(507);
      expect(await crossing.response.text(), length).toContain("full");
      expect(await headOf(vault.repo), length).toBe(vault.head);
    }

    const fitting = await pushVaultFiles(
      vault.credential,
      "vault: add note.md",
      [{ content: "# still room\n", path: "note.md" }],
      vault.head,
      { parent: vault.head },
    );
    expect(await fitting.response.text()).toContain("ok refs/heads/main");
  });

  it("once full, refuses a push with a 507 before reading it, and still serves every read", async () => {
    const vault = await openVault("vault-cap-full@example.test");
    const tip = await fillVault(vault.credential, vault.repo, vault.head);

    const refused = await pushNothingDeclaring(vault.credential, 1024);
    expect(refused.status).toBe(507);
    expect(await headOf(vault.repo)).toBe(tip);

    const advertised = await SELF.fetch(`${REMOTE}/info/refs?service=git-receive-pack`, {
      headers: deviceHeaders(vault.credential),
    });
    expect(advertised.status).toBe(200);
    await advertised.arrayBuffer();
    const cloned = await cloneVault(vault.credential, tip);
    expect(cloned.status).toBe(200);
    await cloned.arrayBuffer();
  });
});

describe("account deletion's vault half", () => {
  it("wipes the repo cell, its R2 bytes and the registry row with the account", async () => {
    const { bearer, password } = await signUpUser("vault-git-delete@example.test");
    const { credential } = await loginDevice(bearer, "Laptop");
    const pushed = await pushVaultFiles(
      credential,
      "vault: initialize",
      [{ content: "note bytes the deletion promise covers\n", path: "secret.md" }],
      ZERO_OID,
      { length: "undeclared" },
    );
    expect(pushed.response.status).toBe(200);
    expect(await pushed.response.text()).toContain("unpack ok");
    const cloned = await cloneVault(credential, pushed.commit);
    expect(cloned.status).toBe(200);
    await cloned.arrayBuffer();
    const userId = await userIdOf(bearer);
    const repo = vaultRepoName(userId);

    const listingPrefix = treeListingPrefix(repo);
    const listed = await SELF.fetch(`${ORIGIN}${VAULT_API_PATHS.tree}`, {
      headers: deviceHeaders(credential),
    });
    expect(listed.status).toBe(200);
    const kept = await env.PACK_CACHE.list({ prefix: listingPrefix });
    expect(kept.objects).toHaveLength(1);
    // the purge names durable-git's private layout; a spelling that drifted would list nothing here
    for (const prefix of packCachePrefixes(repo)) {
      const packs = await env.PACK_CACHE.list({ prefix });
      expect(packs.objects.length, prefix).toBeGreaterThan(0);
    }

    const deletion = await SELF.fetch(`${ORIGIN}/api/auth/delete-user`, {
      body: JSON.stringify({ password }),
      headers: { ...sessionHeaders(bearer), "content-type": "application/json" },
      method: "POST",
    });
    expect(deletion.status).toBe(200);

    const refused = await SELF.fetch(`${REMOTE}/info/refs?service=git-upload-pack`, {
      headers: deviceHeaders(credential),
    });
    expect(refused.status).toBe(401);

    expect(await env.REGISTRY.getByName("registry").get(repo)).toBeNull();
    for (const prefix of [listingPrefix, ...packCachePrefixes(repo)]) {
      const purged = await env.PACK_CACHE.list({ prefix });
      expect(purged.objects, prefix).toEqual([]);
    }

    // read off the SQL: the wire refuses a revoked credential before it could prove the wipe
    const stub = env.REPO.getByName(repo);
    const rows = await runInDurableObject(stub, (_instance, state) => ({
      objects: state.storage.sql.exec("SELECT COUNT(*) AS n FROM objects").one().n,
      refs: state.storage.sql.exec("SELECT COUNT(*) AS n FROM refs").one().n,
    }));
    expect(rows).toEqual({ objects: 0, refs: 0 });
  });
});
