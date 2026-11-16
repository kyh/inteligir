// A file in an account's library as a device's upload leaves it, its room held, its bytes in R2
// and its row settled, and the cell's alarm run until what it waits for is done.

import { bytesToHex } from "@noble/hashes/utils.js";
import { UNKNOWN_FILE_TYPE } from "@repo/contract/items/item-kind";
import { runDurableObjectAlarm } from "cloudflare:test";
import { env } from "cloudflare:workers";

import { blobs } from "@repo/db/cell/schema";
import { blobKey } from "../library/cell-blobs";
import { cellDbOf } from "../library/cell-db";
import { settleStored } from "../library/cell-library";
import type { LibraryDO } from "../library/library-do";
import type { LibraryEngine } from "../library/library-engine";

// what a put can meet that says nothing of its bytes, as the runtime throws it
// (https://developers.cloudflare.com/r2/api/error-codes/), each with the name a test reads
export const R2_FAULTS = [
  ["an internal error", new Error("put: We encountered an internal error. (10001)")],
  ["an outage", new Error("put: The service is temporarily unavailable. (10043)")],
  ["two devices writing one key", new Error("put: Reduce your concurrent request rate. (10058)")],
  ["a body that broke off", new TypeError("Network connection lost.")],
] as const;

const shaOf = async (bytes: Uint8Array): Promise<string> =>
  bytesToHex(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)));

// the file's sha once the library holds it
export const uploadedFile = async (
  library: LibraryEngine,
  accountId: string,
  file: { readonly bytes: Uint8Array; readonly mime: string },
): Promise<string> => {
  const sha = await shaOf(file.bytes);
  const room = library.reserve({ bytes: file.bytes.length, mime: file.mime, sha });
  if (!room.ok) {
    throw new Error(`the library refused the file: ${room.refusal.kind}`);
  }
  await env.BLOBS.put(blobKey(accountId, sha), file.bytes, {
    httpMetadata: { contentType: file.mime },
    sha256: sha,
  });
  const settled = await settleStored(env, accountId, library, sha);
  if (!settled.ok || !settled.value.settled) {
    throw new Error("the library did not settle the file");
  }
  return sha;
};

// a file's row of `bytes` that no upload made: what fills a library to its cap for a test
export const holdFileOf = (storage: DurableObjectStorage, bytes: number): void => {
  cellDbOf(storage)
    .insert(blobs)
    .values({ bytes, mime: UNKNOWN_FILE_TYPE, sha256: "f".repeat(64) })
    .run();
};

// the cell's alarm run until `done` holds, at most `limit` times: the platform also runs an alarm
// that comes due by itself, so each turn runs one if one is waiting and then looks again
export const runAlarmsUntil = async (
  stub: DurableObjectStub<LibraryDO>,
  done: () => Promise<boolean>,
  limit = 100,
): Promise<void> => {
  for (let turn = 0; turn < limit; turn += 1) {
    if (await done()) {
      return;
    }
    await runDurableObjectAlarm(stub);
    await scheduler.wait(5);
  }
  throw new Error("the alarm ran its turns and the work never ended");
};
