import { runInDurableObject, SELF } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { describe, expect, it, vi } from "vitest";
import {
  deviceHeaders,
  openSocket,
  ORIGIN,
  loginDevice,
  sessionHeaders,
  signUpUser,
  userIdOf,
} from "./cloud-helpers";
import { pushVaultFiles, ZERO_OID } from "./git-pack";

const REMOTE = `${ORIGIN}/v1/git/vault.git`;

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
    const { credential } = await loginDevice(bearer, "Laptop");
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
    const { credential } = await loginDevice(bearer, "Laptop");
    const response = await SELF.fetch(`${REMOTE}/info/refs?service=git-receive-pack`, {
      headers: { authorization: `Basic ${btoa(`x:${credential}`)}` },
    });
    expect(response.status).toBe(200);
  });

  it("answers 404 on the fetch leg of a vault never pushed", async () => {
    const { bearer } = await signUpUser("vault-git-empty@example.test");
    const { credential } = await loginDevice(bearer, "Laptop");
    const response = await SELF.fetch(`${REMOTE}/info/refs?service=git-upload-pack`, {
      headers: deviceHeaders(credential),
    });
    expect(response.status).toBe(404);
  });

  it("refuses an upload-pack body that declares no length", async () => {
    const { bearer } = await signUpUser("vault-git-chunked@example.test");
    const { credential } = await loginDevice(bearer, "Laptop");
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("0000"));
        controller.close();
      },
    });
    const response = await SELF.fetch(`${REMOTE}/git-upload-pack`, {
      body,
      headers: {
        ...deviceHeaders(credential),
        "content-type": "application/x-git-upload-pack-request",
      },
      method: "POST",
    });
    expect(response.status).toBe(413);
  });

  it("keeps the JSON API and admin surface off the wire", async () => {
    const { bearer } = await signUpUser("vault-git-surface@example.test");
    const { credential } = await loginDevice(bearer, "Laptop");
    const api = await SELF.fetch(`${REMOTE}/api/refs`, { headers: deviceHeaders(credential) });
    expect(api.status).toBe(404);
    const admin = await SELF.fetch(`${REMOTE}/`, {
      headers: deviceHeaders(credential),
      method: "DELETE",
    });
    expect(admin.status).toBe(404);
  });
});

describe("vault git remote round-trip", () => {
  it("pushes, advertises what was pushed, and pings every device but the pusher", async () => {
    const { bearer } = await signUpUser("vault-git-push@example.test");
    const pusher = await loginDevice(bearer, "Laptop");
    const other = await loginDevice(bearer, "Phone");

    const pusherSocket = await openSocket(pusher.credential, "desktop");
    const otherSocket = await openSocket(other.credential, "desktop");

    const first = await pushVaultFiles(
      pusher.credential,
      "vault: initialize",
      [{ content: "# hello\n", path: "welcome.md" }],
      ZERO_OID,
    );
    expect(first.response.status).toBe(200);
    expect(await first.response.text()).toContain("unpack ok");

    await vi.waitFor(() => {
      expect(otherSocket.frames).toContainEqual({ type: "vault" });
    });
    expect(pusherSocket.frames).not.toContainEqual({ type: "vault" });

    const refs = await SELF.fetch(`${REMOTE}/info/refs?service=git-upload-pack`, {
      headers: deviceHeaders(other.credential),
    });
    expect(refs.status).toBe(200);
    expect(await refs.text()).toContain(first.commit);

    const second = await pushVaultFiles(
      pusher.credential,
      "vault: update welcome.md",
      [{ content: "# hello again\n", path: "welcome.md" }],
      first.commit,
      first.commit,
    );
    expect(second.response.status).toBe(200);
    expect(await second.response.text()).toContain("unpack ok");
  });

  it("keeps two users' vaults apart — the URL never names a repo", async () => {
    const alpha = await signUpUser("vault-git-alpha@example.test");
    const alphaDevice = await loginDevice(alpha.bearer, "Laptop");
    const beta = await signUpUser("vault-git-beta@example.test");
    const betaDevice = await loginDevice(beta.bearer, "Laptop");

    const pushed = await pushVaultFiles(
      alphaDevice.credential,
      "vault: initialize",
      [{ content: "alpha's note\n", path: "secret.md" }],
      ZERO_OID,
    );
    expect(pushed.response.status).toBe(200);

    const refs = await SELF.fetch(`${REMOTE}/info/refs?service=git-upload-pack`, {
      headers: deviceHeaders(betaDevice.credential),
    });
    expect(refs.status).toBe(404);
  });
});

describe("account deletion's vault half", () => {
  it("wipes the repo cell and the registry row with the account", async () => {
    const { bearer, password } = await signUpUser("vault-git-delete@example.test");
    const { credential } = await loginDevice(bearer, "Laptop");
    const pushed = await pushVaultFiles(
      credential,
      "vault: initialize",
      [{ content: "note bytes the deletion promise covers\n", path: "secret.md" }],
      ZERO_OID,
    );
    expect(pushed.response.status).toBe(200);
    const userId = await userIdOf(bearer);

    const deletion = await SELF.fetch(`${ORIGIN}/api/auth/delete-user`, {
      body: JSON.stringify({ password }),
      headers: { ...sessionHeaders(bearer), "content-type": "application/json" },
      method: "POST",
    });
    expect(deletion.status).toBe(200);

    const refused = await SELF.fetch(`${REMOTE}/info/refs?service=git-upload-pack`, {
      headers: deviceHeaders(credential),
    });
    expect(refused.status).toBe(401);

    expect(await env.REGISTRY.getByName("registry").get(`vault-${userId}`)).toBeNull();

    // read off the SQL: the wire refuses a revoked credential before it could prove the wipe
    const stub = env.REPO.getByName(`vault-${userId}`);
    const rows = await runInDurableObject(stub, (_instance, state) => ({
      objects: state.storage.sql.exec("SELECT COUNT(*) AS n FROM objects").one().n,
      refs: state.storage.sql.exec("SELECT COUNT(*) AS n FROM refs").one().n,
    }));
    expect(rows).toEqual({ objects: 0, refs: 0 });
  });
});
