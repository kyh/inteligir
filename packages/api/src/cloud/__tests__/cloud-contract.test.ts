import { describe, expect, it } from "vitest";
import {
  ackCapturesRequestSchema,
  ackCapturesResponseSchema,
  captureRequestSchema,
} from "../captures/captures-schema";
import { cloudError, cloudErrorSchema } from "../cloud-errors";
import {
  buildPairApproveUrl,
  buildPairCallbackUrl,
  DEVICE_CREDENTIAL_PATTERN,
  generatePkceVerifier,
  mintPairingCodeRequestSchema,
  PAIR_APPROVE_PATH,
  PAIR_CALLBACK_PATH,
  PAIRING_CODE_PATTERN,
  pairApproveSearchSchema,
  pairRedirectUrlSchema,
  PKCE_S256_PATTERN,
  pkceChallengeS256,
  redeemDeviceRequestSchema,
} from "../pairing/pairing-schema";
import { EVENT_MAX_BYTES, pullQuerySchema, pushRequestSchema } from "../sync/sync-schema";
import { syncPingSchema } from "../sync/sync-ws";
import {
  assetMediaType,
  buildVaultAssetUrl,
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
    // Absent rather than null everywhere else — a client reading `deviceSeq`
    // on a pairing refusal is asking the wrong question.
    expect("deviceSeq" in cloudError("unauthorized", "nope").error).toBe(false);
  });
});

describe("pairing grammar", () => {
  it("accepts the minted shape and refuses ambiguous characters", () => {
    expect(PAIRING_CODE_PATTERN.test("K7QP-2M4X")).toBe(true);
    expect(PAIRING_CODE_PATTERN.test("K0QP-2M4X")).toBe(false);
    expect(PAIRING_CODE_PATTERN.test("k7qp-2m4x")).toBe(false);
  });

  it("trims what a human pastes", () => {
    const parsed = redeemDeviceRequestSchema.parse({
      code: " K7QP-2M4X ",
      deviceName: "  Kaiyu's MacBook ",
      verifier: "a".repeat(43),
    });
    expect(parsed.code).toBe("K7QP-2M4X");
    expect(parsed.deviceName).toBe("Kaiyu's MacBook");
  });

  it("pins the credential shape the server mints", () => {
    expect(DEVICE_CREDENTIAL_PATTERN.test(`igd_${"a".repeat(64)}`)).toBe(true);
    expect(DEVICE_CREDENTIAL_PATTERN.test(`igd_${"a".repeat(63)}`)).toBe(false);
    expect(DEVICE_CREDENTIAL_PATTERN.test("not-a-credential")).toBe(false);
  });
});

// The redirect allowlist is the ONE thing standing between the approve page
// and an open redirect that hands a live pairing code to whoever asked for
// one, so every refusal it makes is pinned here rather than left to the page
// that parses through it.
describe("the pairing redirect allowlist", () => {
  const OK = `http://127.0.0.1:4664${PAIR_CALLBACK_PATH}`;

  it("accepts the loopback callback on any port", () => {
    expect(pairRedirectUrlSchema.safeParse(OK).success).toBe(true);
    expect(pairRedirectUrlSchema.safeParse(`http://127.0.0.1:1${PAIR_CALLBACK_PATH}`).success).toBe(
      true,
    );
    expect(
      pairRedirectUrlSchema.safeParse(`http://127.0.0.1:65535${PAIR_CALLBACK_PATH}`).success,
    ).toBe(true);
  });

  it("refuses a USERINFO trick, which is the one that reads as loopback", () => {
    // `new URL` parses this to username "127.0.0.1" and hostname "evil.com" —
    // every check that matched the string rather than the field said yes.
    const trick = `http://127.0.0.1@evil.example:4664${PAIR_CALLBACK_PATH}`;
    expect(new URL(trick).username).toBe("127.0.0.1");
    expect(new URL(trick).hostname).toBe("evil.example");
    expect(pairRedirectUrlSchema.safeParse(trick).success).toBe(false);
    expect(
      pairRedirectUrlSchema.safeParse(`http://user:pass@127.0.0.1:4664${PAIR_CALLBACK_PATH}`)
        .success,
    ).toBe(false);
  });

  it("refuses a non-loopback host, however it is spelled", () => {
    for (const host of [
      "evil.example",
      "localhost",
      "[::1]",
      "127.0.0.1.evil.example",
      "0.0.0.0",
    ]) {
      expect(
        pairRedirectUrlSchema.safeParse(`http://${host}:4664${PAIR_CALLBACK_PATH}`).success,
        host,
      ).toBe(false);
    }
  });

  it("refuses https on loopback — TLS there is somebody else's server", () => {
    expect(
      pairRedirectUrlSchema.safeParse(`https://127.0.0.1:4664${PAIR_CALLBACK_PATH}`).success,
    ).toBe(false);
  });

  it("refuses any path but the callback's own", () => {
    for (const path of [
      "/",
      "/pair",
      "/pair/callback/",
      "/pair/callback/../evil",
      "/api/v1/vault",
    ]) {
      expect(pairRedirectUrlSchema.safeParse(`http://127.0.0.1:4664${path}`).success, path).toBe(
        false,
      );
    }
  });

  it("refuses a target that already carries a query or a fragment", () => {
    // The code and state are APPENDED to this URL; a target arriving with its
    // own parameters is a shape this flow never produces.
    expect(pairRedirectUrlSchema.safeParse(`${OK}?code=X`).success).toBe(false);
    expect(pairRedirectUrlSchema.safeParse(`${OK}#x`).success).toBe(false);
  });

  it("leaves the port alone, default included — loopback is loopback", () => {
    // `URL` normalises `:80` away for http, so a rule demanding an explicit
    // port would make an app bound to 80 impossible to pair at all, and would
    // refuse nothing dangerous in exchange.
    expect(pairRedirectUrlSchema.safeParse(`http://127.0.0.1${PAIR_CALLBACK_PATH}`).success).toBe(
      true,
    );
  });

  it("refuses anything that is not an absolute URL", () => {
    expect(pairRedirectUrlSchema.safeParse("not a url").success).toBe(false);
    expect(pairRedirectUrlSchema.safeParse(`//127.0.0.1:4664${PAIR_CALLBACK_PATH}`).success).toBe(
      false,
    );
    expect(pairRedirectUrlSchema.safeParse(PAIR_CALLBACK_PATH).success).toBe(false);
  });

  it("gates the approve page's whole search, and strips what it does not know", () => {
    const challenge = "a".repeat(43);
    const parsed = pairApproveSearchSchema.parse({
      redirect: OK,
      state: "0".repeat(32),
      name: "  Work laptop ",
      challenge,
      utm_source: "somewhere",
    });
    expect(parsed).toEqual({ redirect: OK, state: "0".repeat(32), name: "Work laptop", challenge });
    // A missing challenge is refused: the approve page must forward one.
    expect(
      pairApproveSearchSchema.safeParse({ redirect: OK, state: "0".repeat(32), name: "Laptop" })
        .success,
    ).toBe(false);
    expect(
      pairApproveSearchSchema.safeParse({
        redirect: OK,
        state: "short",
        name: "Laptop",
        challenge,
      }).success,
    ).toBe(false);
  });

  it("round-trips through the two builders both ends compose with", () => {
    const challenge = "b".repeat(43);
    const approve = new URL(
      buildPairApproveUrl("https://cloud.test", {
        redirect: OK,
        state: "a".repeat(32),
        name: "Laptop",
        challenge,
      }),
    );
    expect(approve.pathname).toBe(PAIR_APPROVE_PATH);
    expect(pairApproveSearchSchema.parse(Object.fromEntries(approve.searchParams))).toEqual({
      redirect: OK,
      state: "a".repeat(32),
      name: "Laptop",
      challenge,
    });

    const callback = new URL(
      buildPairCallbackUrl(OK, { code: "ABCD-EFGH", state: "a".repeat(32) }),
    );
    expect(callback.origin).toBe("http://127.0.0.1:4664");
    expect(callback.pathname).toBe(PAIR_CALLBACK_PATH);
    expect(callback.searchParams.get("code")).toBe("ABCD-EFGH");
    expect(callback.searchParams.get("state")).toBe("a".repeat(32));
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
    // Without it the server cannot tell a delayed retry from the newest fact,
    // so the field is required rather than defaulted.
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
    // Each of these is ONE UTF-16 unit and THREE UTF-8 bytes. A length-based
    // ceiling would wave through a body three times the size storage pays for.
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
    // An aggregate count cannot say WHICH apply committed, so there is no
    // shape here that admits one.
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

// Final at birth: `.strict()` responses mean a stale phone's parse REFUSES an
// added field as malformed, so these pins are the shapes' whole lives.
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

  it("round-trips the asset URL through the one builder the phone composes with", () => {
    const url = new URL(
      buildVaultAssetUrl("https://cloud.test", { path: "media/α β.png", ref: COMMIT }),
    );
    expect(url.pathname).toBe(VAULT_API_PATHS.asset);
    expect(url.searchParams.get("path")).toBe("media/α β.png");
    expect(url.searchParams.get("ref")).toBe(COMMIT);
  });

  it("the asset allowlist answers a type or nothing — never a fallback", () => {
    expect(assetMediaType("media/diagram.png")).toBe("image/png");
    expect(assetMediaType("media/PHOTO.JPG")).toBe("image/jpeg");
    expect(assetMediaType("notes.md")).toBeNull();
    expect(assetMediaType("script.html")).toBeNull();
    expect(assetMediaType("no-extension")).toBeNull();
  });

  it("pins the asset allowlist WHOLE — growth is additive, removal never happens", () => {
    // The table is the deployed /v1/vault/asset wire's behavior, shared with
    // the desktop route: add a row here WITH the new entry; removing one
    // 400s every stale phone whose notes embed that type. This pin is what
    // turns a local-side "cleanup" of the shared table into a failing test.
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

// PKCE binds the one-time code to the app that began the pairing — the whole of
// what makes an intercepted code useless without the verifier the app kept.
describe("PKCE (S256)", () => {
  it("generates a verifier in the base64url shape both ends expect", () => {
    const verifier = generatePkceVerifier();
    expect(PKCE_S256_PATTERN.test(verifier)).toBe(true);
    // Fresh every call — a fixed verifier would be a fixed secret.
    expect(generatePkceVerifier()).not.toBe(verifier);
  });

  it("computes the challenge the same way every time, and it is base64url", async () => {
    const verifier = generatePkceVerifier();
    const challenge = await pkceChallengeS256(verifier);
    expect(PKCE_S256_PATTERN.test(challenge)).toBe(true);
    expect(await pkceChallengeS256(verifier)).toBe(challenge);
    // A different verifier hashes to a different challenge.
    expect(await pkceChallengeS256(generatePkceVerifier())).not.toBe(challenge);
  });

  it("matches RFC 7636's own S256 test vector", async () => {
    // Appendix B: verifier "dBjft...v-a" -> challenge "E9Melhoa...M".
    const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
    expect(await pkceChallengeS256(verifier)).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
  });

  it("mint demands an S256 challenge, and refuses a plain or absent one", () => {
    const challenge = "c".repeat(43);
    expect(
      mintPairingCodeRequestSchema.safeParse({ challenge, challengeMethod: "S256" }).success,
    ).toBe(true);
    // plain is refused — a challenge equal to its verifier binds nothing.
    expect(
      mintPairingCodeRequestSchema.safeParse({ challenge, challengeMethod: "plain" }).success,
    ).toBe(false);
    // absent challenge, and a challenge that is not base64url of a SHA-256.
    expect(mintPairingCodeRequestSchema.safeParse({ challengeMethod: "S256" }).success).toBe(false);
    expect(
      mintPairingCodeRequestSchema.safeParse({ challenge: "short", challengeMethod: "S256" })
        .success,
    ).toBe(false);
  });

  it("redeem requires the verifier — the code alone no longer parses", () => {
    const base = { code: "ABCD-EFGH", deviceName: "Laptop" };
    expect(redeemDeviceRequestSchema.safeParse(base).success).toBe(false);
    expect(redeemDeviceRequestSchema.safeParse({ ...base, verifier: "d".repeat(43) }).success).toBe(
      true,
    );
    // A verifier that is not base64url of 32 bytes is refused at the boundary.
    expect(redeemDeviceRequestSchema.safeParse({ ...base, verifier: "nope" }).success).toBe(false);
  });
});
