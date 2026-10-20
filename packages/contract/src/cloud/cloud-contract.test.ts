import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  ACCOUNT_API_PATHS,
  DELETE_ACCOUNT_REFUSALS,
  deleteAccountRequestSchema,
  deleteAccountResponseSchema,
  deviceSignUpRequestSchema,
  isDeleteAccountRefusal,
  signUpRequestSchema,
} from "./account/account-schema";
import {
  CLOUD_ERROR_CODES,
  CLOUD_ERROR_STATUS,
  cloudError,
  cloudErrorSchema,
} from "./cloud-errors";
import {
  DEVICE_API_PATHS,
  DEVICE_CREDENTIAL_PATTERN,
  DEVICE_LOGIN_REFUSALS,
  DEVICE_NAME_MAX_LENGTH,
  DEVICE_SIGN_UP_REFUSALS,
  deviceLoginRequestSchema,
  deviceLoginResponseSchema,
  isDeviceLoginRefusal,
  isDeviceSignUpRefusal,
  listDevicesResponseSchema,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  revokeDeviceResponseSchema,
} from "./device/device-schema";
import { createCloudClient, readCloudCall } from "./cloud-client";
import type { CloudFailure, CloudFetch } from "./cloud-client";
import { TEST_BUILD } from "./test-support/fake-cloud-client";
import { syncPingSchema } from "./sync/sync-ws";
import {
  VAULT_COMMIT_MAX_CHANGES,
  vaultCollisionKey,
  vaultCommitRequestSchema,
  vaultCommitResponseSchema,
  vaultConflictAnswerSchema,
} from "./vault/vault-commit-schema";
import type { VaultCommitRequest } from "./vault/vault-commit-schema";
import {
  assetMediaType,
  takesBytes,
  VAULT_API_PATHS,
  VAULT_ASSET_MEDIA_TYPES,
  VAULT_FILES_MAX_PATHS,
  vaultAssetQuerySchema,
  vaultFileQuerySchema,
  vaultFileResponseSchema,
  vaultFilesRequestSchema,
  vaultFilesResponseSchema,
  vaultTreeQuerySchema,
  vaultTreeResponseSchema,
} from "./vault/vault-schema";
import type {
  VaultAssetQuery,
  VaultFileQuery,
  VaultFilesRequest,
  VaultTreeQuery,
} from "./vault/vault-schema";

describe("error envelope", () => {
  it("round-trips through its own schema", () => {
    const envelope = cloudError("unauthorized", "no device credential");
    expect(cloudErrorSchema.parse(envelope)).toEqual(envelope);
  });

  it("reads a code it does not know as internal, keeping the worker's message", () => {
    expect(
      cloudErrorSchema.parse({ error: { code: "teapot", message: "Short and stout." } }),
    ).toEqual({ error: { code: "internal", message: "Short and stout." } });
  });

  it("carries a full hosted vault as vault-full on a 507", () => {
    expect(CLOUD_ERROR_CODES).toContain("vault-full");
    expect(CLOUD_ERROR_STATUS["vault-full"]).toBe(507);
    const envelope = cloudError("vault-full", "Your cloud vault is full.");
    expect(cloudErrorSchema.parse(envelope)).toEqual(envelope);
  });
});

const failureFor = async (response: Response): Promise<CloudFailure | null> => {
  const result = await createCloudClient({
    baseUrl: "https://cloud.test",
    build: TEST_BUILD,
    credential: `igd_${"a".repeat(64)}`,
    fetch: async () => response,
  }).listDevices();
  return result.ok ? null : result.failure;
};

const failureKind = async (response: Response): Promise<CloudFailure["kind"] | null> => {
  const failure = await failureFor(response);
  return failure?.kind ?? null;
};

const edgePage = (status: number): Response =>
  new Response("<html><body>Service Unavailable</body></html>", {
    headers: { "content-type": "text/html" },
    status,
  });

describe("a failure the cloud did not word", () => {
  it("reads an edge's HTML 503 as a cloud it could not reach, not a body to report", async () => {
    expect(await failureFor(edgePage(503))).toStrictEqual({
      kind: "unreachable",
      message: "HTTP 503 with no error body",
    });
  });

  it("reads a bare timeout, throttle or fault the same way", async () => {
    expect(await failureKind(edgePage(408))).toBe("unreachable");
    expect(await failureKind(edgePage(429))).toBe("unreachable");
    expect(await failureKind(new Response("internal error", { status: 500 }))).toBe("unreachable");
  });

  it("keeps a refusal the cloud did word, whatever its status", async () => {
    expect(
      await failureFor(
        Response.json(cloudError("rate-limited", "Too many attempts."), { status: 429 }),
      ),
    ).toStrictEqual({
      code: "rate-limited",
      kind: "refused",
      message: "Too many attempts.",
    });
  });

  it("calls any other unreadable answer malformed", async () => {
    expect(await failureKind(edgePage(403))).toBe("malformed");
  });

  it("reads a request that never left as unreachable, for a reader with no client", async () => {
    const result = await readCloudCall(async () => {
      throw new TypeError("Failed to fetch");
    }, listDevicesResponseSchema);
    expect(result).toStrictEqual({
      failure: { kind: "unreachable", message: "Failed to fetch" },
      ok: false,
    });
  });
});

type Json = z.infer<ReturnType<typeof z.json>>;

const jsonArraySchema = z.array(z.json());
const jsonObjectSchema = z.record(z.string(), z.json());

// a newer worker's answer: every object on the wire gains a field this build never declared,
// except an event body, which the wire carries opaque
const grown = (value: Json): Json => {
  const array = jsonArraySchema.safeParse(value);
  if (array.success) {
    return array.data.map(grown);
  }
  const object = jsonObjectSchema.safeParse(value);
  if (!object.success) {
    return value;
  }
  return {
    ...Object.fromEntries(
      Object.entries(object.data).map(([key, inner]) => [
        key,
        key === "event" ? inner : grown(inner),
      ]),
    ),
    addedByANewerWorker: { nested: [1] },
  };
};

const COMMIT = "a".repeat(40);

const ANSWERS: readonly (readonly [string, z.ZodType, Json])[] = [
  [
    "a login",
    deviceLoginResponseSchema,
    {
      credential: `igd_${"a".repeat(64)}`,
      deviceId: "dev_1",
      email: "owner@example.test",
      userId: "user_1",
    },
  ],
  [
    "the device list",
    listDevicesResponseSchema,
    {
      devices: [{ createdAt: 1, id: "dev_1", lastSeenAt: null, name: "Laptop", revokedAt: null }],
    },
  ],
  ["a sign-out", revokeDeviceResponseSchema, { revoked: true }],
  ["an account deletion", deleteAccountResponseSchema, { deleted: true }],
  [
    "a tree page",
    vaultTreeResponseSchema,
    {
      commit: COMMIT,
      entries: [{ oid: "b".repeat(40), path: "notes/a.md", size: 12 }],
      next: null,
    },
  ],
  [
    "a file",
    vaultFileResponseSchema,
    { commit: COMMIT, content: "# a\n", oid: "b".repeat(40), path: "notes/a.md" },
  ],
  [
    "a batch of files",
    vaultFilesResponseSchema,
    {
      commit: COMMIT,
      deferred: ["notes/d.md"],
      files: [{ content: "# a\n", oid: "b".repeat(40), path: "notes/a.md" }],
      missing: ["notes/b.md"],
      refused: [{ code: "not-text", path: "notes/c.md" }],
    },
  ],
  [
    "a commit",
    vaultCommitResponseSchema,
    {
      commit: COMMIT,
      results: [
        { oid: "b".repeat(40), path: "notes/a.md" },
        { oid: null, path: "notes/gone.md" },
      ],
    },
  ],
  [
    "a vault conflict",
    vaultConflictAnswerSchema,
    {
      conflict: {
        conflicts: [
          {
            current: { content: "# theirs\n", oid: "c".repeat(40) },
            device: "Laptop",
            path: "notes/a.md",
            reason: "changed",
          },
          { current: null, device: null, path: "notes/b.md", reason: "missing" },
        ],
        head: COMMIT,
      },
      error: { code: "vault-conflict", message: "The vault changed under this change set." },
    },
  ],
  ["a vault ping", syncPingSchema, { type: "vault" }],
  ["a refusal", cloudErrorSchema, { error: { code: "vault-full", message: "" } }],
];

describe("a worker newer than this build", () => {
  it.each(ANSWERS)(
    "reads %s it grew, and keeps only what this build declares",
    (_name, schema, answer) => {
      expect(schema.parse(grown(answer))).toStrictEqual(answer);
    },
  );

  it("reads a refusal code it does not know as internal: a fault to retry, in the worker's words", async () => {
    const paused = { error: { code: "account-paused", message: "This account is paused." } };
    expect(await failureFor(Response.json(paused, { status: 403 }))).toStrictEqual({
      code: "internal",
      kind: "refused",
      message: "This account is paused.",
    });
  });

  it("still hears a revocation whose envelope grew a field, so the session ends", async () => {
    const envelope = grown({ error: { code: "unauthorized", message: "Signed out." } });
    expect(await failureFor(Response.json(envelope, { status: 401 }))).toMatchObject({
      code: "unauthorized",
      kind: "refused",
    });
  });

  it("hands the caller a grown answer stripped to the declared shape", async () => {
    const result = await createCloudClient({
      baseUrl: "https://cloud.test",
      build: TEST_BUILD,
      credential: `igd_${"a".repeat(64)}`,
      fetch: async () => Response.json({ devices: [], plan: "pro" }),
    }).listDevices();
    expect(result).toStrictEqual({ ok: true, value: { devices: [] } });
  });
});

describe("device login", () => {
  const LOGIN = {
    deviceName: "Laptop",
    email: "owner@example.test",
    password: "correct horse battery",
  };

  it("folds the email the way the account stores it, and trims what a human pastes", () => {
    const parsed = deviceLoginRequestSchema.parse({
      ...LOGIN,
      deviceName: "  Kaiyu's MacBook ",
      email: "  Owner@Example.TEST ",
    });
    expect(parsed.email).toBe("owner@example.test");
    expect(parsed.deviceName).toBe("Kaiyu's MacBook");
    expect(parsed.password).toBe("correct horse battery");
  });

  it("refuses what is not an address, and never trims a password", () => {
    expect(deviceLoginRequestSchema.safeParse({ ...LOGIN, email: "owner" }).success).toBe(false);
    expect(deviceLoginRequestSchema.parse({ ...LOGIN, password: " padded pw " }).password).toBe(
      " padded pw ",
    );
  });

  it("bounds the password to better auth's own window", () => {
    expect(
      deviceLoginRequestSchema.safeParse({
        ...LOGIN,
        password: "x".repeat(PASSWORD_MIN_LENGTH - 1),
      }).success,
    ).toBe(false);
    expect(
      deviceLoginRequestSchema.safeParse({
        ...LOGIN,
        password: "x".repeat(PASSWORD_MAX_LENGTH + 1),
      }).success,
    ).toBe(false);
    expect(
      deviceLoginRequestSchema.safeParse({ ...LOGIN, password: "x".repeat(PASSWORD_MAX_LENGTH) })
        .success,
    ).toBe(true);
  });

  it("bounds the device name and refuses a field it does not know", () => {
    expect(
      deviceLoginRequestSchema.safeParse({
        ...LOGIN,
        deviceName: "x".repeat(DEVICE_NAME_MAX_LENGTH + 1),
      }).success,
    ).toBe(false);
    expect(deviceLoginRequestSchema.safeParse({ ...LOGIN, deviceName: "  " }).success).toBe(false);
    expect(deviceLoginRequestSchema.safeParse({ ...LOGIN, rememberMe: true }).success).toBe(false);
  });

  it("pins the credential shape the server mints, and the answer that carries it", () => {
    expect(DEVICE_CREDENTIAL_PATTERN.test(`igd_${"a".repeat(64)}`)).toBe(true);
    expect(DEVICE_CREDENTIAL_PATTERN.test(`igd_${"a".repeat(63)}`)).toBe(false);
    expect(DEVICE_CREDENTIAL_PATTERN.test("not-a-credential")).toBe(false);
    const answer = {
      credential: `igd_${"a".repeat(64)}`,
      deviceId: "dev_1",
      email: "owner@example.test",
      userId: "user_1",
    };
    expect(deviceLoginResponseSchema.parse(answer)).toEqual(answer);
    expect(deviceLoginResponseSchema.parse({ ...answer, token: "x" })).toStrictEqual(answer);
    const accountless = { credential: answer.credential, deviceId: answer.deviceId };
    expect(deviceLoginResponseSchema.safeParse(accountless).success).toBe(false);
  });

  it("signs a device out with its own credential, and nothing else", async () => {
    const seen: { path: string; method: string; authorization: string | null }[] = [];
    const credential = `igd_${"a".repeat(64)}`;
    const result = await createCloudClient({
      baseUrl: "https://cloud.test",
      build: TEST_BUILD,
      credential,
      fetch: async (input, init) => {
        seen.push({
          authorization: new Headers(init?.headers).get("authorization"),
          method: init?.method ?? "GET",
          path: new URL(input).pathname,
        });
        return Response.json({ revoked: true });
      },
    }).signOut();
    expect(result).toStrictEqual({ ok: true, value: { revoked: true } });
    expect(seen).toStrictEqual([
      { authorization: `Bearer ${credential}`, method: "POST", path: DEVICE_API_PATHS.signOut },
    ]);
  });

  it("deletes the account with its own credential and the password asked again", async () => {
    const seen: { path: string; authorization: string | null; body: unknown }[] = [];
    const credential = `igd_${"a".repeat(64)}`;
    const password = " the password, spaces kept ";
    const result = await createCloudClient({
      baseUrl: "https://cloud.test",
      build: TEST_BUILD,
      credential,
      fetch: async (input, init) => {
        seen.push({
          authorization: new Headers(init?.headers).get("authorization"),
          body: JSON.parse(z.string().parse(init?.body)),
          path: new URL(input).pathname,
        });
        return Response.json({ deleted: true });
      },
    }).deleteAccount(password);
    expect(result).toStrictEqual({ ok: true, value: { deleted: true } });
    expect(seen).toStrictEqual([
      { authorization: `Bearer ${credential}`, body: { password }, path: ACCOUNT_API_PATHS.delete },
    ]);
    expect(deleteAccountRequestSchema.safeParse({ password: "short" }).success).toBe(false);
    expect(deleteAccountRequestSchema.safeParse({ email: "x", password }).success).toBe(false);
  });

  it("names refusals the envelope can carry, and nothing else as one", () => {
    for (const refusal of DEVICE_LOGIN_REFUSALS) {
      expect(CLOUD_ERROR_CODES).toContain(refusal);
      expect(isDeviceLoginRefusal(refusal)).toBe(true);
    }
    expect(isDeviceLoginRefusal("unauthorized")).toBe(false);
    for (const refusal of DEVICE_SIGN_UP_REFUSALS) {
      expect(CLOUD_ERROR_CODES).toContain(refusal);
      expect(isDeviceSignUpRefusal(refusal)).toBe(true);
    }
    expect(isDeviceSignUpRefusal("device-limit")).toBe(false);
    for (const refusal of DELETE_ACCOUNT_REFUSALS) {
      expect(CLOUD_ERROR_CODES).toContain(refusal);
      expect(isDeleteAccountRefusal(refusal)).toBe(true);
    }
    expect(isDeleteAccountRefusal("unauthorized")).toBe(false);
  });
});

describe("invite sign-up request", () => {
  const SIGN_UP = {
    email: "owner@example.test",
    inviteCode: "INVITE-1",
    name: "Owner",
    password: "correct horse battery",
  };

  it("trims every field but the password", () => {
    expect(
      signUpRequestSchema.parse({
        email: " owner@example.test ",
        inviteCode: " INVITE-1 ",
        name: " Owner ",
        password: " padded pw ",
      }),
    ).toStrictEqual({ ...SIGN_UP, password: " padded pw " });
  });

  it("bounds the password to the window device login and better auth hold", () => {
    for (const [length, accepted] of [
      [PASSWORD_MIN_LENGTH - 1, false],
      [PASSWORD_MIN_LENGTH, true],
      [PASSWORD_MAX_LENGTH, true],
      [PASSWORD_MAX_LENGTH + 1, false],
    ] as const) {
      const password = "x".repeat(length);
      expect(signUpRequestSchema.safeParse({ ...SIGN_UP, password }).success, String(length)).toBe(
        accepted,
      );
    }
  });

  it("refuses a blank name or address and a field it does not know", () => {
    expect(signUpRequestSchema.safeParse({ ...SIGN_UP, name: "  " }).success).toBe(false);
    expect(signUpRequestSchema.safeParse({ ...SIGN_UP, email: "" }).success).toBe(false);
    expect(signUpRequestSchema.safeParse({ ...SIGN_UP, rememberMe: true }).success).toBe(false);
  });

  it("folds the app's address the way login does, and asks for the device's name", () => {
    expect(
      deviceSignUpRequestSchema.parse({
        ...SIGN_UP,
        deviceName: " Laptop ",
        email: " Owner@Example.TEST ",
      }),
    ).toStrictEqual({ ...SIGN_UP, deviceName: "Laptop" });
    expect(deviceSignUpRequestSchema.safeParse(SIGN_UP).success).toBe(false);
    expect(
      deviceSignUpRequestSchema.safeParse({ ...SIGN_UP, deviceName: "L", email: "not-an-address" })
        .success,
    ).toBe(false);
  });
});

describe("ws ping frames", () => {
  it("parses the one server frame, and reads a frame a newer worker grew", () => {
    expect(syncPingSchema.parse({ type: "vault" })).toStrictEqual({ type: "vault" });
    expect(syncPingSchema.parse({ extra: true, type: "vault" })).toStrictEqual({ type: "vault" });
  });

  it("reads a frame type it does not know as no frame", () => {
    expect(syncPingSchema.safeParse({ type: "presence" }).success).toBe(false);
    expect(syncPingSchema.safeParse({ seq: 1, type: "sync" }).success).toBe(false);
  });
});

describe("vault read rows", () => {
  it("parses the tree page and the file", () => {
    const tree = vaultTreeResponseSchema.parse({
      commit: COMMIT,
      entries: [{ oid: "b".repeat(40), path: "notes/a.md", size: 12 }],
      next: null,
    });
    expect(tree.entries[0]?.path).toBe("notes/a.md");
    expect(
      vaultTreeResponseSchema.safeParse({
        commit: COMMIT,
        entries: [{ path: "notes/a.md", size: 12 }],
        next: null,
      }).success,
    ).toBe(false);
    const file = vaultFileResponseSchema.parse({
      commit: COMMIT,
      content: "# a\n",
      oid: "b".repeat(40),
      path: "notes/a.md",
    });
    expect(file.content).toBe("# a\n");
  });

  it("refuses paths that are not vault-relative", () => {
    for (const bad of ["/rooted.md", "../up.md", "a//b.md", "a/./b.md", ""]) {
      expect(vaultFileQuerySchema.safeParse({ path: bad }).success).toBe(false);
    }
    expect(vaultFileQuerySchema.safeParse({ path: "notes/ok.md" }).success).toBe(true);
  });

  it("refuses a short or uppercase ref — the cursor pins one commit exactly", () => {
    expect(vaultTreeQuerySchema.safeParse({ ref: "abc123" }).success).toBe(false);
    expect(vaultTreeQuerySchema.safeParse({ ref: "A".repeat(40) }).success).toBe(false);
    expect(vaultTreeQuerySchema.safeParse({ ref: COMMIT }).success).toBe(true);
  });

  it("the asset query REQUIRES its ref — an unpinned read names no immutable bytes", () => {
    expect(vaultAssetQuerySchema.safeParse({ path: "a.png" }).success).toBe(false);
    expect(vaultAssetQuerySchema.safeParse({ path: "a.png", ref: COMMIT }).success).toBe(true);
    expect(vaultAssetQuerySchema.safeParse({ path: "../up.png", ref: COMMIT }).success).toBe(false);
    expect(vaultAssetQuerySchema.safeParse({ extra: 1, path: "a.png", ref: COMMIT }).success).toBe(
      false,
    );
  });

  it("posts each read's query in the body the route decodes, never a path in the URL", async () => {
    const sent: { body: unknown; method: string; url: URL }[] = [];
    const client = createCloudClient({
      baseUrl: "https://cloud.test",
      build: TEST_BUILD,
      credential: `igd_${"a".repeat(64)}`,
      fetch: async (input, init) => {
        sent.push({
          body: JSON.parse(String(init?.body)),
          method: init?.method ?? "GET",
          url: new URL(input),
        });
        return new Response(null, { status: 404 });
      },
    });
    const posted = <TSchema extends z.ZodType>(path: string, schema: TSchema): z.infer<TSchema> => {
      const request = sent.pop();
      expect(request?.method).toBe("POST");
      expect(request?.url.pathname).toBe(path);
      expect(request?.url.search).toBe("");
      return schema.parse(request?.body);
    };

    const trees: VaultTreeQuery[] = [
      {},
      { limit: 7 },
      { after: "notes/α β&c=d+e.md", limit: 500, ref: COMMIT },
    ];
    for (const query of trees) {
      await client.vaultTree(query);
      expect(posted(VAULT_API_PATHS.tree, vaultTreeQuerySchema)).toEqual(query);
    }

    const files: VaultFileQuery[] = [{ path: "100%done.md" }, { path: "a b/c?.md", ref: COMMIT }];
    for (const query of files) {
      await client.vaultFile(query);
      expect(posted(VAULT_API_PATHS.file, vaultFileQuerySchema)).toEqual(query);
    }

    const asset: VaultAssetQuery = { path: "media/α β#1.png", ref: COMMIT };
    await client.vaultAsset(asset);
    expect(posted(VAULT_API_PATHS.asset, vaultAssetQuerySchema)).toEqual(asset);
  });

  it("refuses a tree limit that is not a whole number in range", () => {
    expect(vaultTreeQuerySchema.safeParse({ limit: 500 }).success).toBe(true);
    for (const limit of [0, 501, 1.5, "7", "", "ten"]) {
      expect(vaultTreeQuerySchema.safeParse({ limit }).success, String(limit)).toBe(false);
    }
  });

  it("the batch REQUIRES its ref and names one to forty unique vault paths", () => {
    const paths = Array.from({ length: VAULT_FILES_MAX_PATHS }, (_, index) => `n${index}.md`);
    expect(vaultFilesRequestSchema.safeParse({ paths, ref: COMMIT }).success).toBe(true);
    for (const refused of [
      { paths },
      { paths: [...paths, "one-more.md"], ref: COMMIT },
      { paths: [], ref: COMMIT },
      { paths: ["a.md", "a.md"], ref: COMMIT },
      { paths: ["../up.md"], ref: COMMIT },
      { paths: ["a.md"], ref: "abc123" },
      { extra: 1, paths: ["a.md"], ref: COMMIT },
    ]) {
      expect(vaultFilesRequestSchema.safeParse(refused).success, JSON.stringify(refused)).toBe(
        false,
      );
    }
  });

  it("posts a batch the route decodes to exactly the request, the bearer in a header", async () => {
    const credential = `igd_${"a".repeat(64)}`;
    const request: VaultFilesRequest = { paths: ["notes/α β&c=d.md", "100%done.md"], ref: COMMIT };
    const answer = { commit: COMMIT, deferred: [], files: [], missing: request.paths, refused: [] };
    const seen: { authorization: string | null; body: unknown; method: string; url: URL }[] = [];
    const result = await createCloudClient({
      baseUrl: "https://cloud.test",
      build: TEST_BUILD,
      credential,
      fetch: async (input, init) => {
        seen.push({
          authorization: new Headers(init?.headers).get("authorization"),
          body: JSON.parse(String(init?.body)),
          method: init?.method ?? "GET",
          url: new URL(input),
        });
        return Response.json(answer);
      },
    }).vaultFiles(request);
    expect(result).toStrictEqual({ ok: true, value: answer });
    expect(seen).toHaveLength(1);
    const [sent] = seen;
    expect(sent?.method).toBe("POST");
    expect(sent?.url.pathname).toBe(VAULT_API_PATHS.files);
    expect(sent?.url.search).toBe("");
    expect(sent?.authorization).toBe(`Bearer ${credential}`);
    expect(vaultFilesRequestSchema.parse(sent?.body)).toEqual(request);
  });

  it("the asset allowlist answers a type or nothing — never a fallback", () => {
    expect(assetMediaType("media/diagram.png")).toBe("image/png");
    expect(assetMediaType("media/PHOTO.JPG")).toBe("image/jpeg");
    expect(assetMediaType("notes.md")).toBeNull();
    expect(assetMediaType("script.html")).toBeNull();
    expect(assetMediaType("no-extension")).toBeNull();
  });

  it("pins the asset allowlist WHOLE — growth is additive, removal waits on the build floor", () => {
    // hand-listed on purpose: removing an entry 400s every phone above the floor whose notes embed it
    expect(
      Object.fromEntries(
        [...VAULT_ASSET_MEDIA_TYPES].map(([extension, row]) => [
          extension,
          `${row.kind} ${row.mediaType}`,
        ]),
      ),
    ).toEqual({
      ".aac": "audio audio/aac",
      ".apng": "image image/apng",
      ".avif": "image image/avif",
      ".bmp": "image image/bmp",
      ".flac": "audio audio/flac",
      ".gif": "image image/gif",
      ".ico": "image image/x-icon",
      ".jpeg": "image image/jpeg",
      ".jpg": "image image/jpeg",
      ".m4a": "audio audio/mp4",
      ".m4v": "video video/x-m4v",
      ".mov": "video video/quicktime",
      ".mp3": "audio audio/mpeg",
      ".mp4": "video video/mp4",
      ".pdf": "pdf application/pdf",
      ".png": "image image/png",
      ".svg": "image image/svg+xml",
      ".wav": "audio audio/wav",
      ".webm": "video video/webm",
      ".webp": "image image/webp",
    });
  });

  it("stores bytes at any path but a doc's and the app's own, which is wider than it serves", () => {
    for (const path of ["assets/archive.zip", "assets/IMG.HEIC", "media/a.png", "x.pdf"]) {
      expect(takesBytes(path), path).toBe(true);
    }
    for (const path of [
      "notes/a.md",
      "notes/a.TXT",
      ".inteligir/annotations/abc.json",
      ".obsidian/workspace.json",
      "notes/.DS_Store",
    ]) {
      expect(takesBytes(path), path).toBe(false);
    }
    expect(assetMediaType("assets/archive.zip")).toBeNull();
  });
});

describe("an attachment's bytes", () => {
  const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const CREDENTIAL = `igd_${"a".repeat(64)}`;
  const QUERY: VaultAssetQuery = { path: "media/α β.png", ref: COMMIT };

  const assetOver = async (fetch: CloudFetch) =>
    await createCloudClient({
      baseUrl: "https://cloud.test",
      build: TEST_BUILD,
      credential: CREDENTIAL,
      fetch,
    }).vaultAsset(QUERY);

  it("answers the bytes under the allowlist's type, the bearer and the path never in the URL", async () => {
    const seen: { authorization: string | null; body: unknown; method: string; uri: string }[] = [];
    const result = await assetOver(async (input, init) => {
      seen.push({
        authorization: new Headers(init?.headers).get("authorization"),
        body: JSON.parse(String(init?.body)),
        method: init?.method ?? "GET",
        uri: input,
      });
      return new Response(PNG, { headers: { "content-type": "image/png" } });
    });
    expect(result).toStrictEqual({ ok: true, value: { bytes: PNG, mediaType: "image/png" } });
    expect(seen.map((request) => request.authorization)).toStrictEqual([`Bearer ${CREDENTIAL}`]);
    expect(seen.map((request) => request.method)).toStrictEqual(["POST"]);
    expect(vaultAssetQuerySchema.parse(seen[0]?.body)).toStrictEqual(QUERY);
    const url = new URL(seen[0]?.uri ?? "");
    expect(url.pathname).toBe(VAULT_API_PATHS.asset);
    expect(url.search).toBe("");
    expect(url.username).toBe("");
  });

  it("reads a type the allowlist does not name for the path as malformed, never as bytes", async () => {
    for (const contentType of ["text/html", "image/jpeg", "image/png; charset=utf-8"]) {
      const result = await assetOver(
        async () => new Response(PNG, { headers: { "content-type": contentType } }),
      );
      expect(result.ok ? null : result.failure.kind, contentType).toBe("malformed");
    }
  });

  it("keeps a refusal the cloud worded, and reads a request that never left as unreachable", async () => {
    const refused = await assetOver(async () =>
      Response.json(cloudError("not-found", "That revision does not carry the path."), {
        status: 404,
      }),
    );
    expect(refused).toStrictEqual({
      failure: {
        code: "not-found",
        kind: "refused",
        message: "That revision does not carry the path.",
      },
      ok: false,
    });
    const offline = await assetOver(async () => {
      throw new TypeError("Failed to fetch");
    });
    expect(offline).toStrictEqual({
      failure: { kind: "unreachable", message: "Failed to fetch" },
      ok: false,
    });
  });
});

const put = (path: string): VaultCommitRequest["changes"][number] => ({
  base: null,
  content: { encoding: "utf-8", text: "x" },
  op: "put",
  path,
});

describe("a vault change set", () => {
  const BASE = "b".repeat(40);
  const CREDENTIAL = `igd_${"a".repeat(64)}`;

  // as a phone sent it: the Worker must read this body for as long as that phone is installed
  const RECORDED = `{"authoredAt":1790000000000,"changes":[
    {"op":"put","path":"notes/a.md","base":"${BASE}","content":{"encoding":"utf-8","text":"# a\\n"}},
    {"op":"put","path":"media/photo.png","base":null,"content":{"encoding":"base64","data":"iVBORw0KGgo="}},
    {"op":"delete","path":"old.md","base":"${BASE}"},
    {"op":"move","from":"x.md","to":"notes/x.md","base":"${BASE}"}
  ]}`;

  it("reads a set a phone recorded, every op and both encodings", () => {
    const body: unknown = JSON.parse(RECORDED);
    expect(vaultCommitRequestSchema.parse(body)).toStrictEqual(body);
  });

  it("refuses a set that names a path twice, a move's ends included", () => {
    for (const changes of [
      [put("a.md"), put("a.md")],
      [put("b.md"), { base: BASE, from: "a.md", op: "move", to: "b.md" }],
      [put("a.md"), { base: BASE, op: "delete", path: "a.md" }],
    ]) {
      expect(vaultCommitRequestSchema.safeParse({ changes }).success).toBe(false);
    }
  });

  it("refuses an empty or oversized set, and any change it cannot read exactly", () => {
    const many = Array.from({ length: VAULT_COMMIT_MAX_CHANGES + 1 }, (_, index) =>
      put(`n${String(index)}.md`),
    );
    expect(vaultCommitRequestSchema.safeParse({ changes: many.slice(1) }).success).toBe(true);
    for (const refused of [
      { changes: [] },
      { changes: many },
      { changes: [put("a.md")], deviceId: "dev_1" },
      { changes: [{ ...put("a.md"), mode: "100755" }] },
      { changes: [{ ...put("a.md"), base: "abc123" }] },
      { changes: [put("a//b.md")] },
      { changes: [put(".git/config")] },
      { changes: [{ ...put("a.png"), content: { data: "not base64!", encoding: "base64" } }] },
      { changes: [{ base: null, op: "delete", path: "a.md" }] },
      { authoredAt: -1, changes: [put("a.md")] },
    ]) {
      expect(vaultCommitRequestSchema.safeParse(refused).success, JSON.stringify(refused)).toBe(
        false,
      );
    }
  });

  it("keys a name the way a Mac's filesystem compares it", () => {
    expect(vaultCollisionKey("Notes/Readme.md")).toBe(vaultCollisionKey("notes/readme.md"));
    expect(vaultCollisionKey("café.md")).toBe(vaultCollisionKey("café.md"));
    expect(vaultCollisionKey("a.md")).not.toBe(vaultCollisionKey("b.md"));
  });

  const CONFLICT = {
    conflict: {
      conflicts: [
        {
          current: { content: "# theirs\n", oid: "c".repeat(40) },
          device: "Laptop",
          path: "notes/a.md",
          reason: "changed",
        },
        { current: null, device: null, path: "notes/b.md", reason: "missing" },
      ],
      head: COMMIT,
    },
    error: { code: "vault-conflict", message: "The vault changed under this change set." },
  } as const;

  it("reads a conflict whose reason it does not know as a path it cannot write", () => {
    const newer = {
      ...CONFLICT,
      conflict: {
        ...CONFLICT.conflict,
        conflicts: [{ ...CONFLICT.conflict.conflicts[1], reason: "quota" }],
      },
    };
    expect(vaultConflictAnswerSchema.parse(newer).conflict.conflicts[0]?.reason).toBe("unwritable");
  });

  it("reaches a reader that knows only the envelope as the refusal vault-conflict", async () => {
    const result = await readCloudCall(
      async () => Response.json(CONFLICT, { status: 409 }),
      vaultCommitResponseSchema,
    );
    expect(result).toStrictEqual({
      failure: {
        code: "vault-conflict",
        kind: "refused",
        message: CONFLICT.error.message,
      },
      ok: false,
    });
  });

  const commitOver = async (response: Response) => {
    const seen: { authorization: string | null; body: unknown; method: string; url: URL }[] = [];
    const request: VaultCommitRequest = { authoredAt: 1, changes: [put("notes/α β&c.md")] };
    const result = await createCloudClient({
      baseUrl: "https://cloud.test",
      build: TEST_BUILD,
      credential: CREDENTIAL,
      fetch: async (input, init) => {
        seen.push({
          authorization: new Headers(init?.headers).get("authorization"),
          body: JSON.parse(String(init?.body)),
          method: init?.method ?? "GET",
          url: new URL(input),
        });
        return response;
      },
    }).vaultCommit(request);
    return { request, result, seen };
  };

  it("posts the set the route decodes to exactly the request, the bearer in a header", async () => {
    const answer = { commit: COMMIT, results: [{ oid: BASE, path: "notes/α β&c.md" }] };
    const { request, result, seen } = await commitOver(Response.json(answer));
    expect(result).toStrictEqual({ ok: true, value: { kind: "committed", ...answer } });
    expect(seen).toHaveLength(1);
    const [sent] = seen;
    expect(sent?.method).toBe("POST");
    expect(sent?.url.pathname).toBe(VAULT_API_PATHS.commit);
    expect(sent?.authorization).toBe(`Bearer ${CREDENTIAL}`);
    expect(vaultCommitRequestSchema.parse(sent?.body)).toEqual(request);
  });

  it("answers a conflict as a value carrying each path, never as a failure", async () => {
    const { result } = await commitOver(Response.json(CONFLICT, { status: 409 }));
    expect(result.ok && result.value.kind === "conflict" ? result.value : null).toStrictEqual({
      ...CONFLICT.conflict,
      kind: "conflict",
    });
  });

  it("keeps every other refusal a failure, a 409 without the conflict included", async () => {
    for (const [code, status] of [
      ["not-found", 404],
      ["device-limit", 409],
      ["file-too-large", 413],
      ["vault-full", 507],
    ] as const) {
      const { result } = await commitOver(Response.json(cloudError(code, "no"), { status }));
      expect(result.ok ? null : result.failure, code).toStrictEqual({
        code,
        kind: "refused",
        message: "no",
      });
    }
  });
});
