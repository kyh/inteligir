import { describe, expect, it } from "vitest";
import { z } from "zod";
import { accountResponseSchema } from "../account/account-schema";
import {
  ackCapturesRequestSchema,
  ackCapturesResponseSchema,
  captureRequestSchema,
  captureResponseSchema,
  claimCapturesResponseSchema,
} from "../captures/captures-schema";
import { CLOUD_ERROR_CODES, cloudError, cloudErrorSchema } from "../cloud-errors";
import {
  DEVICE_API_PATHS,
  DEVICE_CREDENTIAL_PATTERN,
  DEVICE_LOGIN_REFUSALS,
  DEVICE_NAME_MAX_LENGTH,
  deviceLoginRequestSchema,
  deviceLoginResponseSchema,
  isDeviceLoginRefusal,
  listDevicesResponseSchema,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  revokeDeviceResponseSchema,
} from "../device/device-schema";
import { createCloudClient } from "../cloud-client";
import type { CloudFailure } from "../cloud-client";
import {
  EVENT_MAX_BYTES,
  pullQuerySchema,
  pullResponseSchema,
  pushRequestSchema,
  pushResponseSchema,
} from "../sync/sync-schema";
import { syncPingSchema } from "../sync/sync-ws";
import {
  assetMediaType,
  VAULT_API_PATHS,
  VAULT_ASSET_MEDIA_TYPES,
  vaultAssetQuerySchema,
  vaultFileQuerySchema,
  vaultFileResponseSchema,
  vaultTreeQuerySchema,
  vaultTreeResponseSchema,
} from "../vault/vault-schema";
import type { VaultAssetQuery, VaultFileQuery, VaultTreeQuery } from "../vault/vault-schema";

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

  it("names the outbox position on a sync refusal", () => {
    const envelope = cloudError("sync-conflict", "already stored with a different body", 7);
    expect(cloudErrorSchema.parse(envelope).error.deviceSeq).toBe(7);
    expect("deviceSeq" in cloudError("unauthorized", "nope").error).toBe(false);
  });
});

const failureFor = async (response: Response): Promise<CloudFailure | null> => {
  const result = await createCloudClient({
    baseUrl: "https://cloud.test",
    credential: `igd_${"a".repeat(64)}`,
    fetch: async () => response,
  }).account();
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
      deviceSeq: null,
      kind: "refused",
      message: "Too many attempts.",
    });
  });

  it("calls any other unreadable answer malformed", async () => {
    expect(await failureKind(edgePage(403))).toBe("malformed");
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
  ["the account", accountResponseSchema, { email: "owner@example.test", id: "user_1" }],
  ["a capture", captureResponseSchema, { createdAt: 1, duplicate: false, id: "cap_1" }],
  [
    "a claim",
    claimCapturesResponseSchema,
    {
      captures: [{ createdAt: 1, id: "cap_1", text: "buy oat milk" }],
      claimToken: "tok",
      expiresAt: 2,
    },
  ],
  ["an ack", ackCapturesResponseSchema, { results: [{ id: "cap_1", outcome: "deleted" }] }],
  [
    "a login",
    deviceLoginResponseSchema,
    { credential: `igd_${"a".repeat(64)}`, deviceId: "dev_1" },
  ],
  [
    "the device list",
    listDevicesResponseSchema,
    {
      devices: [{ createdAt: 1, id: "dev_1", lastSeenAt: null, name: "Laptop", revokedAt: null }],
    },
  ],
  ["a sign-out", revokeDeviceResponseSchema, { revoked: true }],
  ["a push", pushResponseSchema, { accepted: 1, duplicates: 0, lastSeq: 1 }],
  [
    "a pull",
    pullResponseSchema,
    {
      events: [
        {
          createdAt: 1,
          deviceId: "dev_2",
          deviceSeq: 1,
          event: { payload: { kept: true }, type: "turn/started" },
          seq: 1,
          threadId: "th_1",
        },
      ],
      hasMore: false,
      lastSeq: 1,
    },
  ],
  [
    "a tree page",
    vaultTreeResponseSchema,
    { commit: COMMIT, entries: [{ path: "notes/a.md", size: 12 }], next: null },
  ],
  [
    "a file",
    vaultFileResponseSchema,
    { commit: COMMIT, content: "# a\n", oid: "b".repeat(40), path: "notes/a.md" },
  ],
  ["a sync ping", syncPingSchema, { seq: 1, type: "sync" }],
  ["a dispatch ping", syncPingSchema, { threadId: "th_1", type: "dispatch" }],
  ["a refusal", cloudErrorSchema, { error: { code: "sync-conflict", deviceSeq: 7, message: "" } }],
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
      deviceSeq: null,
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
      credential: `igd_${"a".repeat(64)}`,
      fetch: async () => Response.json({ email: "owner@example.test", id: "user_1", plan: "pro" }),
    }).account();
    expect(result).toStrictEqual({
      ok: true,
      value: { email: "owner@example.test", id: "user_1" },
    });
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
    const answer = { credential: `igd_${"a".repeat(64)}`, deviceId: "dev_1" };
    expect(deviceLoginResponseSchema.parse(answer)).toEqual(answer);
    expect(deviceLoginResponseSchema.parse({ ...answer, token: "x" })).toStrictEqual(answer);
  });

  it("signs a device out with its own credential, and nothing else", async () => {
    const seen: { path: string; method: string; authorization: string | null }[] = [];
    const credential = `igd_${"a".repeat(64)}`;
    const result = await createCloudClient({
      baseUrl: "https://cloud.test",
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

  it("names refusals the envelope can carry, and nothing else as one", () => {
    for (const refusal of DEVICE_LOGIN_REFUSALS) {
      expect(CLOUD_ERROR_CODES).toContain(refusal);
      expect(isDeviceLoginRefusal(refusal)).toBe(true);
    }
    expect(isDeviceLoginRefusal("unauthorized")).toBe(false);
  });
});

describe("push request", () => {
  it("accepts an opaque JSON event body", () => {
    const result = pushRequestSchema.safeParse({
      events: [
        {
          createdAt: 1,
          deviceSeq: 1,
          event: { nested: [1, "x", null], type: "turn/started" },
          threadId: "th_1",
        },
      ],
      threads: [{ lane: "desktop", threadId: "th_1", title: "Fix the build", updatedAt: 1 }],
    });
    expect(result.success).toBe(true);
  });

  it("demands the client's own timestamp on a metadata upsert", () => {
    const result = pushRequestSchema.safeParse({
      events: [],
      threads: [{ lane: "desktop", threadId: "th_1" }],
    });
    expect(result.success).toBe(false);
  });

  it("refuses an event body over the byte ceiling", () => {
    const result = pushRequestSchema.safeParse({
      events: [
        { createdAt: 1, deviceSeq: 1, event: "x".repeat(EVENT_MAX_BYTES + 1), threadId: "th_1" },
      ],
    });
    expect(result.success).toBe(false);
  });

  it("measures the ceiling in UTF-8 bytes, not UTF-16 units", () => {
    // "あ" is one UTF-16 unit and three UTF-8 bytes
    const wide = "あ".repeat(EVENT_MAX_BYTES / 3);
    expect(wide.length).toBeLessThan(EVENT_MAX_BYTES);
    const result = pushRequestSchema.safeParse({
      events: [{ createdAt: 1, deviceSeq: 1, event: wide, threadId: "th_1" }],
    });
    expect(result.success).toBe(false);
  });

  it("refuses a non-JSON event body", () => {
    const result = pushRequestSchema.safeParse({
      events: [{ createdAt: 1, deviceSeq: 1, event: undefined, threadId: "th_1" }],
    });
    expect(result.success).toBe(false);
  });
});

describe("pull query", () => {
  it("coerces from query strings and defaults what is absent", () => {
    expect(pullQuerySchema.parse({ afterSeq: "41", limit: "2" })).toEqual({
      afterSeq: 41,
      limit: 2,
    });
    expect(pullQuerySchema.parse({})).toEqual({ afterSeq: 0, limit: 200 });
  });

  it("refuses a negative cursor", () => {
    expect(pullQuerySchema.safeParse({ afterSeq: "-1" }).success).toBe(false);
  });
});

describe("capture handoff", () => {
  it("demands an idempotency key, so a retried share-sheet post is one capture", () => {
    expect(captureRequestSchema.safeParse({ text: "buy oat milk" }).success).toBe(false);
    expect(
      captureRequestSchema.safeParse({ idempotencyKey: "k".repeat(8), text: "buy oat milk" })
        .success,
    ).toBe(true);
  });

  it("acks by claim token and answers per id", () => {
    const parsed = ackCapturesResponseSchema.parse({
      results: [
        { id: "c1", outcome: "deleted" },
        { id: "c2", outcome: "reclaimed" },
        { id: "c3", outcome: "unknown" },
      ],
    });
    expect(parsed.results.map((row) => row.outcome)).toEqual(["deleted", "reclaimed", "unknown"]);
    expect(ackCapturesRequestSchema.safeParse({ ids: ["c1"] }).success).toBe(false);
  });
});

describe("ws ping frames", () => {
  it("parses each server frame", () => {
    expect(syncPingSchema.parse({ seq: 12, type: "sync" }).type).toBe("sync");
    expect(syncPingSchema.parse({ type: "capture" }).type).toBe("capture");
    expect(syncPingSchema.parse({ threadId: "th_1", type: "dispatch" }).type).toBe("dispatch");
    expect(syncPingSchema.parse({ type: "vault" }).type).toBe("vault");
  });

  it("reads a frame a newer worker grew, and a frame type it does not know is no frame", () => {
    expect(syncPingSchema.parse({ extra: true, seq: 1, type: "sync" })).toStrictEqual({
      seq: 1,
      type: "sync",
    });
    expect(syncPingSchema.safeParse({ type: "presence" }).success).toBe(false);
  });
});

// the vault routes' own decode: the search params whole, then the row's schema
const paramsOf = (uri: string | undefined): Record<string, string> => {
  if (uri === undefined) {
    throw new Error("the client sent no request");
  }
  return Object.fromEntries(new URL(uri).searchParams);
};

describe("vault read rows", () => {
  it("parses the tree page and the file", () => {
    const tree = vaultTreeResponseSchema.parse({
      commit: COMMIT,
      entries: [{ path: "notes/a.md", size: 12 }],
      next: null,
    });
    expect(tree.entries[0]?.path).toBe("notes/a.md");
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

  it("the asset query REQUIRES its ref — an unpinned asset URL is no cache key", () => {
    expect(vaultAssetQuerySchema.safeParse({ path: "a.png" }).success).toBe(false);
    expect(vaultAssetQuerySchema.safeParse({ path: "a.png", ref: COMMIT }).success).toBe(true);
    expect(vaultAssetQuerySchema.safeParse({ path: "../up.png", ref: COMMIT }).success).toBe(false);
    expect(vaultAssetQuerySchema.safeParse({ extra: 1, path: "a.png", ref: COMMIT }).success).toBe(
      false,
    );
  });

  it("decodes each query from the search params exactly as the client wrote it", async () => {
    const sent: string[] = [];
    const client = createCloudClient({
      baseUrl: "https://cloud.test",
      credential: `igd_${"a".repeat(64)}`,
      fetch: async (input) => {
        sent.push(input);
        return new Response(null, { status: 404 });
      },
    });
    const trees: VaultTreeQuery[] = [
      {},
      { limit: 7 },
      { after: "notes/α β&c=d+e.md", limit: 500, ref: COMMIT },
    ];
    for (const query of trees) {
      await client.vaultTree(query);
      expect(vaultTreeQuerySchema.parse(paramsOf(sent.pop()))).toEqual(query);
    }

    const files: VaultFileQuery[] = [{ path: "100%done.md" }, { path: "a b/c?.md", ref: COMMIT }];
    for (const query of files) {
      await client.vaultFile(query);
      expect(vaultFileQuerySchema.parse(paramsOf(sent.pop()))).toEqual(query);
    }

    const asset: VaultAssetQuery = { path: "media/α β#1.png", ref: COMMIT };
    expect(vaultAssetQuerySchema.parse(paramsOf(client.vaultAssetSource(asset).uri))).toEqual(
      asset,
    );
  });

  it("refuses a tree limit that is not a whole number in range", () => {
    for (const limit of ["", "0", "501", "1.5", "ten"]) {
      expect(vaultTreeQuerySchema.safeParse({ limit }).success).toBe(false);
    }
  });

  it("composes an asset source through the client — bearer in a header, never the URL", () => {
    const source = createCloudClient({
      baseUrl: "https://cloud.test",
      credential: `igd_${"a".repeat(64)}`,
    }).vaultAssetSource({ path: "media/α β.png", ref: COMMIT });
    const url = new URL(source.uri);
    expect(url.pathname).toBe(VAULT_API_PATHS.asset);
    expect(url.searchParams.get("path")).toBe("media/α β.png");
    expect(url.searchParams.get("ref")).toBe(COMMIT);
    expect(url.username).toBe("");
    expect(url.search).not.toContain("igd_");
    expect(source.headers).toEqual({ authorization: `Bearer igd_${"a".repeat(64)}` });
  });

  it("the asset allowlist answers a type or nothing — never a fallback", () => {
    expect(assetMediaType("media/diagram.png")).toBe("image/png");
    expect(assetMediaType("media/PHOTO.JPG")).toBe("image/jpeg");
    expect(assetMediaType("notes.md")).toBeNull();
    expect(assetMediaType("script.html")).toBeNull();
    expect(assetMediaType("no-extension")).toBeNull();
  });

  it("pins the asset allowlist WHOLE — growth is additive, removal never happens", () => {
    // hand-listed on purpose: removing an entry 400s every stale phone whose notes embed it
    expect(Object.fromEntries(VAULT_ASSET_MEDIA_TYPES)).toEqual({
      ".apng": "image/apng",
      ".avif": "image/avif",
      ".bmp": "image/bmp",
      ".gif": "image/gif",
      ".ico": "image/x-icon",
      ".jpeg": "image/jpeg",
      ".jpg": "image/jpeg",
      ".png": "image/png",
      ".svg": "image/svg+xml",
      ".webp": "image/webp",
    });
  });
});
