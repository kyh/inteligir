import { syncPingSchema, type SyncPing } from "@repo/api/cloud/sync/sync-ws";
import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { deviceHeaders, ORIGIN, pairDevice, signUpUser } from "./cloud-helpers";

// The hosted vault remote end to end, in-process: credential verification on
// both carriers, the identity-free URL rewrite, a REAL push (pkt-line +
// packfile built by hand below — workerd has SHA-1 and zlib, git's formats
// are documented, and nothing else proves the ingest path), the clone leg
// over what was pushed, and the vault ping's pusher exclusion.

const REMOTE = `${ORIGIN}/v1/git/vault.git`;

// -- a minimal git object/pack builder --------------------------------------

const encoder = new TextEncoder();

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

async function sha1(bytes: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-1", bytes));
}

function hex(bytes: Uint8Array): string {
  let out = "";
  for (const b of bytes) out += b.toString(16).padStart(2, "0");
  return out;
}

/** zlib-wrapped DEFLATE, the per-object encoding inside a pack. */
async function deflate(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new CompressionStream("deflate");
  const writer = stream.writable.getWriter();
  const wrote = (async () => {
    await writer.write(bytes);
    await writer.close();
  })();
  const out = new Uint8Array(await new Response(stream.readable).arrayBuffer());
  await wrote;
  return out;
}

type GitObject = {
  /** pack type code: commit=1, tree=2, blob=3 */
  type: 1 | 2 | 3;
  oid: string;
  raw: Uint8Array;
};

const TYPE_NAMES = { 1: "commit", 2: "tree", 3: "blob" } as const;

async function gitObject(type: 1 | 2 | 3, raw: Uint8Array): Promise<GitObject> {
  const header = encoder.encode(`${TYPE_NAMES[type]} ${raw.length}\0`);
  return { type, oid: hex(await sha1(concat([header, raw]))), raw };
}

function oidBytes(oid: string): Uint8Array {
  const out = new Uint8Array(20);
  for (let i = 0; i < 20; i += 1) out[i] = parseInt(oid.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/** The pack entry header: 4 bits of type, size in little-endian 7-bit groups. */
function entryHeader(type: number, size: number): Uint8Array {
  const bytes: number[] = [];
  let first = (type << 4) | (size & 0x0f);
  let rest = size >> 4;
  while (rest > 0) {
    bytes.push(first | 0x80);
    first = rest & 0x7f;
    rest >>= 7;
  }
  bytes.push(first);
  return new Uint8Array(bytes);
}

async function buildPack(objects: GitObject[]): Promise<Uint8Array> {
  const head = new Uint8Array(12);
  head.set(encoder.encode("PACK"));
  new DataView(head.buffer).setUint32(4, 2);
  new DataView(head.buffer).setUint32(8, objects.length);
  const entries: Uint8Array[] = [head];
  for (const object of objects) {
    entries.push(entryHeader(object.type, object.raw.length), await deflate(object.raw));
  }
  const body = concat(entries);
  return concat([body, await sha1(body)]);
}

function pktLine(text: string): Uint8Array {
  const payload = encoder.encode(text);
  const length = (payload.length + 4).toString(16).padStart(4, "0");
  return concat([encoder.encode(length), payload]);
}

/** One commit ("<message>") holding one file, parented on `parent`. Returns
 *  the receive-pack body updating refs/heads/main from `oldOid`. */
async function pushBody(
  message: string,
  file: { path: string; content: string },
  oldOid: string,
  parent?: string,
): Promise<{ body: Uint8Array; commit: string }> {
  const blob = await gitObject(3, encoder.encode(file.content));
  const tree = await gitObject(
    2,
    concat([encoder.encode(`100644 ${file.path}\0`), oidBytes(blob.oid)]),
  );
  const person = "Test <t@example.test> 1700000000 +0000";
  const commit = await gitObject(
    1,
    encoder.encode(
      `tree ${tree.oid}\n` +
        (parent === undefined ? "" : `parent ${parent}\n`) +
        `author ${person}\ncommitter ${person}\n\n${message}\n`,
    ),
  );
  const command = pktLine(`${oldOid} ${commit.oid} refs/heads/main\0report-status`);
  const body = concat([command, encoder.encode("0000"), await buildPack([blob, tree, commit])]);
  return { body, commit: commit.oid };
}

const ZERO_OID = "0".repeat(40);

async function push(
  credential: string,
  message: string,
  file: { path: string; content: string },
  oldOid: string,
  parent?: string,
): Promise<{ response: Response; commit: string }> {
  const { body, commit } = await pushBody(message, file, oldOid, parent);
  const response = await SELF.fetch(`${REMOTE}/git-receive-pack`, {
    method: "POST",
    headers: {
      ...deviceHeaders(credential),
      "content-type": "application/x-git-receive-pack-request",
    },
    body,
  });
  return { response, commit };
}

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

    const first = await push(
      pusher.credential,
      "vault: initialize",
      { path: "welcome.md", content: "# hello\n" },
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
    const second = await push(
      pusher.credential,
      "vault: update welcome.md",
      { path: "welcome.md", content: "# hello again\n" },
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

    const pushed = await push(
      alphaDevice.credential,
      "vault: initialize",
      { path: "secret.md", content: "alpha's note\n" },
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
