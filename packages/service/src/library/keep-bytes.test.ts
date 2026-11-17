import { describe, expect, it } from "vitest";

import type { Settlement } from "./cell-blobs";
import { keepBytes } from "./keep-bytes";
import type { KeepPort } from "./keep-bytes";

const SHA = "a".repeat(64);

const FILE = {
  accountId: "account-1",
  body: async () => await Promise.resolve(new Uint8Array([1, 2, 3])),
  mime: "image/png",
  sha: SHA,
  size: 3,
};

// a cell that gives room unless the file is `held`, and settles as `settled` says
const cellPort = (room: { readonly held: boolean }, settled: Settlement) => {
  const settles: string[] = [];
  const port: KeepPort = {
    reserve: () => ({ ok: true, value: room }),
    settle: async (sha) => {
      settles.push(sha);
      return await Promise.resolve({ ok: true, value: settled });
    },
  };
  return { port, settles };
};

const putting = (failure: Error | null) => {
  const puts: string[] = [];
  return {
    bucket: {
      put: async (key: string) => {
        puts.push(key);
        if (failure !== null) {
          throw failure;
        }
        return await Promise.resolve(null);
      },
    },
    puts,
  };
};

describe("a file kept in the library", () => {
  it("sends nothing the library holds already", async () => {
    const { port, settles } = cellPort({ held: true }, "held");
    const { bucket, puts } = putting(null);
    await expect(keepBytes(bucket, port, FILE)).resolves.toStrictEqual({ kind: "held" });
    expect([puts, settles]).toStrictEqual([[], []]);
  });

  it("gives back the room of a put R2 failed, and says whether its bytes were wrong", async () => {
    const digest = new Error("put: The SHA-256 checksum you specified did not match. (10037)");
    for (const [failure, badDigest] of [
      [digest, true],
      [new Error("put: internal error (10001)"), false],
    ] as const) {
      const { port, settles } = cellPort({ held: false }, "absent");
      const { bucket } = putting(failure);
      await expect(keepBytes(bucket, port, FILE)).resolves.toMatchObject({
        badDigest,
        kind: "unput",
      });
      expect(settles).toStrictEqual([SHA]);
    }
  });

  it("is kept once settled, and raced whichever way a removal took what it put", async () => {
    const kept = cellPort({ held: false }, "held");
    await expect(keepBytes(putting(null).bucket, kept.port, FILE)).resolves.toStrictEqual({
      kind: "kept",
    });
    for (const settled of ["absent", "removing", "stale"] as const) {
      const raced = cellPort({ held: false }, settled);
      await expect(keepBytes(putting(null).bucket, raced.port, FILE)).resolves.toStrictEqual({
        kind: "raced",
      });
    }
  });

  it("puts nothing the cell gives no room for", async () => {
    const { bucket, puts } = putting(null);
    const full: KeepPort = {
      reserve: () => ({ ok: false, refusal: { bytesCap: 3, bytesUsed: 3, kind: "quota" } }),
      settle: async () => await Promise.resolve({ ok: true, value: "held" }),
    };
    await expect(keepBytes(bucket, full, FILE)).resolves.toStrictEqual({
      kind: "refused",
      refusal: { bytesCap: 3, bytesUsed: 3, kind: "quota" },
    });
    expect(puts).toStrictEqual([]);
  });
});
