import { syncPingSchema, type SyncPing } from "@repo/api/cloud/sync/sync-ws";
import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { deviceHeaders, ORIGIN, pairDevice, signUpUser } from "./cloud-helpers";
import { pushVaultFiles, ZERO_OID } from "./git-pack";

// The hosted vault remote end to end, in-process: credential verification on
// both carriers, the identity-free URL rewrite, a REAL push (the hand-built
// pack wire in ./git-pack.ts), the clone leg over what was pushed, and the
// vault ping's pusher exclusion.

const REMOTE = `${ORIGIN}/v1/git/vault.git`;

/** Open the invalidation socket and collect its frames. */
async function openSocket(credential: string): Promise<{ frames: SyncPing[] }> {
  const response = await SELF.fetch(`${ORIGIN}/v1/sync/ws?platform=desktop`, {
    headers: { ...deviceHeaders(credential), upgrade: "websocket" },
  });
  expect(response.status).toBe(101);
  const socket = response.webSocket;
  if (socket === null) throw new Error("no websocket on the 101");
  socket.accept();
  const frames: SyncPing[] = [];
  socket.addEventListener("message", (message) => {
    const { data } = message;
    if (data instanceof ArrayBuffer) return;
    frames.push(syncPingSchema.parse(JSON.parse(data)));
  });
  return { frames };
}

/** The ping rides waitUntil off the push's own invocation; one macrotask
 *  later it has crossed the in-process pair. */
function settled(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 100));
}

describe("vault git remote auth", () => {
  it("refuses the wire without a credential, with the Basic challenge", async () => {
    const response = await SELF.fetch(`${REMOTE}/info/refs?service=git-receive-pack`);
    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toContain("Basic");
  });

  it("refuses an unknown credential on both carriers", async () => {
    const fake = `igd_${"0".repeat(64)}`;
    const bearer = await SELF.fetch(`${REMOTE}/info/refs?service=git-receive-pack`, {
      headers: { authorization: `Bearer ${fake}` },
    });
    expect(bearer.status).toBe(401);
    const basic = await SELF.fetch(`${REMOTE}/info/refs?service=git-receive-pack`, {
      headers: { authorization: `Basic ${btoa(`x:${fake}`)}` },
    });
    expect(basic.status).toBe(401);
  });

  it("serves the receive-pack advertisement to a Bearer credential", async () => {
    const { bearer } = await signUpUser("vault-git-bearer@example.test");
    const { credential } = await pairDevice(bearer, "Laptop");
    const response = await SELF.fetch(`${REMOTE}/info/refs?service=git-receive-pack`, {
      headers: deviceHeaders(credential),
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe(
      "application/x-git-receive-pack-advertisement",
    );
  });

  it("accepts the credential as a Basic password — stock git's carrier", async () => {
    const { bearer } = await signUpUser("vault-git-basic@example.test");
    const { credential } = await pairDevice(bearer, "Laptop");
    const response = await SELF.fetch(`${REMOTE}/info/refs?service=git-receive-pack`, {
      headers: { authorization: `Basic ${btoa(`x:${credential}`)}` },
    });
    expect(response.status).toBe(200);
  });

  it("answers 404 on the fetch leg of a vault never pushed", async () => {
    const { bearer } = await signUpUser("vault-git-empty@example.test");
    const { credential } = await pairDevice(bearer, "Laptop");
    const response = await SELF.fetch(`${REMOTE}/info/refs?service=git-upload-pack`, {
      headers: deviceHeaders(credential),
    });
    expect(response.status).toBe(404);
  });

  it("keeps the JSON API and admin surface off the wire", async () => {
    const { bearer } = await signUpUser("vault-git-surface@example.test");
    const { credential } = await pairDevice(bearer, "Laptop");
    const api = await SELF.fetch(`${REMOTE}/api/refs`, { headers: deviceHeaders(credential) });
    expect(api.status).toBe(404);
    const admin = await SELF.fetch(`${REMOTE}/`, {
      method: "DELETE",
      headers: deviceHeaders(credential),
    });
    expect(admin.status).toBe(404);
  });
});

describe("vault git remote round-trip", () => {
  it("pushes, advertises what was pushed, and pings every device but the pusher", async () => {
    const { bearer } = await signUpUser("vault-git-push@example.test");
    const pusher = await pairDevice(bearer, "Laptop");
    const other = await pairDevice(bearer, "Phone");

    const pusherSocket = await openSocket(pusher.credential);
    const otherSocket = await openSocket(other.credential);

    const first = await pushVaultFiles(
      pusher.credential,
      "vault: initialize",
      [{ path: "welcome.md", content: "# hello\n" }],
      ZERO_OID,
    );
    expect(first.response.status).toBe(200);
    expect(await first.response.text()).toContain("unpack ok");
    await settled();

    expect(otherSocket.frames).toContainEqual({ type: "vault" });
    expect(pusherSocket.frames).not.toContainEqual({ type: "vault" });

    // The fetch leg now advertises the pushed head — the clone path is live.
    const refs = await SELF.fetch(`${REMOTE}/info/refs?service=git-upload-pack`, {
      headers: deviceHeaders(other.credential),
    });
    expect(refs.status).toBe(200);
    expect(await refs.text()).toContain(first.commit);

    // A second push on top round-trips too — the repo holds real history.
    const second = await pushVaultFiles(
      pusher.credential,
      "vault: update welcome.md",
      [{ path: "welcome.md", content: "# hello again\n" }],
      first.commit,
      first.commit,
    );
    expect(second.response.status).toBe(200);
    expect(await second.response.text()).toContain("unpack ok");
  });

  it("keeps two users' vaults apart — the URL never names a repo", async () => {
    const alpha = await signUpUser("vault-git-alpha@example.test");
    const alphaDevice = await pairDevice(alpha.bearer, "Laptop");
    const beta = await signUpUser("vault-git-beta@example.test");
    const betaDevice = await pairDevice(beta.bearer, "Laptop");

    const pushed = await pushVaultFiles(
      alphaDevice.credential,
      "vault: initialize",
      [{ path: "secret.md", content: "alpha's note\n" }],
      ZERO_OID,
    );
    expect(pushed.response.status).toBe(200);

    // The same URL under beta's credential reaches a DIFFERENT (empty) repo.
    const refs = await SELF.fetch(`${REMOTE}/info/refs?service=git-upload-pack`, {
      headers: deviceHeaders(betaDevice.credential),
    });
    expect(refs.status).toBe(404);
  });
});
