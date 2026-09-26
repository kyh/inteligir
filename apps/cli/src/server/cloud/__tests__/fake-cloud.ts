// the cloud worker over Maps. the refusal rules here mirror the durable
// object's; change both, or the client passes here and fails deployed.

import {
  ackCapturesRequestSchema,
  CAPTURE_API_PATHS,
  CAPTURE_CLAIM_TTL_MS,
  claimCapturesRequestSchema,
} from "@repo/api/cloud/captures/captures-schema";
import type {
  AckCapturesResponse,
  CaptureRow,
  ClaimCapturesResponse,
} from "@repo/api/cloud/captures/captures-schema";
import {
  ACCOUNT_API_PATHS,
  deviceSignUpRequestSchema,
} from "@repo/api/cloud/account/account-schema";
import { CLOUD_ERROR_STATUS, cloudError } from "@repo/api/cloud/errors";
import type { CloudErrorCode } from "@repo/api/cloud/errors";
import {
  DEVICE_API_PATHS,
  DEVICE_CREDENTIAL_PREFIX,
  deviceLoginRequestSchema,
} from "@repo/api/cloud/device/device-schema";
import type {
  DeviceLoginResponse,
  RevokeDeviceResponse,
} from "@repo/api/cloud/device/device-schema";
import {
  pullQuerySchema,
  pushRequestSchema,
  SYNC_API_PATHS,
} from "@repo/api/cloud/sync/sync-schema";
import type { PullResponse, PushResponse, SyncEventRow } from "@repo/api/cloud/sync/sync-schema";
import type { CloudFetch } from "@repo/api/cloud/client";
import { randomBytes } from "node:crypto";
import { z } from "zod";

type RequestBody = z.infer<ReturnType<typeof z.json>>;

const parseJson = (text: string): RequestBody => z.json().parse(JSON.parse(text));

const typedEventSchema = z.object({ type: z.string() }).catchall(z.json());

type AckCaptureResult = AckCapturesResponse["results"][number];

const refuse = (code: CloudErrorCode, message: string, deviceSeq?: number): Response =>
  Response.json(cloudError(code, message, deviceSeq), {
    status: CLOUD_ERROR_STATUS[code],
  });

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

// the one invite every fake cloud holds until a sign-up spends it.
export const FAKE_INVITE_CODE = "FAKE-INVITE";

interface FakeDevice {
  deviceId: string;
  email: string;
  revoked: boolean;
}

export class FakeCloud {
  private readonly devices = new Map<string, FakeDevice>();
  private readonly accounts = new Map<string, { id: string; password: string }>([
    [FAKE_ACCOUNT.email, { id: "user_fake", password: FAKE_ACCOUNT.password }],
  ]);
  private readonly inviteCodes = new Set([FAKE_INVITE_CODE]);
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
  /** the invite gate's window is shut: every sign-up answers rate-limited. */
  signUpWindowShut = false;
  /** event types served as a newer build writes them: renamed, so this build's grammar refuses them. */
  readonly unreadableTypes = new Set<string>();

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
    this.inbox.push({ claimToken: null, claimedAt: 0, createdAt: this.nextCapture, id, text });
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

  activeDeviceCount(): number {
    return [...this.devices.values()].filter((device) => !device.revoked).length;
  }

  readonly fetch: CloudFetch = async (input, init) =>
    await Promise.resolve(this.route(input, init));

  private route(input: string, init?: RequestInit): Response {
    const url = new URL(input);
    const route = `${init?.method ?? "GET"} ${url.pathname}`;
    this.requests.push(route);
    const text = z.string().safeParse(init?.body);
    const body: RequestBody = text.success ? parseJson(text.data) : null;

    if (route === `POST ${DEVICE_API_PATHS.login}`) {
      return this.login(body);
    }
    if (route === `POST ${DEVICE_API_PATHS.signUp}`) {
      return this.signUp(body);
    }

    const device = this.authorize(init);
    if (device === null) {
      return refuse("unauthorized", "No valid device credential.");
    }
    if (route === `POST ${DEVICE_API_PATHS.signOut}`) {
      this.revoke(device.deviceId);
      const response: RevokeDeviceResponse = { revoked: true };
      return Response.json(response);
    }
    if (route === `POST ${SYNC_API_PATHS.push}`) {
      return this.push(device.deviceId, body);
    }
    if (route === `GET ${SYNC_API_PATHS.pull}`) {
      return this.pull(url);
    }
    if (route === `POST ${CAPTURE_API_PATHS.claim}`) {
      return this.claim(body);
    }
    if (route === `POST ${CAPTURE_API_PATHS.ack}`) {
      return this.ack(body);
    }
    if (route === `GET ${ACCOUNT_API_PATHS.account}`) {
      return this.account(device);
    }
    return refuse("not-found", "No such route.");
  }

  private account(device: FakeDevice): Response {
    const account = this.accounts.get(device.email);
    return account === undefined
      ? refuse("unauthorized", "No valid device credential.")
      : Response.json({ email: device.email, id: account.id });
  }

  private authorize(init: RequestInit | undefined): FakeDevice | null {
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
    return device;
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
    if (this.accounts.get(parsed.data.email)?.password !== parsed.data.password) {
      return refuse("invalid-credentials", "Wrong email or password.");
    }
    if (this.activeDeviceCount() >= this.maxDevices) {
      return refuse("device-limit", "This account has too many active devices — revoke one first.");
    }
    return this.mint(parsed.data.email);
  }

  // the worker's order: the claim, then the account, and a refused account leaves the code unspent.
  private signUp(body: RequestBody): Response {
    if (this.signUpWindowShut) {
      return refuse("rate-limited", "Too many attempts — wait a minute.");
    }
    const parsed = deviceSignUpRequestSchema.safeParse(body);
    if (!parsed.success) {
      return refuse("bad-request", "Send { name, email, password, inviteCode, deviceName }.");
    }
    const { email, inviteCode, password } = parsed.data;
    if (!this.inviteCodes.has(inviteCode)) {
      return refuse("invite-refused", "That invite code isn't valid. Check it and try again.");
    }
    if (this.accounts.has(email)) {
      return refuse(
        "account-exists",
        "An account with this email already exists. Sign in instead.",
      );
    }
    this.inviteCodes.delete(inviteCode);
    this.accounts.set(email, { id: `user_${this.accounts.size + 1}`, password });
    return this.mint(email);
  }

  private mint(email: string): Response {
    this.nextDevice += 1;
    const deviceId = `dev_${this.nextDevice}`;
    // random like the worker's, never derived from the per-cloud device counter: two fake clouds
    // would mint one credential, and a sign-out sent to the other would revoke a stranger
    const credential = `${DEVICE_CREDENTIAL_PREFIX}${randomBytes(32).toString("hex")}`;
    this.devices.set(credential, { deviceId, email, revoked: false });
    const response: DeviceLoginResponse = { credential, deviceId };
    return Response.json(response);
  }

  private push(deviceId: string, body: RequestBody): Response {
    const parsed = pushRequestSchema.safeParse(body);
    if (!parsed.success) {
      return refuse("bad-request", "Malformed push batch.");
    }
    const { events } = parsed.data;
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
    let highWater = 0;
    for (const row of mine) {
      highWater = Math.max(highWater, row.deviceSeq);
    }
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
        body: serialized,
        createdAt: event.createdAt,
        deviceId,
        deviceSeq: event.deviceSeq,
        seq: this.nextSeq,
        threadId: event.threadId,
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
      createdAt: row.createdAt,
      deviceId: row.deviceId,
      deviceSeq: row.deviceSeq,
      event: this.served(row.body),
      seq: row.seq,
      threadId: row.threadId,
    }));
    const response: PullResponse = { events, hasMore, lastSeq: this.nextSeq };
    return Response.json(response);
  }

  private served(body: string): RequestBody {
    const event = parseJson(body);
    const typed = typedEventSchema.safeParse(event);
    if (!typed.success || !this.unreadableTypes.has(typed.data.type)) {
      return event;
    }
    return { ...typed.data, type: `${typed.data.type}@newer` };
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
      createdAt: row.createdAt,
      id: row.id,
      text: row.text,
    }));
    const response: ClaimCapturesResponse = {
      captures,
      claimToken,
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
