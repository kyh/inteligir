import { createHash, randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, truncate, writeFile } from "node:fs/promises";
import path from "node:path";
import { isDefinedError, safe } from "@orpc/client";
import { fileTooLargeMessage } from "@repo/contract/local/items/items-schema";
import { VAULT_ASSET_PATH, VAULT_THUMB_PATH } from "@repo/contract/local/routes";
import { vaultDeletedResponseSchema } from "@repo/contract/local/vault/vault-schema";
import { authorizationHeader, readServerFile } from "inteligir/server/server-file";
import { z } from "zod";
import { agentShellCli } from "../harness/agent-shell-cli";
import type { AgentShellCli } from "../harness/agent-shell-cli";
import { expect, expectEq } from "../harness/assert";
import { describeExecError, gitIn } from "../harness/exec";
import type { AppInstance } from "../harness/instance";
import { pollUntil } from "../harness/poll";
import { readPngPixels, solidPng } from "../harness/png-pixels";
import type { Scenario, ScenarioContext } from "../harness/scenario";

const MiB = 1024 * 1024;

// the auto-commit's quiet window is 15 s and its longest wait 60 s
const COMMIT_DEADLINE_MS = 75_000;

const RED = [220, 20, 30, 255] as const;

const PDF = "Lecture notes.pdf";
const WEBM = "clip.webm";
const ZIP = "archive.zip";
const PNG = "red.png";

const sha256 = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");

const savedSchema = z.object({ outcome: z.literal("created"), path: z.string() });

// the embed a file item's wrapper holds: `![](assets/x.pdf)` or `![](<assets/a b.pdf>)`
const EMBED = /!\[\]\((?<target><[^>]+>|[^)\s]+)\)/u;

// one saved file: its bytes, its wrapper and its original
interface SavedFile {
  bytes: Uint8Array;
  wrapper: string;
  original: string;
}

const sourceFiles = (): Map<string, Uint8Array> =>
  new Map([
    [PDF, new Uint8Array(Buffer.concat([Buffer.from("%PDF-1.4\n"), randomBytes(4096)]))],
    [ZIP, new Uint8Array(Buffer.concat([Buffer.from("PK\u0003\u0004"), randomBytes(2048)]))],
    [
      WEBM,
      new Uint8Array(Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), randomBytes(65_536)])),
    ],
    [PNG, solidPng(48, 32, RED)],
  ]);

const originalOf = async (app: AppInstance, wrapper: string): Promise<string> => {
  const { content } = await app.api.vault.read({ path: wrapper });
  const target = EMBED.exec(content)?.groups?.target ?? "";
  expect(target !== "", `${wrapper} embeds its original`);
  return target.startsWith("<") ? target.slice(1, -1) : target;
};

const bytesOnDisk = async (app: AppInstance, vaultPath: string): Promise<Uint8Array | null> => {
  const absolute = path.join(app.vaultDir, vaultPath);
  return existsSync(absolute) ? new Uint8Array(await readFile(absolute)) : null;
};

const hashOnDisk = async (app: AppInstance, vaultPath: string): Promise<string | null> => {
  const bytes = await bytesOnDisk(app, vaultPath);
  return bytes === null ? null : sha256(bytes);
};

const lastCommitTouching = async (app: AppInstance, vaultPath: string): Promise<string> =>
  await gitIn(app.vaultDir, ["log", "-1", "--format=%H", "--", vaultPath]);

// a byte route, with the bearer the CLI reads
const byteRoute = async (
  app: AppInstance,
  route: string,
  vaultPath: string,
  init: { headers?: Record<string, string>; query?: string } = {},
): Promise<Response> => {
  const server = readServerFile(app.dataDir);
  expect(server !== null, "the instance published its server.json");
  return await fetch(
    `${app.baseUrl}${route}?path=${encodeURIComponent(vaultPath)}${init.query ?? ""}`,
    { headers: { ...init.headers, authorization: authorizationHeader(server.token) } },
  );
};

const saveAll = async (
  ctx: ScenarioContext,
  app: AppInstance,
  cli: AgentShellCli,
): Promise<Map<string, SavedFile>> => {
  const sources = path.join(ctx.scratchDir, "files");
  await mkdir(sources, { recursive: true });
  const saved = new Map<string, SavedFile>();
  for (const [name, bytes] of sourceFiles()) {
    await writeFile(path.join(sources, name), bytes);
    const { stdout } = await cli("save", path.join(sources, name), "--json");
    const wrapper = savedSchema.parse(JSON.parse(stdout)).path;
    const original = await originalOf(app, wrapper);
    expectEq(await hashOnDisk(app, original), sha256(bytes), `${original}'s bytes`);
    saved.set(name, { bytes, original, wrapper });
  }
  expectEq(saved.get(PDF)?.wrapper, "Unsorted/Lecture notes.md", "the PDF's wrapper");
  expectEq(saved.get(ZIP)?.wrapper, "Unsorted/archive.md", "the zip's wrapper");
  return saved;
};

const expectOneCommitEach = async (
  app: AppInstance,
  saved: ReadonlyMap<string, SavedFile>,
): Promise<void> => {
  for (const { original, wrapper } of saved.values()) {
    const commit = await pollUntil(
      async () => await lastCommitTouching(app, wrapper),
      (sha) => sha !== "",
      { deadlineMs: COMMIT_DEADLINE_MS, describe: () => `${wrapper} was never committed` },
    );
    expectEq(
      await lastCommitTouching(app, original),
      commit,
      `${original} shares ${wrapper}'s commit`,
    );
  }
};

const expectOverCapRefused = async (
  ctx: ScenarioContext,
  app: AppInstance,
  cli: AgentShellCli,
): Promise<void> => {
  const big = path.join(ctx.scratchDir, "film.mp4");
  await writeFile(big, "");
  await truncate(big, 11 * MiB);
  let refusal = "";
  try {
    await cli("save", big, "--json");
  } catch (error) {
    refusal = describeExecError(error);
  }
  expect(
    refusal.includes(fileTooLargeMessage("film.mp4", 11 * MiB)),
    `the CLI refused it: ${refusal}`,
  );
  const [served] = await safe(
    app.api.items.saveFile({ file: new Blob([new Uint8Array(11 * MiB)]), name: "film.mp4" }),
  );
  expect(isDefinedError(served) && served.code === "PAYLOAD_TOO_LARGE", "the server refused it");
};

const expectServed = async (app: AppInstance, saved: ReadonlyMap<string, SavedFile>) => {
  const pdf = await byteRoute(app, VAULT_ASSET_PATH, saved.get(PDF)?.original ?? "");
  expectEq(pdf.status, 200, "the PDF's status");
  expectEq(pdf.headers.get("content-type"), "application/pdf", "the PDF's type");
  const policy = pdf.headers.get("content-security-policy") ?? "sandbox";
  expect(!policy.includes("sandbox"), `a PDF has no sandbox: ${policy}`);

  const webm = saved.get(WEBM);
  const probe = await byteRoute(app, VAULT_ASSET_PATH, webm?.original ?? "", {
    headers: { range: "bytes=0-1" },
  });
  expectEq(probe.status, 206, "the webm's probe");
  expectEq(
    probe.headers.get("content-range"),
    `bytes 0-1/${String(webm?.bytes.length ?? 0)}`,
    "the probe's range",
  );

  const zip = await byteRoute(app, VAULT_ASSET_PATH, saved.get(ZIP)?.original ?? "");
  expectEq(zip.status, 400, "an archive is stored, never served");

  const thumb = await byteRoute(app, VAULT_THUMB_PATH, saved.get(PNG)?.original ?? "", {
    query: "&w=320",
  });
  expectEq(thumb.status, 200, "the thumbnail's status");
  const drawn = readPngPixels(new Uint8Array(await thumb.arrayBuffer()));
  expectEq(drawn.pixelAt(0, 0).join(","), RED.join(","), "the thumbnail's first pixel");
};

const linkerCount = async (app: AppInstance, vaultPath: string): Promise<number> => {
  const { backlinks } = await app.api.knowledge.backlinks({ path: vaultPath });
  return backlinks.length;
};

const expectSharedFileKept = async (
  app: AppInstance,
  cli: AgentShellCli,
  picture: SavedFile,
): Promise<void> => {
  await app.api.vault.write({
    content: `# Mood\n\n![](${picture.original})\n`,
    guard: { kind: "absent" },
    path: "Mood.md",
  });
  await pollUntil(
    async () => await linkerCount(app, picture.original),
    (count) => count >= 2,
    { deadlineMs: 30_000, describe: (count) => `${picture.original} has ${String(count)} linkers` },
  );
  await cli("vault", "delete", picture.wrapper);
  expect(
    (await bytesOnDisk(app, picture.original)) !== null,
    "the picture another note shows stays",
  );
};

const expectDeleteAndRestore = async (
  app: AppInstance,
  cli: AgentShellCli,
  pdf: SavedFile,
): Promise<void> => {
  await cli("vault", "delete", pdf.wrapper);
  expectEq(await bytesOnDisk(app, pdf.original), null, "the PDF's original left with it");
  const { stdout: listed } = await cli("vault", "deleted", "--json");
  const { entries } = vaultDeletedResponseSchema.parse(JSON.parse(listed));
  const held = entries.find((entry) => entry.path === pdf.original);
  expectEq(held?.heldBy ?? null, pdf.wrapper, "the original is held by its wrapper");
  expectEq(held?.kind ?? null, "file", "the original is listed as a file");
  const wrapperEntry = entries.find((entry) => entry.path === pdf.wrapper);
  expect(wrapperEntry !== undefined, "the wrapper is listed");

  const { stdout: restored } = await cli("vault", "restore", pdf.wrapper, wrapperEntry.sha);
  expect(restored.includes("with 1 file"), `the restore names the file: ${restored}`);
  expectEq(await hashOnDisk(app, pdf.original), sha256(pdf.bytes), "the restored PDF");
};

export const fileItems: Scenario = {
  description:
    "a PDF, a webm and a zip saved as items, each a wrapper and its original in one commit; a file over the cap refused; a delete takes the original and Deleted lists it held by its wrapper; a restore is byte-identical; a second note embedding it keeps it",
  name: "file-items",
  timeoutMs: 240_000,
  async run(ctx) {
    const app = await ctx.boot({ name: "files" });
    const cli = agentShellCli(ctx.repoRoot, app.dataDir);

    ctx.log("save a PDF, a zip, a webm and a picture as items from the command line");
    const saved = await saveAll(ctx, app, cli);

    ctx.log("each wrapper and its original land in one commit");
    await expectOneCommitEach(app, saved);

    ctx.log("a file over the cap is refused, before any request and by the server");
    await expectOverCapRefused(ctx, app, cli);

    ctx.log("the PDF unsandboxed, a webm range, no archive, and the picture's thumbnail");
    await expectServed(app, saved);

    const picture = saved.get(PNG);
    const pdf = saved.get(PDF);
    expect(picture !== undefined && pdf !== undefined, "the picture and the PDF were saved");

    ctx.log("a second note embeds the picture: deleting the picture's item keeps it");
    await expectSharedFileKept(app, cli, picture);

    ctx.log("deleting the PDF's item takes its original; restoring brings it back byte-identical");
    await expectDeleteAndRestore(app, cli, pdf);
  },
};
