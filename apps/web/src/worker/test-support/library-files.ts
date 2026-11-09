// A file in an account's library as a device's upload leaves it, its room held, its bytes in R2
// and its row settled; an import of it started and run, by the cell's alarm or a run at a time;
// and a folder zipped, an Obsidian vault in small among them.

import { hexFromBytes } from "@repo/contract/bytes";
import { runDurableObjectAlarm } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { zipSync } from "fflate";
import type { Zippable } from "fflate";

import { libraryIn, pngOf } from "../fill/test-support/fill-cell";
import { blobKey } from "../library/cell-blobs";
import type { ImportHost } from "../library/cell-import-host";
import { runImports } from "../library/cell-imports";
import { openCellLibrary, scheduleAlarm, sendFills, settleStored } from "../library/cell-library";
import type { LibraryDO } from "../library/library-do";
import type { LibraryEngine } from "../library/library-engine";
import { cellOf, inCell } from "./library-cell";

// what a put can meet that says nothing of its bytes, as the runtime throws it
// (https://developers.cloudflare.com/r2/api/error-codes/), each with the name a test reads
export const R2_FAULTS = [
  ["an internal error", new Error("put: We encountered an internal error. (10001)")],
  ["an outage", new Error("put: The service is temporarily unavailable. (10043)")],
  ["two devices writing one key", new Error("put: Reduce your concurrent request rate. (10058)")],
  ["a body that broke off", new TypeError("Network connection lost.")],
] as const;

const shaOf = async (bytes: Uint8Array): Promise<string> =>
  hexFromBytes(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)));

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

const encoder = new TextEncoder();

// a folder zipped as another app zips one, each file's bytes by its path: its text deflated, its
// other files stored
export const zipOf = async (files: Readonly<Record<string, Uint8Array>>): Promise<Uint8Array> => {
  const zippable: Zippable = {};
  for (const [path, bytes] of Object.entries(files)) {
    const level = /\.(?:md|json|txt)$/u.test(path) ? 6 : 0;
    zippable[path] = [bytes, { level, mtime: new Date(Date.UTC(2026, 9, 1)) }];
  }
  return zipSync(zippable);
};

// an Obsidian vault in small: a note in a folder linking another and embedding a picture, a PDF
// no note embeds, and Obsidian's settings
export const OBSIDIAN_VAULT = {
  ".obsidian/app.json": encoder.encode("{}"),
  "Attachments/lone.pdf": encoder.encode("%PDF-1.7\n% a file no note embeds\n"),
  "Beta.md": encoder.encode("Beta's own words.\n"),
  "Notes/Alpha.md": encoder.encode(
    "---\ntags: [project]\n---\n# Alpha\n\nSee [[Beta]] and ![[pic.png]].\n",
  ),
  "pic.png": pngOf(400, 300),
} as const satisfies Readonly<Record<string, Uint8Array>>;

export interface Started {
  readonly jobId: string;
  readonly sha: string;
}

export const importJobOf = async (accountId: string, id: string) =>
  await inCell(cellOf(accountId), async (state) => {
    const answer = await libraryIn(state, accountId).imports.get({ id });
    return answer.job;
  });

export const ended = (accountId: string, id: string) => async () => {
  const job = await importJobOf(accountId, id);
  return job.state !== "running";
};

// the file uploaded and its import started; `alarm` sets the cell's alarm as the commit would, and
// without it the suite runs each of the job's runs itself
export const startImport = async (
  accountId: string,
  file: { readonly bytes: Uint8Array; readonly mime: string },
  source: "raindrop" | "markdown",
  alarm = false,
): Promise<Started> =>
  await inCell(cellOf(accountId), async (state) => {
    const library = openCellLibrary(state, env);
    const sha = await uploadedFile(library, accountId, file);
    const { job } = await libraryIn(state, accountId, library).imports.start({ sha, source });
    if (alarm) {
      await scheduleAlarm(state, library);
    }
    return { jobId: job.id, sha };
  });

// what an import's run works with inside the cell, as the alarm hands it over
export const jobHostIn = (
  state: DurableObjectState,
  accountId: string,
  library: LibraryEngine = openCellLibrary(state, env),
  now: () => number = Date.now,
): ImportHost => ({
  accountId,
  durable: async () => {
    await state.storage.sync();
  },
  env,
  library,
  now,
});

// one run of every import due, and the readings it asked for sent, as one alarm runs them
export const runImportsOnce = async (accountId: string): Promise<void> => {
  await inCell(cellOf(accountId), async (state) => {
    const library = openCellLibrary(state, env);
    await runImports(jobHostIn(state, accountId, library));
    await sendFills(state, env, library);
  });
};

// runs until the job ends, at most `limit`; how many it took
export const runImportToEnd = async (
  accountId: string,
  jobId: string,
  limit = 50,
): Promise<number> => {
  for (let runs = 0; runs < limit; runs += 1) {
    if (await ended(accountId, jobId)()) {
      return runs;
    }
    await runImportsOnce(accountId);
  }
  throw new Error("the import never ended");
};
