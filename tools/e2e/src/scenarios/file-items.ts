// files kept as items in the library in the cloud: a PDF, a recording, an archive and a picture
// each uploaded by its sha (`/v1/blobs/<sha>`) and made an item of its kind; a file past the cap
// refused before its bytes are read; each served as the apps read it, a PDF with no sandbox, a
// recording by its ranges, anything else under one; a deleted item's file kept for Deleted and the
// item restored whole; and a picture two items name kept when one of them is emptied from Deleted.

import { randomBytes } from "node:crypto";
import { once } from "node:events";
import { request } from "node:http";
import { clientBuildHeaders } from "@repo/contract/cloud/client-build";
import { PHONE_ORIGIN } from "@repo/contract/cloud/origin";
import { BLOB_MAX_BYTES, V1_BLOBS_PATH } from "@repo/contract/cloud/library/library-blobs";
import type { V1Client } from "@repo/contract/cloud/v1";
import { expect, expectEq } from "../harness/assert";
import { PHONE_BUILD, signInPhone, signUp } from "../harness/cloud-account";
import { WORKER_SCENARIO_TIMEOUT_MS } from "../harness/cloud-worker";
import type { CloudWorker } from "../harness/cloud-worker";
import { solidPng } from "../harness/png-pixels";
import type { Scenario, ScenarioContext } from "../harness/scenario";
import { asPhone, newItemId, readFile, uploadFile, v1Client } from "../harness/v1-wire";
import type { V1Caller } from "../harness/v1-wire";
import { z } from "zod";

interface Source {
  readonly name: string;
  readonly type: string;
  readonly bytes: Uint8Array<ArrayBuffer>;
  readonly kind: string;
}

const SOURCES: readonly Source[] = [
  {
    bytes: new Uint8Array(Buffer.concat([Buffer.from("%PDF-1.4\n"), randomBytes(4096)])),
    kind: "pdf",
    name: "Lecture notes.pdf",
    type: "application/pdf",
  },
  {
    bytes: new Uint8Array(
      Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), randomBytes(65_536)]),
    ),
    kind: "video",
    name: "clip.webm",
    type: "video/webm",
  },
  {
    bytes: new Uint8Array(Buffer.concat([Buffer.from("PK\u0003\u0004"), randomBytes(2048)])),
    kind: "file",
    name: "archive.zip",
    type: "application/zip",
  },
  {
    bytes: solidPng(48, 32, [220, 20, 30, 255]),
    kind: "image",
    name: "red.png",
    type: "image/png",
  },
];

interface Saved {
  readonly source: Source;
  readonly id: string;
  readonly sha: string;
}

type Library = V1Client["library"];

const bytesOf = async (response: Response): Promise<Buffer> =>
  Buffer.from(await response.arrayBuffer());

const saveAll = async (worker: CloudWorker, phone: V1Caller, library: Library) => {
  const saved = new Map<string, Saved>();
  for (const source of SOURCES) {
    const upload = await uploadFile(worker, phone, source);
    expectEq(upload.status, 201, `${source.name}'s upload`);
    const { item } = await library.items.createFile({
      folderId: null,
      id: newItemId(),
      name: source.name,
      savedAt: Date.now(),
      sha: upload.sha,
      tags: [],
    });
    const read = await library.items.read({ id: item.id });
    expectEq(read.fields.kind, source.kind, `${source.name}'s kind`);
    saved.set(source.name, { id: item.id, sha: upload.sha, source });
  }
  return saved;
};

// a PUT that declares a file past the cap: refused on its length, so not one byte is sent
const declaredPastTheCap = async (worker: CloudWorker, cookie: string): Promise<number> => {
  const put = request(`${worker.origin}${V1_BLOBS_PATH}/${"0".repeat(64)}`, {
    headers: {
      ...clientBuildHeaders(PHONE_BUILD),
      cookie,
      "expo-origin": PHONE_ORIGIN,
      "content-length": String(BLOB_MAX_BYTES + 1),
      "content-type": "video/mp4",
    },
    method: "PUT",
  });
  put.flushHeaders();
  const answered: unknown[] = await once(put, "response");
  const { statusCode } = z.object({ statusCode: z.number().int() }).parse(answered[0]);
  put.destroy();
  return statusCode;
};

const expectServed = async (
  worker: CloudWorker,
  phone: V1Caller,
  saved: ReadonlyMap<string, Saved>,
) => {
  const shaOf = (name: string): string => saved.get(name)?.sha ?? "";
  const pdf = await readFile(worker, phone, shaOf("Lecture notes.pdf"));
  expectEq(pdf.status, 200, "the PDF's read");
  expectEq(pdf.headers.get("content-type"), "application/pdf", "the PDF's type");
  const pdfPolicy = pdf.headers.get("content-security-policy") ?? "sandbox";
  expect(!pdfPolicy.includes("sandbox"), `a PDF has no sandbox: ${pdfPolicy}`);
  await pdf.arrayBuffer();

  const webm = saved.get("clip.webm");
  const probe = await readFile(worker, phone, shaOf("clip.webm"), { range: "bytes=0-1" });
  expectEq(probe.status, 206, "the recording's probe");
  expectEq(
    probe.headers.get("content-range"),
    `bytes 0-1/${String(webm?.source.bytes.length ?? 0)}`,
    "the probe's range",
  );
  const probed = await bytesOf(probe);
  expectEq(probed.length, 2, "the probe's bytes");

  const zip = await readFile(worker, phone, shaOf("archive.zip"));
  expect(
    (zip.headers.get("content-security-policy") ?? "").includes("sandbox"),
    "an archive is served under a sandbox",
  );
  expectEq(
    Buffer.compare(await bytesOf(zip), Buffer.from(saved.get("archive.zip")?.source.bytes ?? [])),
    0,
    "the archive's bytes",
  );
};

const expectDeleteAndRestore = async (
  ctx: ScenarioContext,
  worker: CloudWorker,
  phone: V1Caller,
  library: Library,
  pdf: Saved,
) => {
  ctx.log("deleting the PDF's item keeps its file for Deleted; restoring brings it back whole");
  const { deleted } = await library.items.delete({ ids: [pdf.id] });
  expectEq(deleted, [pdf.id], "the PDF's item deleted");
  const listed = await library.items.list({ kind: "pdf" });
  expectEq(listed.items.length, 0, "PDFs listed once it is deleted");
  const { restored: back } = await library.items.restore({ ids: [pdf.id] });
  expectEq(back, [pdf.id], "the PDF's item restored");
  const restored = await library.items.read({ id: pdf.id });
  expectEq([restored.fields.kind, restored.fields.deletedAt], ["pdf", null], "the restored item");
  const bytes = await bytesOf(await readFile(worker, phone, pdf.sha));
  expectEq(Buffer.compare(bytes, Buffer.from(pdf.source.bytes)), 0, "the restored PDF's bytes");
};

const expectSharedFileKept = async (
  ctx: ScenarioContext,
  worker: CloudWorker,
  phone: V1Caller,
  library: Library,
  picture: Saved,
) => {
  ctx.log("a picture two items name stays when one of them is emptied from Deleted");
  const { item: second } = await library.items.createFile({
    folderId: null,
    id: newItemId(),
    name: "red copy.png",
    savedAt: Date.now(),
    sha: picture.sha,
    tags: [],
  });
  await library.items.delete({ ids: [picture.id] });
  const { purged } = await library.items.purge({ ids: [picture.id] });
  expectEq(purged, [picture.id], "the first picture's item emptied");
  const kept = await readFile(worker, phone, picture.sha);
  expectEq(kept.status, 200, "the picture the second item names");
  expectEq(
    Buffer.compare(await bytesOf(kept), Buffer.from(picture.source.bytes)),
    0,
    "the kept picture's bytes",
  );
  const secondRead = await library.items.read({ id: second.id });
  expectEq(secondRead.fields.kind, "image", "the second item");
};

export const fileItems: Scenario = {
  description:
    "a PDF, a webm, a zip and a PNG uploaded by their sha land as items of their kind; a file declared past the cap is refused before its bytes; the PDF is served with no sandbox, the recording by its ranges and the archive under a sandbox; a deleted item keeps its file and restores whole; a picture two items name stays when one is emptied from Deleted",
  name: "file-items",
  timeoutMs: WORKER_SCENARIO_TIMEOUT_MS,
  async run(ctx) {
    const worker = await ctx.cloudWorker();
    await signUp(worker.origin);
    const cookie = await signInPhone(worker.origin);
    const phone = asPhone(cookie);
    const { library } = v1Client(worker, phone);

    ctx.log("a PDF, a recording, an archive and a picture land as items of their kind");
    const saved = await saveAll(worker, phone, library);

    ctx.log("a file declared past the cap is refused on its length");
    expectEq(await declaredPastTheCap(worker, cookie), 413, "the oversized upload");

    ctx.log("the PDF unsandboxed, a recording's range, and the archive under a sandbox");
    await expectServed(worker, phone, saved);

    const pdf = saved.get("Lecture notes.pdf");
    const picture = saved.get("red.png");
    expect(pdf !== undefined && picture !== undefined, "the PDF and the picture were saved");
    await expectDeleteAndRestore(ctx, worker, phone, library, pdf);
    await expectSharedFileKept(ctx, worker, phone, library, picture);
  },
};
