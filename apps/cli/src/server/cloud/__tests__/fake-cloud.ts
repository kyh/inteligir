// An in-process stand-in for the cloud Worker, implementing
// `@repo/api/cloud` over Maps.
//
// WHAT THIS IS AND IS NOT. It is not a second reading of the contract: every
// request is parsed and every response is built with the contract's OWN
// schemas and paths, so a shape that drifts fails here too. It is also not the
// deployed Worker — `apps/web/src/worker/__tests__/thread-sync.test.ts` drives
// that against real D1 and a real Durable Object, and this file exists for the
// other half of the wire, which that suite cannot reach (it runs on workerd
// and the client is a Node process with better-sqlite3 in it).
//
// So the rules it reimplements are exactly the ones the CLIENT's behaviour
// hangs on, and each is written the way the DO writes it:
//   • a stored position replayed with the SAME body is a duplicate, with a
//     DIFFERENT body a `sync-conflict`;
//   • a new position at or below the device's high-water is
//     `sync-out-of-order`, and a batch that is not sorted is refused whole;
//   • the merged log is one global `seq` across devices, paged by it;
//   • a capture is claimed by exactly one device for a window, and an ack
//     deletes only what that claim still owns.

import {
  ackCapturesRequestSchema,
  CAPTURE_API_PATHS,
  CAPTURE_CLAIM_TTL_MS,
  claimCapturesRequestSchema,
  type AckCapturesResponse,
  type CaptureRow,
  type ClaimCapturesResponse,
} from "@repo/api/cloud/captures/captures-schema";
import { cloudError, type CloudErrorCode } from "@repo/api/cloud/errors";
import {
  DEVICE_API_PATHS,
  DEVICE_CREDENTIAL_PREFIX,
  pkceChallengeS256,
  redeemDeviceRequestSchema,
  type RedeemDeviceResponse,
} from "@repo/api/cloud/pairing/pairing-schema";
import {
  pullQuerySchema,
  pushRequestSchema,
  SYNC_API_PATHS,
  type PullResponse,
  type PushResponse,
  type SyncEventRow,
} from "@repo/api/cloud/sync/sync-schema";
import type { CloudFetch } from "../cloud-client";
import { z } from "zod";

/** A decoded request body, before a route's schema reads it. */
type RequestBody = z.infer<ReturnType<typeof z.json>>;

/** One row of an ack answer, as the contract spells it. */
type AckCaptureResult = AckCapturesResponse["results"][number];

const STATUS_BY_CODE = {
  "bad-request": 400,
  unauthorized: 401,
  "not-found": 404,
  "rate-limited": 429,
  "invalid-code": 404,
  "code-expired": 410,
  "code-consumed": 409,
  "device-limit": 409,
  "sync-conflict": 409,
  "sync-out-of-order": 409,
  "account-deleted": 410,
  "file-too-large": 413,
  internal: 500,
} satisfies Record<CloudErrorCode, number>;

function refuse(code: CloudErrorCode, message: string, deviceSeq?: number): Response {
  return Response.json(cloudError(code, message, deviceSeq), { status: STATUS_BY_CODE[code] });
}

interface LogRow {
  seq: number;
  threadId: string;
  deviceId: string;
  deviceSeq: number;
  /** The bytes as STORED — the string the conflict rule compares. */
  body: string;
  createdAt: number;
}

interface InboxRow {
  id: string;
  text: string;
  createdAt: number;
  claimToken: string | null;
  claimedAt: number;
}

export class FakeCloud {
  private readonly devices = new Map<string, { deviceId: string; revoked: boolean }>();
  private readonly codes = new Map<string, string>();
  private readonly log: LogRow[] = [];
  private readonly inbox: InboxRow[] = [];
  private nextDevice = 0;
  private nextSeq = 0;
  private nextCapture = 0;
  /** Every request this cloud received, so a suite can assert that an unpaired
   *  install made NONE. */
  readonly requests: string[] = [];
  /** Set to fail the next push after storing its prefix — the interrupted-push
   *  case, which the wire cannot otherwise produce on demand. */
  dropNextPushResponse = false;

  /** Mint a code bound to a PKCE challenge, exactly as the approve page does.
   *  The challenge comes off the approve URL `beginPair` answered, so a test
   *  registers it AFTER begin — the app kept the verifier, the browser only
   *  ever carried the hash. */
  mintCode(code: string, challenge: string): void {
    this.codes.set(code, challenge);
  }

  /** Revoke as the dashboard does: the credential stops verifying at once. */
  revoke(deviceId: string): void {
    for (const device of this.devices.values()) {
      if (device.deviceId === deviceId) {
        device.revoked = true;
      }
    }
  }

  /** Seed the capture inbox the way a phone's quick capture would. */
  capture(text: string): string {
    this.nextCapture += 1;
    const id = `cap_${this.nextCapture}`;
    this.inbox.push({ id, text, createdAt: this.nextCapture, claimToken: null, claimedAt: 0 });
    return id;
  }

  /** Expire every live claim, as the TTL does for a device that died holding
   *  one — the only way a capture is delivered twice. */
  lapseClaims(): void {
    for (const row of this.inbox) {
      row.claimedAt = 0;
    }
  }

  logSize(): number {
    return this.log.length;
  }

  /** How many devices have redeemed against this cloud — a signal a test can
   *  wait on to know a re-pair's redeem actually landed here. */
  deviceCount(): number {
    return this.devices.size;
  }

  readonly fetch: CloudFetch = async (input, init) => {
    const url = new URL(input);
    const method = init?.method ?? "GET";
    this.requests.push(`${method} ${url.pathname}`);
    const text = z.string().safeParse(init?.body);
    const body: RequestBody = text.success ? JSON.parse(text.data) : null;

    if (method === "POST" && url.pathname === DEVICE_API_PATHS.redeem) {
      return await this.redeem(body);
    }

    const device = this.authorize(init);
    if (device === null) {
      return refuse("unauthorized", "No valid device credential.");
    }
    if (method === "POST" && url.pathname === SYNC_API_PATHS.push) {
      return this.push(device.deviceId, body);
    }
    if (method === "GET" && url.pathname === SYNC_API_PATHS.pull) {
      return this.pull(url);
    }
    if (method === "POST" && url.pathname === CAPTURE_API_PATHS.claim) {
      return this.claim(body);
    }
    if (method === "POST" && url.pathname === CAPTURE_API_PATHS.ack) {
      return this.ack(body);
    }
    return refuse("not-found", "No such route.");
  };

  private authorize(init: RequestInit | undefined): { deviceId: string } | null {
    const headers = init?.headers;
    const authorization = z
      .string()
      .safeParse(
        headers !== undefined && !Array.isArray(headers) && !(headers instanceof Headers)
          ? headers.authorization
          : undefined,
      );
    if (!authorization.success) {
      return null;
    }
    const credential = authorization.data.replace(/^Bearer /u, "");
    const device = this.devices.get(credential);
    if (device === undefined || device.revoked) {
      return null;
    }
    return { deviceId: device.deviceId };
  }

  private async redeem(body: RequestBody): Promise<Response> {
    const parsed = redeemDeviceRequestSchema.safeParse(body);
    if (!parsed.success) {
      return refuse("bad-request", "Send { code, deviceName, verifier }.");
    }
    const challenge = this.codes.get(parsed.data.code);
    if (challenge === undefined) {
      return refuse("invalid-code", "That pairing code isn't valid.");
    }
    // PKCE, the worker's check mirrored: an intercepted code with the wrong (or
    // no) verifier answers invalid-code and does NOT consume the code, so the
    // real app's redeem still lands.
    if ((await pkceChallengeS256(parsed.data.verifier)) !== challenge) {
      return refuse("invalid-code", "That pairing code isn't valid.");
    }
    this.codes.delete(parsed.data.code);
    this.nextDevice += 1;
    const deviceId = `dev_${this.nextDevice}`;
    const credential = `${DEVICE_CREDENTIAL_PREFIX}${String(this.nextDevice).padStart(64, "0")}`;
    this.devices.set(credential, { deviceId, revoked: false });
    const response: RedeemDeviceResponse = { deviceId, credential };
    return Response.json(response);
  }

  private push(deviceId: string, body: RequestBody): Response {
    const parsed = pushRequestSchema.safeParse(body);
    if (!parsed.success) {
      return refuse("bad-request", "Malformed push batch.");
    }
    const events = parsed.data.events;
    for (const [index, event] of events.entries()) {
      const previous = index === 0 ? undefined : events[index - 1];
      if (previous !== undefined && event.deviceSeq <= previous.deviceSeq) {
        return refuse(
          "sync-out-of-order",
          "Batch positions must strictly increase.",
          event.deviceSeq,
        );
      }
    }
    const mine = this.log.filter((row) => row.deviceId === deviceId);
    const highWater = mine.reduce((high, row) => Math.max(high, row.deviceSeq), 0);
    let accepted = 0;
    let duplicates = 0;
    for (const event of events) {
      const serialized = JSON.stringify(event.event);
      const stored = mine.find((row) => row.deviceSeq === event.deviceSeq);
      if (stored !== undefined) {
        if (stored.body !== serialized) {
          return refuse(
            "sync-conflict",
            "That outbox position is already stored with a different body.",
            event.deviceSeq,
          );
        }
        duplicates += 1;
        continue;
      }
      if (highWater > 0 && event.deviceSeq <= highWater) {
        return refuse(
          "sync-out-of-order",
          "That outbox position is below this device's high-water mark.",
          event.deviceSeq,
        );
      }
      this.nextSeq += 1;
      this.log.push({
        seq: this.nextSeq,
        threadId: event.threadId,
        deviceId,
        deviceSeq: event.deviceSeq,
        body: serialized,
        createdAt: event.createdAt,
      });
      accepted += 1;
      if (this.dropNextPushResponse) {
        // The prefix is stored and the caller never learns it — a connection
        // that died after the write landed, which is the shape acceptance #3
        // is about.
        this.dropNextPushResponse = false;
        throw new Error("connection reset");
      }
    }
    const response: PushResponse = { accepted, duplicates, lastSeq: this.nextSeq };
    return Response.json(response);
  }

  private pull(url: URL): Response {
    const query = pullQuerySchema.safeParse(Object.fromEntries(url.searchParams));
    if (!query.success) {
      return refuse("bad-request", "Malformed pull cursor.");
    }
    const { afterSeq, limit } = query.data;
    const rows = this.log.filter((row) => row.seq > afterSeq).slice(0, limit + 1);
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const events: SyncEventRow[] = page.map((row) => ({
      seq: row.seq,
      threadId: row.threadId,
      deviceId: row.deviceId,
      deviceSeq: row.deviceSeq,
      event: JSON.parse(row.body),
      createdAt: row.createdAt,
    }));
    const response: PullResponse = { events, lastSeq: this.nextSeq, hasMore };
    return Response.json(response);
  }

  private claim(body: RequestBody): Response {
    const parsed = claimCapturesRequestSchema.safeParse(body);
    if (!parsed.success) {
      return refuse("bad-request", "Send { limit? }.");
    }
    const now = Date.now();
    const claimToken = `claim_${now}_${this.inbox.length}_${Math.random()}`;
    const taken = this.inbox
      .filter((row) => row.claimToken === null || row.claimedAt <= now - CAPTURE_CLAIM_TTL_MS)
      .slice(0, parsed.data.limit);
    for (const row of taken) {
      row.claimToken = claimToken;
      row.claimedAt = now;
    }
    const captures: CaptureRow[] = taken.map((row) => ({
      id: row.id,
      text: row.text,
      createdAt: row.createdAt,
    }));
    const response: ClaimCapturesResponse = {
      claimToken,
      captures,
      expiresAt: now + CAPTURE_CLAIM_TTL_MS,
    };
    return Response.json(response);
  }

  private ack(body: RequestBody): Response {
    const parsed = ackCapturesRequestSchema.safeParse(body);
    if (!parsed.success) {
      return refuse("bad-request", "Send { claimToken, ids }.");
    }
    const results = parsed.data.ids.map((id): AckCaptureResult => {
      const index = this.inbox.findIndex((row) => row.id === id);
      if (index === -1) {
        return { id, outcome: "unknown" };
      }
      const row = this.inbox[index];
      if (row === undefined || row.claimToken !== parsed.data.claimToken) {
        return { id, outcome: "reclaimed" };
      }
      this.inbox.splice(index, 1);
      return { id, outcome: "deleted" };
    });
    const response: AckCapturesResponse = { results };
    return Response.json(response);
  }
}
