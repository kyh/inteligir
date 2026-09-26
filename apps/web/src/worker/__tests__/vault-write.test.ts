import { base64FromBytes } from "@repo/api/cloud/bytes";
import { DEVICE_API_PATHS } from "@repo/api/cloud/device/device-schema";
import { cloudErrorSchema } from "@repo/api/cloud/errors";
import {
  VAULT_COMMIT_MAX_BYTES,
  vaultCommitResponseSchema,
  vaultConflictAnswerSchema,
} from "@repo/api/cloud/vault/vault-commit-schema";
import type { VaultCommitRequest } from "@repo/api/cloud/vault/vault-commit-schema";
import {
  VAULT_API_PATHS,
  VAULT_FILE_MAX_BYTES,
  vaultFileResponseSchema,
} from "@repo/api/cloud/vault/vault-schema";
import { SELF } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { blobObject } from "../vault/git-objects";
import { vaultRegistry, vaultRepoName } from "../vault/git-remote";
import { vaultStorageCap } from "../vault/receive-pack";
import { encodeGitPath } from "../vault/tree-walk";
import {
  deviceHeaders,
  emitted,
  loginDevice,
  ORIGIN,
  postVaultRead,
  sessionHeaders,
  signUpUser,
  userIdOf,
} from "./cloud-helpers";
import { pushVaultFiles, randomBytes, ZERO_OID } from "./git-pack";
import type { PushFile } from "./git-pack";

const COMMIT = `${ORIGIN}${VAULT_API_PATHS.commit}`;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

const DAY_MS = 24 * 60 * 60 * 1000;

const oidOf = async (text: string): Promise<string> => {
  const blob = await blobObject(encoder.encode(text));
  return blob.oid;
};

type Change = VaultCommitRequest["changes"][number];

const put = (path: string, base: string | null, text: string): Change => ({
  base,
  content: { encoding: "utf-8", text },
  op: "put",
  path,
});

const postCommit = async (
  credential: string,
  body: string | ReadableStream<Uint8Array>,
): Promise<Response> =>
  await SELF.fetch(COMMIT, {
    body,
    headers: { ...deviceHeaders(credential), "content-type": "application/json" },
    method: "POST",
  });

const sendChanges = async (
  credential: string,
  changes: readonly Change[],
  authoredAt?: number,
): Promise<Response> =>
  await postCommit(
    credential,
    JSON.stringify(authoredAt === undefined ? { changes } : { authoredAt, changes }),
  );

const committed = async (response: Response) => {
  expect(response.status).toBe(200);
  return emitted(vaultCommitResponseSchema, await response.text());
};

const errorCode = async (response: Response): Promise<string> =>
  emitted(cloudErrorSchema, await response.text()).error.code;

interface Vault {
  readonly phone: string;
  readonly laptop: string;
  readonly initial: string;
  readonly repo: string;
}

let accounts = 0;

// the laptop's push creates the hosted vault; the phone writes into it
const openVault = async (files: readonly PushFile[]): Promise<Vault> => {
  accounts += 1;
  const { bearer } = await signUpUser(`vault-write-${String(accounts)}@example.test`);
  const laptop = await loginDevice(bearer, "Laptop");
  const phone = await loginDevice(bearer, "Phone");
  const pushed = await pushVaultFiles(laptop.credential, "vault: initialize", files, ZERO_OID);
  expect(pushed.response.status).toBe(200);
  await pushed.response.arrayBuffer();
  return {
    initial: pushed.commit,
    laptop: laptop.credential,
    phone: phone.credential,
    repo: vaultRepoName(await userIdOf(bearer)),
  };
};

const cellOf = (vault: Vault) => env.REPO.getByName(vault.repo);

const headOf = async (vault: Vault): Promise<string | undefined> => {
  const head = await cellOf(vault).readCommit();
  return head?.oid;
};

const parentsOf = async (vault: Vault, oid: string): Promise<string[] | undefined> => {
  const commit = await cellOf(vault).readCommit(oid);
  return commit?.parents;
};

const textAt = async (vault: Vault, path: string): Promise<string | null> => {
  const blob = await cellOf(vault).readBlob(undefined, encodeGitPath(path));
  return blob === null ? null : decoder.decode(blob.data);
};

const readFile = async (credential: string, path: string) => {
  const response = await postVaultRead(VAULT_API_PATHS.file, deviceHeaders(credential), { path });
  expect(response.status).toBe(200);
  return emitted(vaultFileResponseSchema, await response.text());
};

describe("a phone's change set against the hosted vault", () => {
  it("lands a put on the oid the file route answered, as one commit on that head, authored by the device", async () => {
    const vault = await openVault([{ content: "one\n", path: "notes/a.md" }]);
    const read = await readFile(vault.phone, "notes/a.md");

    const answer = await committed(
      await sendChanges(vault.phone, [put("notes/a.md", read.oid, "two\n")]),
    );

    expect(answer.results).toEqual([{ oid: await oidOf("two\n"), path: "notes/a.md" }]);
    expect(await headOf(vault)).toBe(answer.commit);
    expect(await textAt(vault, "notes/a.md")).toBe("two\n");
    const landed = await cellOf(vault).readCommit(answer.commit);
    expect(landed?.parents).toEqual([vault.initial]);
    expect(landed?.author.name).toBe("Phone");
    expect(landed?.committer.name).toBe("Phone");
  });

  it("refuses a stale base with the note's current bytes and the device that wrote them, moving nothing", async () => {
    const vault = await openVault([{ content: "one\n", path: "a.md" }]);
    const base = await oidOf("one\n");
    const laptop = await committed(
      await sendChanges(vault.laptop, [put("a.md", base, "laptop\n")]),
    );

    const stale = await sendChanges(vault.phone, [put("a.md", base, "phone\n")]);

    expect(stale.status).toBe(409);
    const refused = emitted(vaultConflictAnswerSchema, await stale.text());
    expect(refused.error.code).toBe("vault-conflict");
    expect(refused.conflict).toEqual({
      conflicts: [
        {
          current: { content: "laptop\n", oid: await oidOf("laptop\n") },
          device: "Laptop",
          path: "a.md",
          reason: "changed",
        },
      ],
      head: laptop.commit,
    });
    expect(await headOf(vault)).toBe(laptop.commit);
  });

  it("answers a resent set with the commit it already made, and makes no other", async () => {
    const vault = await openVault([
      { content: "one\n", path: "a.md" },
      { content: "gone\n", path: "b.md" },
    ]);
    const changes = [
      put("a.md", await oidOf("one\n"), "two\n"),
      { base: await oidOf("gone\n"), op: "delete", path: "b.md" } satisfies Change,
    ];

    const first = await committed(await sendChanges(vault.phone, changes));
    const replay = await committed(await sendChanges(vault.phone, changes));

    expect(replay).toEqual(first);
    expect(await headOf(vault)).toBe(first.commit);
    expect(await parentsOf(vault, first.commit)).toEqual([vault.initial]);
  });

  it("lands on a desktop push of another note that arrived after the phone's read", async () => {
    const vault = await openVault([{ content: "one\n", path: "a.md" }]);
    const read = await readFile(vault.phone, "a.md");
    const desktop = await pushVaultFiles(
      vault.laptop,
      "vault: update desktop.md",
      [
        { content: "one\n", path: "a.md" },
        { content: "desk\n", path: "desktop.md" },
      ],
      vault.initial,
      { parent: vault.initial },
    );
    expect(desktop.response.status).toBe(200);
    await desktop.response.arrayBuffer();

    const answer = await committed(
      await sendChanges(vault.phone, [put("a.md", read.oid, "two\n")]),
    );

    expect(await parentsOf(vault, answer.commit)).toEqual([desktop.commit]);
    expect(await textAt(vault, "a.md")).toBe("two\n");
    expect(await textAt(vault, "desktop.md")).toBe("desk\n");
  });

  it("writes a base64 image the asset route answers byte for byte", async () => {
    const vault = await openVault([{ content: "# a\n", path: "a.md" }]);
    const png = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x80, 0xff);

    const answer = await committed(
      await sendChanges(vault.phone, [
        {
          base: null,
          content: { data: base64FromBytes(png), encoding: "base64" },
          op: "put",
          path: "media/photo.png",
        },
        put("a.md", await oidOf("# a\n"), "# a\n\n![[photo.png]]\n"),
      ]),
    );

    const asset = await postVaultRead(VAULT_API_PATHS.asset, deviceHeaders(vault.phone), {
      path: "media/photo.png",
      ref: answer.commit,
    });
    expect(asset.status).toBe(200);
    expect(asset.headers.get("content-type")).toBe("image/png");
    expect(new Uint8Array(await asset.arrayBuffer())).toStrictEqual(png);
  });

  it("dates the commit when the device made the change, held to the past month", async () => {
    const vault = await openVault([
      { content: "one\n", path: "a.md" },
      { content: "bee\n", path: "b.md" },
      { content: "sea\n", path: "c.md" },
    ]);
    const authorTime = async (path: string, text: string, authoredAt: number) => {
      const answer = await committed(
        await sendChanges(vault.phone, [put(path, await oidOf(text), `${text}!`)], authoredAt),
      );
      const landed = await cellOf(vault).readCommit(answer.commit);
      return (landed?.author.time ?? 0) * 1000;
    };

    const anHourAgo = Date.now() - 60 * 60 * 1000;
    expect(await authorTime("a.md", "one\n", anHourAgo)).toBe(Math.floor(anHourAgo / 1000) * 1000);
    expect(await authorTime("b.md", "bee\n", 0)).toBeGreaterThanOrEqual(Date.now() - 31 * DAY_MS);
    expect(await authorTime("c.md", "sea\n", Date.now() + 365 * DAY_MS)).toBeLessThanOrEqual(
      Date.now(),
    );
  });

  it("refuses what no file can hold, a body it cannot bound, and a path into git's machinery", async () => {
    const vault = await openVault([{ content: "one\n", path: "a.md" }]);
    const oversized = new Uint8Array(VAULT_COMMIT_MAX_BYTES + 1);
    const cases: readonly (readonly [string, () => Promise<Response>, number, string])[] = [
      [
        "base64 on a note",
        async () =>
          await sendChanges(vault.phone, [
            {
              base: null,
              content: { data: base64FromBytes(encoder.encode("# x\n")), encoding: "base64" },
              op: "put",
              path: "x.md",
            },
          ]),
        400,
        "bad-request",
      ],
      [
        "a lone surrogate",
        async () => await sendChanges(vault.phone, [put("x.md", null, "half \uD800 a pair\n")]),
        400,
        "bad-request",
      ],
      [
        "a note over the file ceiling",
        async () =>
          await sendChanges(vault.phone, [put("x.md", null, "x".repeat(VAULT_FILE_MAX_BYTES + 1))]),
        413,
        "file-too-large",
      ],
      [
        "a body over the ceiling",
        async () => await postCommit(vault.phone, decoder.decode(oversized)),
        413,
        "file-too-large",
      ],
      [
        "a body with no declared length",
        async () =>
          await postCommit(
            vault.phone,
            new ReadableStream<Uint8Array>({
              start(controller) {
                controller.enqueue(
                  encoder.encode(JSON.stringify({ changes: [put("x.md", null, "x")] })),
                );
                controller.close();
              },
            }),
          ),
        413,
        "file-too-large",
      ],
      [
        "a path into .git",
        async () => await sendChanges(vault.phone, [put(".git/config", null, "x\n")]),
        400,
        "bad-request",
      ],
      [
        "a path named twice",
        async () =>
          await sendChanges(vault.phone, [
            put("x.md", null, "x\n"),
            { base: await oidOf("one\n"), from: "a.md", op: "move", to: "x.md" },
          ]),
        400,
        "bad-request",
      ],
    ];
    for (const [label, send, status, code] of cases) {
      const response = await send();
      expect(response.status, label).toBe(status);
      expect(await errorCode(response), label).toBe(code);
    }
    expect(await headOf(vault)).toBe(vault.initial);
  });

  it("refuses a set the vault has no room left for as vault-full, landing none of it", async () => {
    const vault = await openVault([{ content: "# a\n", path: "a.md" }]);
    const { storedBytes } = await cellOf(vault).usage();
    const photo = randomBytes(vaultStorageCap(env) - storedBytes + 1024);

    const response = await sendChanges(vault.phone, [
      {
        base: null,
        content: { data: base64FromBytes(photo), encoding: "base64" },
        op: "put",
        path: "media/photo.png",
      },
      put("a.md", await oidOf("# a\n"), "# a\n\n![[photo.png]]\n"),
    ]);

    expect(response.status).toBe(507);
    expect(await errorCode(response)).toBe("vault-full");
    expect(await headOf(vault)).toBe(vault.initial);
  });

  it("answers not-found for an account with no hosted vault, and creates none", async () => {
    const { bearer } = await signUpUser("vault-write-none@example.test");
    const phone = await loginDevice(bearer, "Phone");

    const response = await sendChanges(phone.credential, [put("a.md", null, "# a\n")]);

    expect(response.status).toBe(404);
    expect(await errorCode(response)).toBe("not-found");
    expect(await vaultRegistry(env).get(vaultRepoName(await userIdOf(bearer)))).toBeNull();
  });

  it("refuses a revoked device", async () => {
    const { bearer } = await signUpUser("vault-write-revoked@example.test");
    const phone = await loginDevice(bearer, "Phone");
    const revoked = await SELF.fetch(`${ORIGIN}${DEVICE_API_PATHS.revoke}`, {
      body: JSON.stringify({ deviceId: phone.deviceId }),
      headers: { ...sessionHeaders(bearer), "content-type": "application/json" },
      method: "POST",
    });
    expect(revoked.status).toBe(200);

    const response = await sendChanges(phone.credential, [put("a.md", null, "# a\n")]);

    expect(response.status).toBe(401);
    expect(await errorCode(response)).toBe("unauthorized");
  });
});
