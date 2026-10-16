import { describe, expect, it } from "vitest";
import {
  CLIENT_BUILD_HEADER,
  clientBuildHeaders,
  meetsBuildFloor,
  parseClientBuildHeader,
  parseReleaseVersion,
} from "../client-build";
import type { BuildVersion, ClientBuild } from "../client-build";
import { createCloudClient, postDeviceLogin, postDeviceSignUp } from "../cloud-client";
import type { CloudClient, CloudFetch } from "../cloud-client";
import { createCloudSocketOpener } from "../sync/cloud-socket";

const BUILD: ClientBuild = { platform: "mobile", version: "0.7.0" };
const SENT = "0.7.0+mobile";
const COMMIT = "a".repeat(40);
const ID = "d".repeat(32);

const release = (text: string): BuildVersion => {
  const parsed = parseReleaseVersion(text);
  if (parsed === null) {
    throw new Error(`${text} is no release`);
  }
  return parsed;
};

const meets = (header: string, floor: string): boolean => {
  const build = parseClientBuildHeader(header);
  return build !== null && meetsBuildFloor(build, release(floor));
};

describe("the build header", () => {
  it("says the version and the platform in semver's build-metadata slot", () => {
    expect(clientBuildHeaders(BUILD)).toStrictEqual({ [CLIENT_BUILD_HEADER]: SENT });
    expect(parseClientBuildHeader(SENT)).toStrictEqual({
      major: 0,
      minor: 7,
      patch: 0,
      prerelease: false,
    });
  });

  it("reads a platform it does not know, since the platform gates nothing", () => {
    expect(parseClientBuildHeader("0.7.0+android")).not.toBeNull();
  });

  it("refuses what is absent or not that grammar", () => {
    for (const header of [null, "", "0.7.0", "0.7+mobile", "v0.7.0+mobile", "07.0.0+mobile"]) {
      expect(parseClientBuildHeader(header), String(header)).toBeNull();
    }
  });

  it("holds a floor to a release", () => {
    expect(parseReleaseVersion("0.7.0")).not.toBeNull();
    expect(parseReleaseVersion("0.7.0-beta.1")).toBeNull();
    expect(parseReleaseVersion("0.7.0+mobile")).toBeNull();
  });

  it("admits a build at or above the floor, and a prerelease only past its release", () => {
    expect(meets("0.7.0+mobile", "0.7.0")).toBe(true);
    expect(meets("0.7.1+desktop", "0.7.0")).toBe(true);
    expect(meets("1.0.0+desktop", "0.7.0")).toBe(true);
    expect(meets("0.10.0+desktop", "0.9.0")).toBe(true);
    expect(meets("0.6.9+desktop", "0.7.0")).toBe(false);
    expect(meets("0.7.0-beta.1+desktop", "0.7.0")).toBe(false);
    expect(meets("0.7.1-beta.1+desktop", "0.7.0")).toBe(true);
  });
});

const recorder = () => {
  const seen: { path: string; build: string | null }[] = [];
  const fetch: CloudFetch = async (input, init) => {
    seen.push({
      build: new Headers(init?.headers).get(CLIENT_BUILD_HEADER),
      path: new URL(input).pathname,
    });
    return await Promise.resolve(Response.json({}));
  };
  return { fetch, seen };
};

describe("every request an install sends names its build", () => {
  // keyed by the client's own methods, so a call it grows fails to compile until it is listed here
  const CALLS: Record<keyof CloudClient, (client: CloudClient) => Promise<{ ok: boolean }>> = {
    ackDispatches: async (client) =>
      await client.ackDispatches({
        claimToken: "tok",
        results: [{ id: ID, outcome: "delivered" }],
      }),
    cancelDispatch: async (client) => await client.cancelDispatch(ID),
    claimDispatches: async (client) => await client.claimDispatches({ kinds: ["turn"], limit: 5 }),
    closeApproval: async (client) => await client.closeApproval(ID),
    createDispatch: async (client) =>
      await client.createDispatch({ approvalId: ID, decision: "deny", id: ID, kind: "answer" }),
    deleteAccount: async (client) => await client.deleteAccount("a password"),
    dispatchStatus: async (client) => await client.dispatchStatus([ID]),
    listApprovals: async (client) => await client.listApprovals(),
    listDevices: async (client) => await client.listDevices(),
    openApproval: async (client) =>
      await client.openApproval({
        id: ID,
        payload: {
          availableDecisions: ["allow_once", "deny"],
          kind: "approval",
          reason: null,
          subject: { command: "make notes", cwd: null, itemId: "item_1", kind: "command" },
        },
        threadId: "thr_1",
        turnId: "turn_1",
      }),
    pull: async (client) => await client.pull({ afterSeq: 0, limit: 10 }),
    push: async (client) => await client.push({ events: [] }),
    revokeDevice: async (client) => await client.revokeDevice("dev_2"),
    signOut: async (client) => await client.signOut(),
    vaultAsset: async (client) => await client.vaultAsset({ path: "media/a.png", ref: COMMIT }),
    vaultCommit: async (client) =>
      await client.vaultCommit({
        changes: [
          { base: null, content: { encoding: "utf-8", text: "x" }, op: "put", path: "a.md" },
        ],
      }),
    vaultFile: async (client) => await client.vaultFile({ path: "a.md" }),
    vaultFiles: async (client) => await client.vaultFiles({ paths: ["a.md"], ref: COMMIT }),
    vaultTree: async (client) => await client.vaultTree({}),
  };

  it("on every call a device credential makes", async () => {
    const { fetch, seen } = recorder();
    const client = createCloudClient({
      baseUrl: "https://cloud.test",
      build: BUILD,
      credential: `igd_${"a".repeat(64)}`,
      fetch,
    });
    for (const call of Object.values(CALLS)) {
      await call(client);
    }
    expect(seen).toHaveLength(Object.keys(CALLS).length);
    expect(seen.filter((request) => request.build !== SENT)).toStrictEqual([]);
  });

  it("on the two calls that ask for a credential", async () => {
    const { fetch, seen } = recorder();
    const endpoint = { baseUrl: "https://cloud.test", build: BUILD, fetch };
    const device = { deviceName: "Phone", email: "owner@example.test", password: "a password" };
    await postDeviceLogin(endpoint, device);
    await postDeviceSignUp(endpoint, { ...device, inviteCode: "INVITE-1", name: "Owner" });
    expect(seen.map((request) => request.build)).toStrictEqual([SENT, SENT]);
  });

  it("on the socket's upgrade, beside the bearer", () => {
    const dialled: Record<string, string>[] = [];
    const open = createCloudSocketOpener((_url, headers) => {
      dialled.push(headers);
      return { addEventListener: () => {}, close: () => {}, send: () => {} };
    });
    open({
      baseUrl: "https://cloud.test",
      build: BUILD,
      credential: "igd_test",
      listener: { platform: "mobile" },
      onClose: () => {},
      onOpen: () => {},
      onPing: () => {},
    }).close();
    expect(dialled).toStrictEqual([
      { authorization: "Bearer igd_test", [CLIENT_BUILD_HEADER]: SENT },
    ]);
  });
});
