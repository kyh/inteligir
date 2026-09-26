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
  deleteAccountRequestSchema,
  deviceSignUpRequestSchema,
} from "@repo/api/cloud/account/account-schema";
import type { DeleteAccountResponse } from "@repo/api/cloud/account/account-schema";
import { CLOUD_ERROR_STATUS, cloudError } from "@repo/api/cloud/errors";
import type { CloudErrorCode } from "@repo/api/cloud/errors";
import {
  DEVICE_API_PATHS,
  DEVICE_CREDENTIAL_PREFIX,
  deviceLoginRequestSchema,
  revokeDeviceRequestSchema,
} from "@repo/api/cloud/device/device-schema";
import type {
  DeviceLoginResponse,
  ListDevicesResponse,
  RevokeDeviceResponse,
} from "@repo/api/cloud/device/device-schema";
import {
  ackDispatchesRequestSchema,
  answerableDecisions,
  APPROVAL_MAX_OPEN,
  cancelDispatchRequestSchema,
  claimDispatchesRequestSchema,
  closeApprovalRequestSchema,
  createDispatchRequestSchema,
  DISPATCH_API_PATHS,
  DISPATCH_CLAIM_TTL_MS,
  DISPATCH_MAX_PENDING,
  dispatchStatusRequestSchema,
  openApprovalRequestSchema,
} from "@repo/api/cloud/dispatch/dispatch-schema";
import type {
  AckDispatchesResponse,
  ApprovalRow,
  ApprovalState,
  CancelDispatchResponse,
  ClaimDispatchesResponse,
  ClaimedDispatch,
  CloseApprovalResponse,
  CreateDispatchResponse,
  DispatchStatus,
  DispatchStatusResponse,
  ListApprovalsResponse,
  OpenApprovalResponse,
} from "@repo/api/cloud/dispatch/dispatch-schema";
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

type DispatchSettle =
  | { state: "pending" }
  | { state: "delivered" }
  | { state: "refused"; message: string };

interface DispatchRow {
  claimed: ClaimedDispatch;
  fromDeviceId: string;
  // null: any Mac may claim it; an answer is its asking Mac's alone
  toDeviceId: string | null;
  approvalId: string | null;
  claimToken: string | null;
  claimedAt: number;
  settle: DispatchSettle;
}

const liveDispatchClaim = (row: DispatchRow, now: number): boolean =>
  row.claimToken !== null && row.claimedAt > now - DISPATCH_CLAIM_TTL_MS;

interface ApprovalEntry {
  row: Omit<ApprovalRow, "state">;
  fromDeviceId: string;
  state: ApprovalState;
}

// the one account every fake cloud holds; the runtime under test signs in as it.
export const FAKE_ACCOUNT = { email: "owner@example.test", password: "correct horse battery" };

// the one invite every fake cloud holds until a sign-up spends it.
export const FAKE_INVITE_CODE = "FAKE-INVITE";

interface FakeDevice {
  deviceId: string;
  email: string;
  name: string;
  createdAt: number;
  revokedAt: number | null;
}

export class FakeCloud {
  private readonly devices = new Map<string, FakeDevice>();
  private readonly accounts = new Map<string, { id: string; password: string }>([
    [FAKE_ACCOUNT.email, { id: "user_fake", password: FAKE_ACCOUNT.password }],
  ]);
  private readonly inviteCodes = new Set([FAKE_INVITE_CODE]);
  private readonly log: LogRow[] = [];
  private readonly inbox: InboxRow[] = [];
  // insertion order is the claim order, as rowid is the object's
  private readonly dispatches: DispatchRow[] = [];
  private readonly approvals = new Map<string, ApprovalEntry>();
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
  /** every device's deletion window is shut: every account deletion answers rate-limited. */
  deleteWindowShut = false;
  /** event types served as a newer build writes them: renamed, so this build's grammar refuses them. */
  readonly unreadableTypes = new Set<string>();
  /** what the status route counts as desktop sockets: this fake holds none of its own. */
  desktopsOnline = 0;

  revoke(deviceId: string): void {
    for (const device of this.devices.values()) {
      if (device.deviceId === deviceId && device.revokedAt === null) {
        device.revokedAt = Date.now();
      }
    }
  }

  capture(text: string): string {
    this.nextCapture += 1;
    const id = `cap_${this.nextCapture}`;
    this.inbox.push({ claimToken: null, claimedAt: 0, createdAt: this.nextCapture, id, text });
    return id;
  }

  // every claim, a capture's and a dispatch's, as if its ttl ran out
  lapseClaims(): void {
    for (const row of this.inbox) {
      row.claimedAt = 0;
    }
    for (const row of this.dispatches) {
      row.claimedAt = 0;
    }
  }

  /** the inbox's own view of a dispatch, as the status route answers it. */
  dispatchStatus(id: string): DispatchStatus {
    return this.statusOf(id) ?? { id, state: "unknown" };
  }

  /** the approvals the phone's listing would show. */
  openApprovals(): ApprovalRow[] {
    return this.listedApprovals();
  }

  logSize(): number {
    return this.log.length;
  }

  deviceCount(): number {
    return this.devices.size;
  }

  hasAccount(email: string): boolean {
    return this.accounts.has(email);
  }

  activeDeviceCount(): number {
    return [...this.devices.values()].filter((device) => device.revokedAt === null).length;
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
    if (route === `POST ${ACCOUNT_API_PATHS.delete}`) {
      return this.deleteAccount(device, body);
    }
    if (route === `GET ${DEVICE_API_PATHS.list}`) {
      return this.listDevices(device);
    }
    if (route === `POST ${DEVICE_API_PATHS.revoke}`) {
      return this.revokeDevice(device, body);
    }
    return (
      this.dispatchRoute(route, device.deviceId, body) ?? refuse("not-found", "No such route.")
    );
  }

  private dispatchRoute(route: string, deviceId: string, body: RequestBody): Response | null {
    switch (route) {
      case `POST ${DISPATCH_API_PATHS.dispatch}`: {
        return this.createDispatch(deviceId, body);
      }
      case `POST ${DISPATCH_API_PATHS.claim}`: {
        return this.claimDispatches(deviceId, body);
      }
      case `POST ${DISPATCH_API_PATHS.ack}`: {
        return this.ackDispatches(body);
      }
      case `POST ${DISPATCH_API_PATHS.status}`: {
        return this.dispatchStatuses(body);
      }
      case `POST ${DISPATCH_API_PATHS.cancel}`: {
        return this.cancelDispatch(body);
      }
      case `POST ${DISPATCH_API_PATHS.approval}`: {
        return this.openApproval(deviceId, body);
      }
      case `POST ${DISPATCH_API_PATHS.approvalClose}`: {
        return this.closeApproval(deviceId, body);
      }
      case `GET ${DISPATCH_API_PATHS.approvals}`: {
        const response: ListApprovalsResponse = { approvals: this.listedApprovals() };
        return Response.json(response);
      }
      default: {
        return null;
      }
    }
  }

  private statusOf(id: string): DispatchStatus | null {
    const row = this.dispatches.find((candidate) => candidate.claimed.id === id);
    if (row === undefined) {
      return null;
    }
    switch (row.settle.state) {
      case "delivered": {
        return { id, state: "delivered" };
      }
      case "refused": {
        return { id, message: row.settle.message, state: "refused" };
      }
      case "pending": {
        return { id, state: liveDispatchClaim(row, Date.now()) ? "claimed" : "waiting" };
      }
      // no default
    }
  }

  private closeApprovalEntry(approvalId: string | null): void {
    const entry = approvalId === null ? undefined : this.approvals.get(approvalId);
    if (entry !== undefined) {
      entry.state = "closed";
    }
  }

  private createDispatch(deviceId: string, body: RequestBody): Response {
    const parsed = createDispatchRequestSchema.safeParse(body);
    if (!parsed.success) {
      return refuse("bad-request", "Malformed dispatch.");
    }
    const request = parsed.data;
    const existing = this.statusOf(request.id);
    if (existing !== null) {
      const duplicate: CreateDispatchResponse = { dispatch: existing, duplicate: true };
      return Response.json(duplicate);
    }
    const pending = this.dispatches.filter((row) => row.settle.state === "pending").length;
    if (pending >= DISPATCH_MAX_PENDING) {
      return refuse("rate-limited", "Too many requests are already waiting for a computer.");
    }
    const createdAt = Date.now();
    if (request.kind === "turn") {
      this.dispatches.push({
        approvalId: null,
        claimToken: null,
        claimed: { ...request, createdAt },
        claimedAt: 0,
        fromDeviceId: deviceId,
        settle: { state: "pending" },
        toDeviceId: null,
      });
      const stored: CreateDispatchResponse = {
        dispatch: { id: request.id, state: "waiting" },
        duplicate: false,
      };
      return Response.json(stored);
    }
    const approval = this.approvals.get(request.approvalId);
    if (approval === undefined) {
      return refuse("not-found", "No such request is waiting for an answer.");
    }
    const claimed: ClaimedDispatch = { ...request, createdAt, threadId: approval.row.threadId };
    if (approval.state !== "open") {
      const message =
        approval.state === "answered"
          ? "That request was already answered."
          : "That request is no longer waiting.";
      this.dispatches.push({
        approvalId: request.approvalId,
        claimToken: null,
        claimed,
        claimedAt: 0,
        fromDeviceId: deviceId,
        settle: { message, state: "refused" },
        toDeviceId: approval.fromDeviceId,
      });
      const settled: CreateDispatchResponse = {
        dispatch: { id: request.id, message, state: "refused" },
        duplicate: false,
      };
      return Response.json(settled);
    }
    if (!answerableDecisions(approval.row.payload).includes(request.decision)) {
      return refuse("bad-request", "That request does not offer that answer.");
    }
    this.dispatches.push({
      approvalId: request.approvalId,
      claimToken: null,
      claimed,
      claimedAt: 0,
      fromDeviceId: deviceId,
      settle: { state: "pending" },
      toDeviceId: approval.fromDeviceId,
    });
    approval.state = "answered";
    const stored: CreateDispatchResponse = {
      dispatch: { id: request.id, state: "waiting" },
      duplicate: false,
    };
    return Response.json(stored);
  }

  private claimDispatches(deviceId: string, body: RequestBody): Response {
    const parsed = claimDispatchesRequestSchema.safeParse(body);
    if (!parsed.success) {
      return refuse("bad-request", "Send { limit? }.");
    }
    const now = Date.now();
    const claimToken = `dclaim_${now}_${Math.random()}`;
    const taken = this.dispatches
      .filter(
        (row) =>
          row.settle.state === "pending" &&
          (row.toDeviceId === null || row.toDeviceId === deviceId) &&
          !liveDispatchClaim(row, now),
      )
      .slice(0, parsed.data.limit);
    for (const row of taken) {
      row.claimToken = claimToken;
      row.claimedAt = now;
    }
    const response: ClaimDispatchesResponse = {
      claimToken,
      dispatches: taken.map((row) => row.claimed),
      expiresAt: now + DISPATCH_CLAIM_TTL_MS,
    };
    return Response.json(response);
  }

  private ackDispatches(body: RequestBody): Response {
    const parsed = ackDispatchesRequestSchema.safeParse(body);
    if (!parsed.success) {
      return refuse("bad-request", "Send { claimToken, results }.");
    }
    const { claimToken } = parsed.data;
    const response: AckDispatchesResponse = {
      results: parsed.data.results.map((result): AckDispatchesResponse["results"][number] => {
        const row = this.dispatches.find((candidate) => candidate.claimed.id === result.id);
        if (row === undefined) {
          return { id: result.id, outcome: "unknown" };
        }
        if (row.claimToken === claimToken && row.settle.state === "pending") {
          row.settle =
            result.outcome === "refused"
              ? { message: result.message, state: "refused" }
              : { state: "delivered" };
          this.closeApprovalEntry(row.approvalId);
          return { id: result.id, outcome: "recorded" };
        }
        return { id: result.id, outcome: row.claimToken === claimToken ? "recorded" : "reclaimed" };
      }),
    };
    return Response.json(response);
  }

  private dispatchStatuses(body: RequestBody): Response {
    const parsed = dispatchStatusRequestSchema.safeParse(body);
    if (!parsed.success) {
      return refuse("bad-request", "Send { ids }.");
    }
    const response: DispatchStatusResponse = {
      desktopsDeclining: 0,
      desktopsOnline: this.desktopsOnline,
      dispatches: parsed.data.ids.map((id) => this.dispatchStatus(id)),
    };
    return Response.json(response);
  }

  private cancelDispatch(body: RequestBody): Response {
    const parsed = cancelDispatchRequestSchema.safeParse(body);
    if (!parsed.success) {
      return refuse("bad-request", "Send { id }.");
    }
    const index = this.dispatches.findIndex((row) => row.claimed.id === parsed.data.id);
    const row = this.dispatches[index];
    let outcome: CancelDispatchResponse["outcome"] = "unknown";
    if (row !== undefined) {
      if (row.settle.state !== "pending") {
        outcome = "settled";
      } else if (liveDispatchClaim(row, Date.now())) {
        outcome = "claimed";
      } else {
        this.dispatches.splice(index, 1);
        const approval = row.approvalId === null ? undefined : this.approvals.get(row.approvalId);
        if (approval?.state === "answered") {
          approval.state = "open";
        }
        outcome = "cancelled";
      }
    }
    const response: CancelDispatchResponse = { outcome };
    return Response.json(response);
  }

  private openApproval(deviceId: string, body: RequestBody): Response {
    const parsed = openApprovalRequestSchema.safeParse(body);
    if (!parsed.success) {
      return refuse("bad-request", "Malformed approval.");
    }
    const request = parsed.data;
    const existing = this.approvals.get(request.id);
    if (existing !== undefined) {
      const duplicate: OpenApprovalResponse = { duplicate: true, state: existing.state };
      return Response.json(duplicate);
    }
    const open = [...this.approvals.values()].filter((entry) => entry.state !== "closed").length;
    if (open >= APPROVAL_MAX_OPEN) {
      return refuse("rate-limited", "Too many requests are already waiting for an answer.");
    }
    this.approvals.set(request.id, {
      fromDeviceId: deviceId,
      row: {
        createdAt: Date.now(),
        id: request.id,
        payload: request.payload,
        threadId: request.threadId,
        turnId: request.turnId,
      },
      state: "open",
    });
    const stored: OpenApprovalResponse = { duplicate: false, state: "open" };
    return Response.json(stored);
  }

  private closeApproval(deviceId: string, body: RequestBody): Response {
    const parsed = closeApprovalRequestSchema.safeParse(body);
    if (!parsed.success) {
      return refuse("bad-request", "Send { id }.");
    }
    const entry = this.approvals.get(parsed.data.id);
    let outcome: CloseApprovalResponse["outcome"] = "unknown";
    if (entry !== undefined && entry.fromDeviceId === deviceId) {
      entry.state = "closed";
      outcome = "closed";
    }
    const response: CloseApprovalResponse = { outcome };
    return Response.json(response);
  }

  private listedApprovals(): ApprovalRow[] {
    return [...this.approvals.values()].flatMap((entry): ApprovalRow[] =>
      entry.state === "closed" ? [] : [{ ...entry.row, state: entry.state }],
    );
  }

  private account(device: FakeDevice): Response {
    const account = this.accounts.get(device.email);
    return account === undefined
      ? refuse("unauthorized", "No valid device credential.")
      : Response.json({ email: device.email, id: account.id });
  }

  // the worker's order: the window, the password asked again, then the account and every device row
  private deleteAccount(caller: FakeDevice, body: RequestBody): Response {
    if (this.deleteWindowShut) {
      return refuse("rate-limited", "Too many attempts — wait a minute.");
    }
    const parsed = deleteAccountRequestSchema.safeParse(body);
    if (!parsed.success) {
      return refuse("bad-request", "Send { password }.");
    }
    if (this.accounts.get(caller.email)?.password !== parsed.data.password) {
      return refuse("invalid-credentials", "Wrong password.");
    }
    this.accounts.delete(caller.email);
    for (const [credential, device] of this.devices) {
      if (device.email === caller.email) {
        this.devices.delete(credential);
      }
    }
    const response: DeleteAccountResponse = { deleted: true };
    return Response.json(response);
  }

  private listDevices(caller: FakeDevice): Response {
    const response: ListDevicesResponse = {
      devices: [...this.devices.values()]
        .filter((device) => device.email === caller.email)
        .map((device) => ({
          createdAt: device.createdAt,
          id: device.deviceId,
          lastSeenAt: null,
          name: device.name,
          revokedAt: device.revokedAt,
        })),
    };
    return Response.json(response);
  }

  // the worker's scope: another account's device and one already revoked are both not-found
  private revokeDevice(caller: FakeDevice, body: RequestBody): Response {
    const parsed = revokeDeviceRequestSchema.safeParse(body);
    if (!parsed.success) {
      return refuse("bad-request", "Send { deviceId }.");
    }
    const target = [...this.devices.values()].find(
      (device) =>
        device.deviceId === parsed.data.deviceId &&
        device.email === caller.email &&
        device.revokedAt === null,
    );
    if (target === undefined) {
      return refuse("not-found", "No such active device.");
    }
    target.revokedAt = Date.now();
    const response: RevokeDeviceResponse = { revoked: true };
    return Response.json(response);
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
    if (device === undefined || device.revokedAt !== null) {
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
    return this.mint(parsed.data.email, parsed.data.deviceName);
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
    return this.mint(email, parsed.data.deviceName);
  }

  private mint(email: string, name: string): Response {
    this.nextDevice += 1;
    const deviceId = `dev_${this.nextDevice}`;
    // random like the worker's, never derived from the per-cloud device counter: two fake clouds
    // would mint one credential, and a sign-out sent to the other would revoke a stranger
    const credential = `${DEVICE_CREDENTIAL_PREFIX}${randomBytes(32).toString("hex")}`;
    this.devices.set(credential, {
      createdAt: Date.now(),
      deviceId,
      email,
      name,
      revokedAt: null,
    });
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
