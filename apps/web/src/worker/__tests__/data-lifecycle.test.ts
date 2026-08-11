// ---------------------------------------------------------------------------
// What happens to a user's BYTES over time: the archive they can take out, the
// budgets that bound what each HTTP leaf costs, the retention that prunes
// snapshot blobs rather than only their rows, and the purge that runs when the
// account itself goes.
//
// All of it against the real substrate — the object's SQLite, the real R2
// bucket, Better Auth on the real D1 — because every assertion here is about
// storage actually being written or actually being gone, which a fake cannot
// say anything about.
// ---------------------------------------------------------------------------

import { env, runInDurableObject, SELF } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";

import { userHostName } from "../host/host-address";
import { planExport } from "../host/vault-export";
import { purgeR2Prefix } from "../host/vault/r2-prefix";
import { MAX_ENTRIES, MAX_TOTAL_BYTES, zipStream, type ZipSource } from "../host/vault/zip-stream";
import { authenticated, invoke, ORIGIN, signUp, WEB_ORIGIN, type Account } from "./host-helpers";

let exporter: Account;
let limited: Account;
let doomed: Account;

beforeAll(async () => {
  exporter = await signUp("lifecycle-export@example.com");
  limited = await signUp("lifecycle-limit@example.com");
  doomed = await signUp("lifecycle-delete@example.com");
});

// ---------------------------------------------------------------------------
// A real zip reader, so the archive is checked against the FORMAT rather than
// against the encoder that wrote it. It walks the central directory the way a
// decompressor does — an entry the directory does not name is an entry no tool
// would extract, however well-formed the bytes before it looked.
// ---------------------------------------------------------------------------

const EOCD_SIGNATURE = 0x06054b50;

async function readZip(bytes: Uint8Array): Promise<Map<string, string>> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  for (let at = bytes.length - 22; at >= 0; at--) {
    if (view.getUint32(at, true) === EOCD_SIGNATURE) {
      eocd = at;
      break;
    }
  }
  if (eocd < 0) throw new Error("no end-of-central-directory record");
  const count = view.getUint16(10 + eocd, true);
  let at = view.getUint32(16 + eocd, true);

  const decoder = new TextDecoder();
  const entries = new Map<string, string>();
  for (let index = 0; index < count; index++) {
    if (view.getUint32(at, true) !== 0x02014b50) throw new Error("bad central header");
    const compressedSize = view.getUint32(at + 20, true);
    const nameLength = view.getUint16(at + 28, true);
    const extraLength = view.getUint16(at + 30, true);
    const commentLength = view.getUint16(at + 32, true);
    const localOffset = view.getUint32(at + 42, true);
    const name = decoder.decode(bytes.subarray(at + 46, at + 46 + nameLength));

    if (view.getUint32(localOffset, true) !== 0x04034b50) throw new Error("bad local header");
    const localNameLength = view.getUint16(localOffset + 26, true);
    const localExtraLength = view.getUint16(localOffset + 28, true);
    const start = localOffset + 30 + localNameLength + localExtraLength;
    entries.set(name, await inflate(bytes.subarray(start, start + compressedSize)));

    at += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

async function inflate(deflated: Uint8Array): Promise<string> {
  const source = new Blob([deflated]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Response(source).text();
}

function sourceOf(name: string, text: string): ZipSource {
  return {
    name,
    open: () => Promise.resolve(new Blob([text]).stream()),
  };
}

const FIXED_CLOCK = () => new Date("2026-08-06T12:34:56Z");

describe("the zip encoder", () => {
  it("produces an archive a reader can walk and inflate", async () => {
    const body = zipStream(
      [
        sourceOf("Welcome.md", "# Welcome\n\nHello.\n"),
        sourceOf("notes/deep/one.md", "a".repeat(50_000)),
        // Non-ASCII in a name is why the UTF-8 flag is set.
        sourceOf("notes/café ☕.md", "accented"),
      ],
      FIXED_CLOCK,
    );
    const bytes = new Uint8Array(await new Response(body).arrayBuffer());
    const entries = await readZip(bytes);

    expect([...entries.keys()].toSorted()).toEqual([
      "Welcome.md",
      "notes/café ☕.md",
      "notes/deep/one.md",
    ]);
    expect(entries.get("Welcome.md")).toBe("# Welcome\n\nHello.\n");
    expect(entries.get("notes/deep/one.md")).toBe("a".repeat(50_000));
    expect(entries.get("notes/café ☕.md")).toBe("accented");
    // Deflate earned its keep: 50 KB of one byte is not 50 KB of archive.
    expect(bytes.length).toBeLessThan(5_000);
  });

  it("leaves out a member whose bytes are gone rather than aborting", async () => {
    const body = zipStream(
      [{ name: "missing.md", open: () => Promise.resolve(null) }, sourceOf("here.md", "kept")],
      FIXED_CLOCK,
    );
    const entries = await readZip(new Uint8Array(await new Response(body).arrayBuffer()));
    expect([...entries.keys()]).toEqual(["here.md"]);
  });

  it("is pull-driven — an abandoned archive opens one member, not the vault", async () => {
    let opened = 0;
    const counted = (name: string): ZipSource => ({
      name,
      open: () => {
        opened += 1;
        return Promise.resolve(new Blob(["x"]).stream());
      },
    });
    const names = ["a.md", "b.md", "c.md", "d.md", "e.md"];
    const body = zipStream(names.map(counted), FIXED_CLOCK);
    // A stream fills one chunk ahead, so the member being written is open and
    // no other is. That bound is the whole design: a download nobody finishes
    // costs one R2 GET rather than a vault's worth.
    await body.cancel();
    expect(opened).toBeLessThanOrEqual(1);
  });
});

describe("the export plan", () => {
  it("refuses BEFORE streaming when the vault is past the format's ceilings", () => {
    expect(planExport([{ path: "a.md", size: 10 }])).toEqual({ ok: true, files: ["a.md"] });

    const huge = planExport([
      { path: "a.md", size: MAX_TOTAL_BYTES },
      { path: "b.md", size: 1 },
    ]);
    expect(huge).toMatchObject({ ok: false, reason: "too-large" });

    const many = Array.from({ length: MAX_ENTRIES + 1 }, (_, index) => ({
      path: `n${index}.md`,
      size: 1,
    }));
    expect(planExport(many)).toMatchObject({ ok: false, reason: "too-many", entries: 65536 });
  });
});

describe("GET /v1/host/export", () => {
  it("hands back the whole vault as a zip of its markdown", async () => {
    const { ws, frames } = await authenticated(exporter);
    expect(
      await invoke(ws, frames, 1, "writeVaultFile", {
        path: "notes/exported.md",
        content: "# Exported\n\nTaken with me.\n",
      }),
    ).toMatchObject({ ok: true });
    ws.close(1000, "done");

    const response = await SELF.fetch(`${ORIGIN}/v1/host/export`, {
      headers: { cookie: exporter.cookie },
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/zip");
    expect(response.headers.get("content-disposition")).toMatch(
      /^attachment; filename="inteligir-vault-\d{4}-\d{2}-\d{2}\.zip"$/,
    );

    const entries = await readZip(new Uint8Array(await response.arrayBuffer()));
    expect(entries.get("notes/exported.md")).toBe("# Exported\n\nTaken with me.\n");
    // The seed is in there too — everything the listing shows, nothing it does not.
    expect(entries.size).toBeGreaterThan(1);
  });

  it("refuses a caller with no session", async () => {
    expect((await SELF.fetch(`${ORIGIN}/v1/host/export`)).status).toBe(401);
  });

  it("refuses the companion class, which reaches no vault channel at all", async () => {
    // The same account, the same vault, over the credential that decides the
    // companion class. The socket refuses it one note; this leaf must not hand
    // it every note in a zip.
    const { ws, frames } = await authenticated(exporter, "mobile");
    const overSocket = await invoke(ws, frames, 1, "readVaultFile", {
      path: "notes/exported.md",
    });
    ws.close(1000, "done");
    expect(overSocket).toMatchObject({ ok: false });

    const overHttp = await SELF.fetch(`${ORIGIN}/v1/host/export`, {
      headers: { authorization: `Bearer ${exporter.token}` },
    });
    expect(overHttp.status).toBe(403);
  });

  it("still serves the browser's own download, which carries no Origin", async () => {
    // The refusal above must not be spelled as "no derivable client class": a
    // top-level navigation sends the cookie and NO Origin, so that is exactly
    // what the download this route exists for looks like.
    const download = await SELF.fetch(`${ORIGIN}/v1/host/export`, {
      headers: { cookie: exporter.cookie },
    });
    expect(download.status).toBe(200);
    await download.arrayBuffer();
  });
});

describe("host rate budgets", () => {
  it("spends the export budget and then answers 429 with a retry-after", async () => {
    // The budget is deliberately the tightest one: this leaf reads the whole
    // vault out of R2 and is the one a cross-site page could provoke.
    const attempt = () =>
      SELF.fetch(`${ORIGIN}/v1/host/export`, { headers: { cookie: limited.cookie } });
    for (let index = 0; index < 5; index++) {
      const allowed = await attempt();
      expect(allowed.status, `export ${index} should be within budget`).toBe(200);
      await allowed.arrayBuffer();
    }
    const refused = await attempt();
    expect(refused.status).toBe(429);
    expect(Number(refused.headers.get("retry-after"))).toBeGreaterThan(0);
  });

  it("charges each leaf its own budget", async () => {
    // The export above is spent for this account; a ticket mint is not, because
    // the ledger is per leaf rather than per object.
    const mint = await SELF.fetch(`${ORIGIN}/v1/host/ticket`, {
      method: "POST",
      headers: { cookie: limited.cookie, origin: WEB_ORIGIN },
    });
    expect(mint.status).toBe(200);
  });
});

describe("snapshot retention", () => {
  it("prunes the blob, not only the row, past the per-origin cap", async () => {
    const stub = env.UserHost.getByName(userHostName("test:snapshot-retention"));
    const keys = await runInDurableObject(stub, async (host) => {
      await host.vault.writeText("note.md", "v0");
      const captured: string[] = [];
      // One past the cap of 50, so the oldest is evicted.
      for (let index = 0; index <= 50; index++) {
        const id = await host.agent.snapshots.capture({ origin: "chat", ref: "thread" }, "note.md");
        expect(id).not.toBeNull();
        if (id !== null) captured.push(id);
        await host.vault.writeText("note.md", `v${index + 1}`);
      }
      return captured;
    });

    const oldest = keys[0] ?? "";
    const newest = keys[keys.length - 1] ?? "";
    await runInDurableObject(stub, (host) => {
      expect(host.agent.snapshots.holds(oldest), "the oldest row should be pruned").toBe(false);
      expect(host.agent.snapshots.holds(newest)).toBe(true);
    });
    // The row going is not the point — the BYTES are. Fifty blobs survive, and
    // the evicted one's is gone from R2.
    const stored = await env.VAULT_FILES.list({
      prefix: `${userHostName("test:snapshot-retention")}/.snapshots/`,
    });
    expect(stored.objects).toHaveLength(50);
  });
});

describe("account deletion", () => {
  it("erases the object's storage and the R2 prefix through Better Auth", async () => {
    const { ws, frames } = await authenticated(doomed);
    expect(
      await invoke(ws, frames, 1, "writeVaultFile", {
        path: "notes/private-thoughts.md",
        content: "# Mine\n",
      }),
    ).toMatchObject({ ok: true });
    ws.close(1000, "done");

    const prefix = `${userHostName(doomed.userId)}/`;
    expect((await env.VAULT_FILES.list({ prefix })).objects.length).toBeGreaterThan(0);

    const deleted = await SELF.fetch(`${ORIGIN}/api/auth/delete-user`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: doomed.cookie,
        origin: ORIGIN,
      },
      body: JSON.stringify({ password: "test-password-1234" }),
    });
    expect(deleted.status).toBe(200);

    // The bytes: gone, prefix and all.
    expect((await env.VAULT_FILES.list({ prefix })).objects).toEqual([]);
    // The object: emptied. `deleteAll` takes the SQLite tables, the KV keys and
    // the alarm together.
    const stub = env.UserHost.getByName(userHostName(doomed.userId));
    await runInDurableObject(stub, async (_host, state) => {
      expect(await state.storage.getAlarm()).toBeNull();
      const tables = state.storage.sql
        .exec<{ name: string }>(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'vault_files'",
        )
        .toArray();
      expect(tables).toEqual([]);
    });
    // The session: gone with the row, so the credential reaches nothing.
    const session = await SELF.fetch(`${ORIGIN}/api/auth/get-session`, {
      headers: { cookie: doomed.cookie, origin: ORIGIN },
    });
    expect(await session.json()).toBeNull();
    expect(
      (await SELF.fetch(`${ORIGIN}/v1/host/export`, { headers: { cookie: doomed.cookie } })).status,
    ).toBe(401);
  });

  it("purges idempotently — a retry after a half-failed delete resumes", async () => {
    const prefix = `${userHostName("test:purge-twice")}/`;
    const stub = env.UserHost.getByName(userHostName("test:purge-twice"));
    await runInDurableObject(stub, async (host) => {
      await host.vault.writeText("note.md", "bytes");
    });
    expect((await env.VAULT_FILES.list({ prefix })).objects.length).toBeGreaterThan(0);

    await stub.purgeAccount();
    await stub.purgeAccount();
    expect((await env.VAULT_FILES.list({ prefix })).objects).toEqual([]);
  });

  it("sweeps a prefix without touching the account whose id it prefixes", async () => {
    await env.VAULT_FILES.put("user:12/note.md", "mine");
    await env.VAULT_FILES.put("user:123/note.md", "not mine");
    expect(await purgeR2Prefix(env.VAULT_FILES, "user:12")).toBe(1);
    expect(await env.VAULT_FILES.head("user:123/note.md")).not.toBeNull();
  });
});
