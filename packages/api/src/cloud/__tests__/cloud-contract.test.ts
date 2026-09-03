import { describe, expect, it } from "vitest";
import {
  ackCapturesRequestSchema,
  ackCapturesResponseSchema,
  captureRequestSchema,
} from "../captures/captures-schema";
import { CLOUD_ERROR_CODES, cloudError, cloudErrorSchema } from "../cloud-errors";
import {
  DEVICE_CREDENTIAL_PATTERN,
  DEVICE_LOGIN_REFUSALS,
  DEVICE_NAME_MAX_LENGTH,
  deviceLoginRequestSchema,
  deviceLoginResponseSchema,
  isDeviceLoginRefusal,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
} from "../device/device-schema";
import { createCloudClient } from "../cloud-client";
import { EVENT_MAX_BYTES, pullQuerySchema, pushRequestSchema } from "../sync/sync-schema";
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

describe("error envelope", () => {
  it("round-trips through its own schema", () => {
    const envelope = cloudError("unauthorized", "no device credential");
    expect(cloudErrorSchema.parse(envelope)).toEqual(envelope);
  });

  it("refuses an unknown code", () => {
    expect(cloudErrorSchema.safeParse({ error: { code: "teapot", message: "" } }).success).toBe(
      false,
    );
  });

  it("names the outbox position on a sync refusal", () => {
    const envelope = cloudError("sync-conflict", "already stored with a different body", 7);
    expect(cloudErrorSchema.parse(envelope).error.deviceSeq).toBe(7);
    expect("deviceSeq" in cloudError("unauthorized", "nope").error).toBe(false);
  });
});

describe("device login", () => {
  const LOGIN = {
    email: "owner@example.test",
    password: "correct horse battery",
    deviceName: "Laptop",
  };

  it("folds the email the way the account stores it, and trims what a human pastes", () => {
    const parsed = deviceLoginRequestSchema.parse({
      ...LOGIN,
      email: "  Owner@Example.TEST ",
      deviceName: "  Kaiyu's MacBook ",
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
    const answer = { deviceId: "dev_1", credential: `igd_${"a".repeat(64)}` };
    expect(deviceLoginResponseSchema.parse(answer)).toEqual(answer);
    expect(deviceLoginResponseSchema.safeParse({ ...answer, token: "x" }).success).toBe(false);
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
          threadId: "th_1",
          deviceSeq: 1,
          event: { type: "turn/started", nested: [1, "x", null] },
          createdAt: 1,
        },
      ],
      threads: [{ threadId: "th_1", lane: "desktop", title: "Fix the build", updatedAt: 1 }],
    });
    expect(result.success).toBe(true);
  });

  it("demands the client's own timestamp on a metadata upsert", () => {
    const result = pushRequestSchema.safeParse({
      events: [],
      threads: [{ threadId: "th_1", lane: "desktop" }],
    });
    expect(result.success).toBe(false);
  });

  it("refuses an event body over the byte ceiling", () => {
    const result = pushRequestSchema.safeParse({
      events: [
        { threadId: "th_1", deviceSeq: 1, event: "x".repeat(EVENT_MAX_BYTES + 1), createdAt: 1 },
      ],
    });
    expect(result.success).toBe(false);
  });

  it("measures the ceiling in UTF-8 bytes, not UTF-16 units", () => {
    // "あ" is one UTF-16 unit and three UTF-8 bytes
    const wide = "あ".repeat(EVENT_MAX_BYTES / 3);
    expect(wide.length).toBeLessThan(EVENT_MAX_BYTES);
    const result = pushRequestSchema.safeParse({
      events: [{ threadId: "th_1", deviceSeq: 1, event: wide, createdAt: 1 }],
    });
    expect(result.success).toBe(false);
  });

  it("refuses a non-JSON event body", () => {
    const result = pushRequestSchema.safeParse({
      events: [{ threadId: "th_1", deviceSeq: 1, event: undefined, createdAt: 1 }],
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
      captureRequestSchema.safeParse({ text: "buy oat milk", idempotencyKey: "k".repeat(8) })
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
    expect(syncPingSchema.parse({ type: "sync", seq: 12 }).type).toBe("sync");
    expect(syncPingSchema.parse({ type: "capture" }).type).toBe("capture");
    expect(syncPingSchema.parse({ type: "dispatch", threadId: "th_1" }).type).toBe("dispatch");
    expect(syncPingSchema.parse({ type: "vault" }).type).toBe("vault");
  });

  it("refuses a frame with extra fields — the server owns this boundary", () => {
    expect(syncPingSchema.safeParse({ type: "sync", seq: 1, extra: true }).success).toBe(false);
  });
});

describe("vault read rows", () => {
  const COMMIT = "a".repeat(40);

  it("parses the tree page and the file", () => {
    const tree = vaultTreeResponseSchema.parse({
      commit: COMMIT,
      entries: [{ path: "notes/a.md", size: 12 }],
      next: null,
    });
    expect(tree.entries[0]?.path).toBe("notes/a.md");
    const file = vaultFileResponseSchema.parse({
      commit: COMMIT,
      path: "notes/a.md",
      oid: "b".repeat(40),
      content: "# a\n",
    });
    expect(file.content).toBe("# a\n");
  });

  it("refuses an added field — the never-break rule made these final", () => {
    expect(
      vaultTreeResponseSchema.safeParse({ commit: COMMIT, entries: [], next: null, extra: 1 })
        .success,
    ).toBe(false);
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
    expect(vaultAssetQuerySchema.safeParse({ path: "a.png", ref: COMMIT, extra: 1 }).success).toBe(
      false,
    );
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
