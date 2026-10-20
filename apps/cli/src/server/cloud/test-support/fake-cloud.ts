// the cloud worker's device and account routes over Maps, refusing as the Worker does. a route it
// does not hold answers not-found, as the Worker's own router does.

import {
  ACCOUNT_API_PATHS,
  deleteAccountRequestSchema,
  deviceSignUpRequestSchema,
} from "@repo/contract/cloud/account/account-schema";
import type { DeleteAccountResponse } from "@repo/contract/cloud/account/account-schema";
import { CLOUD_ERROR_STATUS, cloudError } from "@repo/contract/cloud/errors";
import type { CloudErrorCode } from "@repo/contract/cloud/errors";
import {
  DEVICE_API_PATHS,
  DEVICE_CREDENTIAL_PREFIX,
  deviceLoginRequestSchema,
  revokeDeviceRequestSchema,
} from "@repo/contract/cloud/device/device-schema";
import type {
  DeviceLoginResponse,
  ListDevicesResponse,
  RevokeDeviceResponse,
} from "@repo/contract/cloud/device/device-schema";
import { createCloudClient, postDeviceLogin } from "@repo/contract/cloud/client";
import type { CloudClient, CloudFetch } from "@repo/contract/cloud/client";
import {
  CLIENT_BUILD_HEADER,
  meetsBuildFloor,
  parseClientBuildHeader,
  parseReleaseVersion,
} from "@repo/contract/cloud/client-build";
import { TEST_BUILD } from "@repo/contract/cloud/test-support/fake-cloud-client";
import { randomBytes } from "node:crypto";
import { z } from "zod";

type RequestBody = z.infer<ReturnType<typeof z.json>>;

const parseJson = (text: string): RequestBody => z.json().parse(JSON.parse(text));

const refuse = (code: CloudErrorCode, message: string): Response =>
  Response.json(cloudError(code, message), { status: CLOUD_ERROR_STATUS[code] });

export const FAKE_ACCOUNT = { email: "owner@example.test", password: "correct horse battery" };

// any origin reaches the fake; this is the one the booted suites configure.
const FAKE_CLOUD_URL = "https://cloud.test";

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
  private nextDevice = 0;
  readonly requests: string[] = [];
  /** the account's device cap, as the worker enforces it. */
  maxDevices = Number.POSITIVE_INFINITY;
  /** the login window is shut: every login answers rate-limited. */
  loginWindowShut = false;
  /** the invite gate's window is shut: every sign-up answers rate-limited. */
  signUpWindowShut = false;
  /** every device's deletion window is shut: every account deletion answers rate-limited. */
  deleteWindowShut = false;
  /** the oldest build it answers, as the worker's floor does; null answers every build. */
  buildFloor: string | null = null;

  /** another device joining the account on its own, speaking the wire as the app does. */
  async signInDevice(deviceName: string): Promise<{ client: CloudClient; deviceId: string }> {
    const endpoint = { baseUrl: FAKE_CLOUD_URL, build: TEST_BUILD, fetch: this.fetch };
    const login = await postDeviceLogin(endpoint, { ...FAKE_ACCOUNT, deviceName });
    if (!login.ok) {
      throw new Error(`${deviceName} could not sign in: ${JSON.stringify(login.failure)}`);
    }
    const { credential, deviceId } = login.value;
    return { client: createCloudClient({ ...endpoint, credential }), deviceId };
  }

  revoke(deviceId: string): void {
    for (const device of this.devices.values()) {
      if (device.deviceId === deviceId && device.revokedAt === null) {
        device.revokedAt = Date.now();
      }
    }
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

  private belowFloor(init?: RequestInit): boolean {
    if (this.buildFloor === null) {
      return false;
    }
    const floor = parseReleaseVersion(this.buildFloor);
    const build = parseClientBuildHeader(new Headers(init?.headers).get(CLIENT_BUILD_HEADER));
    return floor === null || build === null || !meetsBuildFloor(build, floor);
  }

  private route(input: string, init?: RequestInit): Response {
    const url = new URL(input);
    const route = `${init?.method ?? "GET"} ${url.pathname}`;
    this.requests.push(route);
    if (this.belowFloor(init)) {
      return refuse("client-outdated", "This version of Inteligir can't sync anymore.");
    }
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
    if (route === `POST ${ACCOUNT_API_PATHS.delete}`) {
      return this.deleteAccount(device, body);
    }
    if (route === `GET ${DEVICE_API_PATHS.list}`) {
      return this.listDevices(device);
    }
    if (route === `POST ${DEVICE_API_PATHS.revoke}`) {
      return this.revokeDevice(device, body);
    }
    return refuse("not-found", "No such route.");
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
    this.revoke(target.deviceId);
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
    const account = this.accounts.get(parsed.data.email);
    if (account?.password !== parsed.data.password) {
      return refuse("invalid-credentials", "Wrong email or password.");
    }
    if (this.activeDeviceCount() >= this.maxDevices) {
      return refuse("device-limit", "This account has too many active devices — revoke one first.");
    }
    return this.mint(parsed.data.email, account.id, parsed.data.deviceName);
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
    const userId = `user_${this.accounts.size + 1}`;
    this.accounts.set(email, { id: userId, password });
    return this.mint(email, userId, parsed.data.deviceName);
  }

  private mint(email: string, userId: string, name: string): Response {
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
    const response: DeviceLoginResponse = { credential, deviceId, email, userId };
    return Response.json(response);
  }
}
