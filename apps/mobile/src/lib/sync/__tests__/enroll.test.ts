import { describe, expect, it } from "vitest";

import type { FetchFn } from "@repo/notes/sync/http-sync-port";
import {
  base64UrlEncode,
  DEVICE_ASSERTION_VERSION,
  formatPairingBlob,
  MIN_ENROLL_SECRET_BYTES,
} from "@repo/notes/sync/wire";

import type { StringStorePort } from "../../host/environment-store";
import type { DeviceKeyPair } from "../device-key";
import { createDeviceStore } from "../device-store";
import { enrollWithPairingBlob, type EnrollPorts } from "../enroll";

const COORDINATOR = "https://sync.example.workers.dev";
const VAULT_ID = `v1${"a".repeat(52)}`;
const KEY: DeviceKeyPair = {
  secretKey: base64UrlEncode(new Uint8Array(32).fill(7)),
  publicKey: base64UrlEncode(new Uint8Array(32).fill(9)),
};

describe("enrollWithPairingBlob", () => {
  it("redeems a blob and persists the enrollment", async () => {
    const { ports, store, calls } = harness({ ok: true });
    const result = await enrollWithPairingBlob(ports, ` ${pairingBlob()} \n`, "iPhone");

    expect(result.ok).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(`${COORDINATOR}/v1/vault/${VAULT_ID}/enroll`);
    expect(calls[0]?.body).toEqual({
      s: secret(),
      publicKey: KEY.publicKey,
      deviceName: "iPhone",
    });

    // The store is the contract the credential seam reads back through.
    expect(store.get()).toEqual({
      url: COORDINATOR,
      vaultId: VAULT_ID,
      publicKey: KEY.publicKey,
      enrolledAt: 1_770_000_000_000,
    });
    expect(store.key()).toEqual(KEY);
  });

  it("refuses a blob that isn't one, without calling the coordinator", async () => {
    const { ports, store, calls } = harness({ ok: true });
    const result = await enrollWithPairingBlob(ports, "paste me later", "iPhone");

    expect(result).toEqual({ ok: false, error: expect.stringContaining("pairing code") });
    expect(calls).toHaveLength(0);
    expect(store.get()).toBeNull();
  });

  it("persists nothing when the coordinator refuses the offer", async () => {
    const { ports, store } = harness({ ok: false });
    const result = await enrollWithPairingBlob(ports, pairingBlob(), "iPhone");

    expect(result.ok).toBe(false);
    expect(store.get()).toBeNull();
    expect(store.key()).toBeNull();
  });

  it("reports a transport failure as a value", async () => {
    const { ports, store } = harness(new Error("Network request failed"));
    const result = await enrollWithPairingBlob(ports, pairingBlob(), "iPhone");

    expect(result).toEqual({ ok: false, error: "Network request failed" });
    expect(store.get()).toBeNull();
  });
});

describe("device store", () => {
  it("reads a tampered vault id as no enrollment at all", () => {
    const port = memoryPort();
    const store = createDeviceStore(port);
    store.save(
      { url: COORDINATOR, vaultId: VAULT_ID, publicKey: KEY.publicKey, enrolledAt: 1 },
      KEY.secretKey,
    );
    expect(store.get()).not.toBeNull();

    port.set(
      "inteligir.device",
      JSON.stringify({
        version: 1,
        device: {
          url: COORDINATOR,
          vaultId: "not-a-vault",
          publicKey: KEY.publicKey,
          enrolledAt: 1,
        },
      }),
    );
    expect(store.get()).toBeNull();
    expect(store.key()).toBeNull();
  });

  it("forgets both halves on clear", () => {
    const port = memoryPort();
    const store = createDeviceStore(port);
    store.save(
      { url: COORDINATOR, vaultId: VAULT_ID, publicKey: KEY.publicKey, enrolledAt: 1 },
      KEY.secretKey,
    );
    store.clear();
    expect(store.get()).toBeNull();
    expect(port.get("inteligir.deviceKey")).toBeNull();
  });
});

// ---- harness ---------------------------------------------------------------

function memoryPort(): StringStorePort {
  const entries = new Map<string, string>();
  return {
    get: (key) => entries.get(key) ?? null,
    set: (key, value) => {
      entries.set(key, value);
    },
    delete: (key) => {
      entries.delete(key);
    },
  };
}

function secret(): string {
  return base64UrlEncode(new Uint8Array(MIN_ENROLL_SECRET_BYTES).fill(3));
}

function pairingBlob(): string {
  const blob = formatPairingBlob({
    v: DEVICE_ASSERTION_VERSION,
    url: COORDINATOR,
    vid: VAULT_ID,
    s: secret(),
  });
  if (blob === null) throw new Error("test fixture is not a valid pairing blob");
  return blob;
}

type Call = { readonly url: string; readonly body: unknown };

/** `answer` is either the JSON body the coordinator returns, or the error the
 * transport throws. */
function harness(answer: { ok: boolean } | Error): {
  ports: EnrollPorts;
  store: ReturnType<typeof createDeviceStore>;
  calls: Call[];
} {
  const store = createDeviceStore(memoryPort());
  const calls: Call[] = [];
  const fetchImpl: FetchFn = (input, init) => {
    if (answer instanceof Error) return Promise.reject(answer);
    const body = typeof init?.body === "string" ? init.body : "";
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    calls.push({ url, body: JSON.parse(body) });
    return Promise.resolve(
      new Response(JSON.stringify(answer), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
  };
  return {
    ports: { store, generateKey: () => KEY, fetchImpl, now: () => 1_770_000_000_000 },
    store,
    calls,
  };
}
