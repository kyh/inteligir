// the cloud worker over Maps. the refusal rules here mirror the durable
// object's; change both, or the client passes here and fails deployed.

import {
  ackCapturesRequestSchema,
  CAPTURE_API_PATHS,
  CAPTURE_CLAIM_TTL_MS,
  claimCapturesRequestSchema,
  type AckCapturesResponse,
  type CaptureRow,
  type ClaimCapturesResponse,
} from "@repo/api/cloud/captures/captures-schema";
import { ACCOUNT_API_PATHS } from "@repo/api/cloud/account/account-schema";
import { CLOUD_ERROR_STATUS, cloudError, type CloudErrorCode } from "@repo/api/cloud/errors";
import {
  DEVICE_API_PATHS,
  DEVICE_CREDENTIAL_PREFIX,
  deviceLoginRequestSchema,
  type DeviceLoginResponse,
} from "@repo/api/cloud/device/device-schema";
import {
  pullQuerySchema,
  pushRequestSchema,
  SYNC_API_PATHS,
  type PullResponse,
  type PushResponse,
  type SyncEventRow,
} from "@repo/api/cloud/sync/sync-schema";
import type { CloudFetch } from "@repo/api/cloud/client";
import { z } from "zod";

type RequestBody = z.infer<ReturnType<typeof z.json>>;

type AckCaptureResult = AckCapturesResponse["results"][number];

function refuse(code: CloudErrorCode, message: string, deviceSeq?: number): Response {
  return Response.json(cloudError(code, message, deviceSeq), {
    status: CLOUD_ERROR_STATUS[code],
  });
}

interface LogRow {
  seq: number;
  threadId: string;
  deviceId: string;
  deviceSeq: number;
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

// the one account every fake cloud holds; the runtime under test signs in as it.
export const FAKE_ACCOUNT = { email: "owner@example.test", password: "correct horse battery" };

export class FakeCloud {
  private readonly devices = new Map<string, { deviceId: string; revoked: boolean }>();
  private readonly accounts = new Map<string, string>([
    [FAKE_ACCOUNT.email, FAKE_ACCOUNT.password],
  ]);
  private readonly log: LogRow[] = [];
  private readonly inbox: InboxRow[] = [];
  private nextDevice = 0;
  private nextSeq = 0;
  private nextCapture = 0;
  readonly requests: string[] = [];
  /** fails the next push after its first event is stored — an interrupted push. */
  dropNextPushResponse = false;
  /** the account's device cap, as the worker enforces it. */
  maxDevices = Number.POSITIVE_INFINITY;
  /** the login window is shut: every login answers rate-limited. */
  loginWindowShut = false;

  revoke(deviceId: string): void {
    for (const device of this.devices.values()) {
      if (device.deviceId === deviceId) {
        device.revoked = true;
      }
    }
  }

  capture(text: string): string {
    this.nextCapture += 1;
    const id = `cap_${this.nextCapture}`;
    this.inbox.push({ id, text, createdAt: this.nextCapture, claimToken: null, claimedAt: 0 });
    return id;
  }

  lapseClaims(): void {
    for (const row of this.inbox) {
      row.claimedAt = 0;
    }
  }

  logSize(): number {
    return this.log.length;
  }

  deviceCount(): number {
    return this.devices.size;
  }

  readonly fetch: CloudFetch = async (input, init) => {
    const url = new URL(input);
    const method = init?.method ?? "GET";
    this.requests.push(`${method} ${url.pathname}`);
    const text = z.string().safeParse(init?.body);
    const body: RequestBody = text.success ? JSON.parse(text.data) : null;

    if (method === "POST" && url.pathname === DEVICE_API_PATHS.login) {
      return this.login(body);
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
    if (method === "GET" && url.pathname === ACCOUNT_API_PATHS.account) {
      return Response.json({ id: "user_fake", email: FAKE_ACCOUNT.email });
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

  private login(body: RequestBody): Response {
    if (this.loginWindowShut) {
      return refuse("rate-limited", "Too many attempts — wait a minute.");
    }
    const parsed = deviceLoginRequestSchema.safeParse(body);
    if (!parsed.success) {
      return refuse("bad-request", "Send { email, password, deviceName }.");
    }
    // mirrors the worker: an unknown address and a wrong password are one answer.
    if (this.accounts.get(parsed.data.email) !== parsed.data.password) {
      return refuse("invalid-credentials", "Wrong email or password.");
    }
    const active = [...this.devices.values()].filter((device) => !device.revoked).length;
    if (active >= this.maxDevices) {
      return refuse("device-limit", "This account has too many active devices — revoke one first.");
    }
    this.nextDevice += 1;
    const deviceId = `dev_${this.nextDevice}`;
    const credential = `${DEVICE_CREDENTIAL_PREFIX}${String(this.nextDevice).padStart(64, "0")}`;
    this.devices.set(credential, { deviceId, revoked: false });
    const response: DeviceLoginResponse = { deviceId, credential };
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
