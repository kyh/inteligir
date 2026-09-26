import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  ACCOUNT_API_PATHS,
  accountResponseSchema,
  DELETE_ACCOUNT_REFUSALS,
  deleteAccountRequestSchema,
  deleteAccountResponseSchema,
  deviceSignUpRequestSchema,
  isDeleteAccountRefusal,
  signUpRequestSchema,
} from "../account/account-schema";
import {
  ackCapturesRequestSchema,
  ackCapturesResponseSchema,
  captureRequestSchema,
  captureResponseSchema,
  claimCapturesResponseSchema,
} from "../captures/captures-schema";
import {
  CLOUD_ERROR_CODES,
  CLOUD_ERROR_STATUS,
  cloudError,
  cloudErrorSchema,
} from "../cloud-errors";
import {
  ackDispatchesRequestSchema,
  ackDispatchesResponseSchema,
  cancelDispatchRequestSchema,
  cancelDispatchResponseSchema,
  claimDispatchesRequestSchema,
  claimDispatchesResponseSchema,
  closeApprovalRequestSchema,
  closeApprovalResponseSchema,
  createDispatchRequestSchema,
  createDispatchResponseSchema,
  DISPATCH_API_PATHS,
  DISPATCH_CLAIM_DEFAULT_LIMIT,
  DISPATCH_MAX_CHARS,
  dispatchStatusRequestSchema,
  dispatchStatusResponseSchema,
  listApprovalsResponseSchema,
  openApprovalRequestSchema,
  openApprovalResponseSchema,
} from "../dispatch/dispatch-schema";
import type {
  AckDispatchesRequest,
  CreateDispatchRequest,
  OpenApprovalRequest,
} from "../dispatch/dispatch-schema";
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
} from "../device/device-schema";
import { createCloudClient, readCloudCall } from "../cloud-client";
import type { CloudFailure, CloudFetch } from "../cloud-client";
import {
  EVENT_MAX_BYTES,
  pullQuerySchema,
  pullResponseSchema,
  pushRequestSchema,
  pushResponseSchema,
} from "../sync/sync-schema";
import { syncPingSchema } from "../sync/sync-ws";
import {
  VAULT_COMMIT_MAX_CHANGES,
  vaultCollisionKey,
  vaultCommitRequestSchema,
  vaultCommitResponseSchema,
  vaultConflictAnswerSchema,
} from "../vault/vault-commit-schema";
import type { VaultCommitRequest } from "../vault/vault-commit-schema";
import {
  assetMediaType,
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
} from "../vault/vault-schema";
import type {
  VaultAssetQuery,
  VaultFileQuery,
  VaultFilesRequest,
  VaultTreeQuery,
} from "../vault/vault-schema";

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

  it("reads a request that never left as unreachable, for a reader with no client", async () => {
    const result = await readCloudCall(async () => {
      throw new TypeError("Failed to fetch");
    }, accountResponseSchema);
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
const DISPATCH_ID = "d".repeat(32);
const APPROVAL_ID = "a".repeat(32);
const APPROVAL_PAYLOAD = {
  availableDecisions: ["allow_once", "deny"],
  kind: "approval",
  reason: null,
  subject: { command: "make notes", cwd: null, itemId: "item_1", kind: "command" },
} satisfies OpenApprovalRequest["payload"];

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
  ["an account deletion", deleteAccountResponseSchema, { deleted: true }],
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
  ["a sync ping", syncPingSchema, { seq: 1, type: "sync" }],
  ["a dispatch ping", syncPingSchema, { threadId: "th_1", type: "dispatch" }],
  [
    "a dispatch created",
    createDispatchResponseSchema,
    { dispatch: { id: DISPATCH_ID, state: "waiting" }, duplicate: false },
  ],
  [
    "a dispatch claim",
    claimDispatchesResponseSchema,
    {
      claimToken: "tok",
      dispatches: [
        {
          createdAt: 1,
          id: DISPATCH_ID,
          kind: "turn",
          originDocPath: "notes/Week.md",
          text: "summarise this week",
          threadId: "thr_1",
          viewContext: { resource: "notes/Week.md", revision: "c".repeat(64), surface: "doc" },
        },
        {
          approvalId: APPROVAL_ID,
          createdAt: 2,
          decision: "allow_once",
          id: "e".repeat(32),
          kind: "answer",
          threadId: "thr_1",
        },
      ],
      expiresAt: 3,
    },
  ],
  [
    "a dispatch ack",
    ackDispatchesResponseSchema,
    { results: [{ id: DISPATCH_ID, outcome: "recorded" }] },
  ],
  [
    "a dispatch status",
    dispatchStatusResponseSchema,
    {
      desktopsDeclining: 0,
      desktopsOnline: 1,
      dispatches: [
        { id: DISPATCH_ID, state: "claimed" },
        { id: "e".repeat(32), message: "That conversation is archived.", state: "refused" },
      ],
    },
  ],
  ["a dispatch cancel", cancelDispatchResponseSchema, { outcome: "cancelled" }],
  ["an approval opened", openApprovalResponseSchema, { duplicate: false, state: "open" }],
  ["an approval closed", closeApprovalResponseSchema, { outcome: "closed" }],
  [
    "the open approvals",
    listApprovalsResponseSchema,
    {
      approvals: [
        {
          createdAt: 1,
          id: APPROVAL_ID,
          payload: APPROVAL_PAYLOAD,
          state: "answered",
          threadId: "thr_1",
          turnId: "turn_1",
        },
      ],
    },
  ],
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

  it("deletes the account with its own credential and the password asked again", async () => {
    const seen: { path: string; authorization: string | null; body: unknown }[] = [];
    const credential = `igd_${"a".repeat(64)}`;
    const password = " the password, spaces kept ";
    const result = await createCloudClient({
      baseUrl: "https://cloud.test",
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
    });
    expect(result.success).toBe(true);
  });

  it("still reads a 0.4.0 push, whose threads half carries each thread's lane", () => {
    const stale = {
      events: [{ createdAt: 1, deviceSeq: 1, event: { type: "thread/meta" }, threadId: "th_1" }],
      threads: [
        { lane: "desktop", threadId: "th_1", title: "Fix the build", updatedAt: 1 },
        { lane: "any", threadId: "th_2", updatedAt: 2 },
      ],
    };
    expect(pushRequestSchema.safeParse(stale).success).toBe(true);
    expect(pushRequestSchema.safeParse({ ...stale, lanes: [] }).success).toBe(false);
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

describe("the dispatch inbox", () => {
  const TURN: CreateDispatchRequest = {
    id: DISPATCH_ID,
    kind: "turn",
    originDocPath: "notes/Week.md",
    text: "summarise this week",
    threadId: "thr_1",
    viewContext: { resource: "notes/Week.md", revision: "c".repeat(64), surface: "doc" },
  };
  const ANSWER: CreateDispatchRequest = {
    approvalId: APPROVAL_ID,
    decision: "allow_once",
    id: "e".repeat(32),
    kind: "answer",
  };
  const APPROVAL: OpenApprovalRequest = {
    id: APPROVAL_ID,
    payload: APPROVAL_PAYLOAD,
    threadId: "thr_1",
    turnId: "turn_1",
  };
  const ACK: AckDispatchesRequest = {
    claimToken: "tok",
    results: [
      { id: DISPATCH_ID, outcome: "delivered" },
      { id: "e".repeat(32), message: "That conversation is archived.", outcome: "refused" },
    ],
  };

  it("reads every request it sends as exactly that request", () => {
    expect(createDispatchRequestSchema.parse(TURN)).toStrictEqual(TURN);
    expect(createDispatchRequestSchema.parse(ANSWER)).toStrictEqual(ANSWER);
    expect(openApprovalRequestSchema.parse(APPROVAL)).toStrictEqual(APPROVAL);
    expect(ackDispatchesRequestSchema.parse(ACK)).toStrictEqual(ACK);
    expect(dispatchStatusRequestSchema.parse({ ids: [DISPATCH_ID] })).toStrictEqual({
      ids: [DISPATCH_ID],
    });
    expect(cancelDispatchRequestSchema.parse({ id: DISPATCH_ID })).toStrictEqual({
      id: DISPATCH_ID,
    });
    expect(closeApprovalRequestSchema.parse({ id: APPROVAL_ID })).toStrictEqual({
      id: APPROVAL_ID,
    });
    expect(claimDispatchesRequestSchema.parse({})).toStrictEqual({
      limit: DISPATCH_CLAIM_DEFAULT_LIMIT,
    });
  });

  it("refuses a turn it cannot read exactly", () => {
    const refused = [
      { ...TURN, id: "D".repeat(32) },
      { ...TURN, id: "d".repeat(31) },
      { ...TURN, originDocPath: "notes//Week.md" },
      {
        ...TURN,
        viewContext: { resource: "/etc/passwd", revision: "c".repeat(64), surface: "doc" },
      },
      { ...TURN, viewContext: { resource: "notes/Week.md", revision: "HEAD", surface: "doc" } },
      { ...TURN, text: "" },
      { ...TURN, text: "x".repeat(DISPATCH_MAX_CHARS + 1) },
      { ...TURN, threadId: "" },
      { ...TURN, lane: "desktop" },
      { ...ANSWER, decision: "allow_forever" },
      { ...ANSWER, kind: "cancel" },
    ];
    for (const body of refused) {
      expect(createDispatchRequestSchema.safeParse(body).success, JSON.stringify(body)).toBe(false);
    }
  });

  it("demands a refusal's reason, and gives no other outcome one", () => {
    expect(
      ackDispatchesRequestSchema.safeParse({
        claimToken: "tok",
        results: [{ id: DISPATCH_ID, outcome: "refused" }],
      }).success,
    ).toBe(false);
    expect(
      ackDispatchesRequestSchema.safeParse({
        claimToken: "tok",
        results: [{ id: DISPATCH_ID, message: "fine", outcome: "delivered" }],
      }).success,
    ).toBe(false);
    expect(
      dispatchStatusResponseSchema.safeParse({
        desktopsDeclining: 0,
        desktopsOnline: 0,
        dispatches: [{ id: DISPATCH_ID, state: "refused" }],
      }).success,
    ).toBe(false);
  });

  it("posts each call where the route reads it, a body the route decodes to exactly the request", async () => {
    const seen: { body: unknown; method: string; path: string }[] = [];
    const client = createCloudClient({
      baseUrl: "https://cloud.test",
      credential: `igd_${"a".repeat(64)}`,
      fetch: async (input, init) => {
        seen.push({
          body: init?.body === undefined ? undefined : JSON.parse(String(init.body)),
          method: init?.method ?? "GET",
          path: new URL(input).pathname,
        });
        return Response.json({});
      },
    });
    await client.createDispatch(TURN);
    await client.claimDispatches(5);
    await client.ackDispatches(ACK);
    await client.dispatchStatus([DISPATCH_ID]);
    await client.cancelDispatch(DISPATCH_ID);
    await client.openApproval(APPROVAL);
    await client.closeApproval(APPROVAL_ID);
    await client.listApprovals();

    expect(seen.map(({ method, path }) => `${method} ${path}`)).toEqual([
      `POST ${DISPATCH_API_PATHS.dispatch}`,
      `POST ${DISPATCH_API_PATHS.claim}`,
      `POST ${DISPATCH_API_PATHS.ack}`,
      `POST ${DISPATCH_API_PATHS.status}`,
      `POST ${DISPATCH_API_PATHS.cancel}`,
      `POST ${DISPATCH_API_PATHS.approval}`,
      `POST ${DISPATCH_API_PATHS.approvalClose}`,
      `GET ${DISPATCH_API_PATHS.approvals}`,
    ]);
    const decoded = [
      createDispatchRequestSchema.parse(seen[0]?.body),
      claimDispatchesRequestSchema.parse(seen[1]?.body),
      ackDispatchesRequestSchema.parse(seen[2]?.body),
      dispatchStatusRequestSchema.parse(seen[3]?.body),
      cancelDispatchRequestSchema.parse(seen[4]?.body),
      openApprovalRequestSchema.parse(seen[5]?.body),
      closeApprovalRequestSchema.parse(seen[6]?.body),
    ];
    expect(decoded).toStrictEqual([
      TURN,
      { limit: 5 },
      ACK,
      { ids: [DISPATCH_ID] },
      { id: DISPATCH_ID },
      APPROVAL,
      { id: APPROVAL_ID },
    ]);
    expect(seen[7]?.body).toBeUndefined();
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
    await client.vaultAsset(asset);
    expect(vaultAssetQuerySchema.parse(paramsOf(sent.pop()))).toEqual(asset);
  });

  it("refuses a tree limit that is not a whole number in range", () => {
    for (const limit of ["", "0", "501", "1.5", "ten"]) {
      expect(vaultTreeQuerySchema.safeParse({ limit }).success).toBe(false);
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

describe("an attachment's bytes", () => {
  const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const CREDENTIAL = `igd_${"a".repeat(64)}`;
  const QUERY: VaultAssetQuery = { path: "media/α β.png", ref: COMMIT };

  const assetOver = async (fetch: CloudFetch) =>
    await createCloudClient({
      baseUrl: "https://cloud.test",
      credential: CREDENTIAL,
      fetch,
    }).vaultAsset(QUERY);

  it("answers the bytes under the allowlist's type, the bearer in a header, never the URL", async () => {
    const seen: { authorization: string | null; uri: string }[] = [];
    const result = await assetOver(async (input, init) => {
      seen.push({ authorization: new Headers(init?.headers).get("authorization"), uri: input });
      return new Response(PNG, { headers: { "content-type": "image/png" } });
    });
    expect(result).toStrictEqual({ ok: true, value: { bytes: PNG, mediaType: "image/png" } });
    expect(seen.map((request) => request.authorization)).toStrictEqual([`Bearer ${CREDENTIAL}`]);
    const url = new URL(seen[0]?.uri ?? "");
    expect(url.pathname).toBe(VAULT_API_PATHS.asset);
    expect(url.searchParams.get("path")).toBe(QUERY.path);
    expect(url.searchParams.get("ref")).toBe(COMMIT);
    expect(url.username).toBe("");
    expect(url.search).not.toContain("igd_");
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
        deviceSeq: null,
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
        deviceSeq: null,
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
        deviceSeq: null,
        kind: "refused",
        message: "no",
      });
    }
  });
});
