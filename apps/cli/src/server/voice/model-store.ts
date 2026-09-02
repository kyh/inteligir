// extraction is pure js (unbzip2-stream + tar): node has no bzip2 and windows' bundled tar.exe
// cannot do -j, and an npx install cannot depend on a system tar. cancellation is the failure
// path: an aborted download leaves the same disk a failed one does.

import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, rename, rm, stat } from "node:fs/promises";
import { basename, join } from "node:path";
import { pipeline } from "node:stream/promises";
import { x as extractTar } from "tar";
import unbzip2 from "unbzip2-stream";
import { errnoCode } from "../errno";
import type { VoiceModelSpec } from "./model-catalog";
import type { VoiceModelFiles } from "./worker-protocol";

const STAGING_SUFFIX = ".partial";
const ARCHIVE_FILE_NAME = "download.tar.bz2";

export function modelDirFor(modelDir: string, spec: VoiceModelSpec): string {
  return join(modelDir, spec.id);
}

export function resolveModelFiles(modelDir: string, spec: VoiceModelSpec): VoiceModelFiles {
  const dir = modelDirFor(modelDir, spec);
  return {
    encoder: join(dir, spec.files.encoder),
    decoder: join(dir, spec.files.decoder),
    joiner: join(dir, spec.files.joiner),
    tokens: join(dir, spec.files.tokens),
  };
}

function requiredFileNames(spec: VoiceModelSpec): string[] {
  return [spec.files.encoder, spec.files.decoder, spec.files.joiner, spec.files.tokens];
}

// every file, non-empty: a crash mid-extract would otherwise read as installed and fail inside
// the native loader.
export async function isModelInstalled(modelDir: string, spec: VoiceModelSpec): Promise<boolean> {
  const dir = modelDirFor(modelDir, spec);
  for (const name of requiredFileNames(spec)) {
    try {
      const info = await stat(join(dir, name));
      if (!info.isFile() || info.size === 0) {
        return false;
      }
    } catch (error) {
      if (errnoCode(error) === "ENOENT") {
        return false;
      }
      throw error;
    }
  }
  return true;
}

export interface DownloadModelArgs {
  modelDir: string;
  spec: VoiceModelSpec;
  signal: AbortSignal;
  onProgress: (receivedBytes: number) => void;
  fetchImpl?: typeof fetch;
}

export class ModelDownloadError extends Error {}

export async function downloadModel(args: DownloadModelArgs): Promise<void> {
  const { modelDir, spec, signal, onProgress } = args;
  const fetchImpl = args.fetchImpl ?? fetch;
  const finalDir = modelDirFor(modelDir, spec);
  const stagingDir = `${finalDir}${STAGING_SUFFIX}`;
  const archivePath = join(stagingDir, ARCHIVE_FILE_NAME);

  // a previous attempt's staging is not a valid model.
  await rm(stagingDir, { recursive: true, force: true });
  await mkdir(stagingDir, { recursive: true });

  try {
    let response: Response;
    try {
      response = await fetchImpl(spec.url, { signal });
    } catch (error) {
      throw new ModelDownloadError(
        `Could not reach ${new URL(spec.url).host}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    if (!response.ok || response.body === null) {
      throw new ModelDownloadError(`${spec.url} answered ${response.status}.`);
    }

    const digest = createHash("sha256");
    let received = 0;
    const body = response.body;
    async function* measured(): AsyncGenerator<Uint8Array> {
      for await (const chunk of body) {
        received += chunk.byteLength;
        // mid-stream: a body with no content-length would fill the disk before the total was checked.
        if (received > spec.sizeBytes) {
          throw new ModelDownloadError(
            `${spec.id} is larger than the ${spec.sizeBytes} bytes this build expects.`,
          );
        }
        digest.update(chunk);
        onProgress(received);
        yield chunk;
      }
    }
    await pipeline(measured(), createWriteStream(archivePath), { signal });

    if (received !== spec.sizeBytes) {
      throw new ModelDownloadError(
        `${spec.id} arrived as ${received} bytes, not the ${spec.sizeBytes} this build expects.`,
      );
    }
    if (digest.digest("hex") !== spec.sha256) {
      throw new ModelDownloadError(
        `${spec.id} does not match its pinned checksum, so it was discarded.`,
      );
    }

    const required = new Set(requiredFileNames(spec));
    await extractArchive(archivePath, stagingDir, required);
    for (const name of required) {
      const info = await stat(join(stagingDir, name)).catch(() => null);
      if (info === null || !info.isFile() || info.size === 0) {
        throw new ModelDownloadError(`${spec.id} archive did not contain ${name}.`);
      }
    }
    await rm(archivePath, { force: true });

    // one rename, so a reader never sees a half-populated dir.
    await rm(finalDir, { recursive: true, force: true });
    await rename(stagingDir, finalDir);
  } catch (error) {
    await rm(stagingDir, { recursive: true, force: true });
    if (error instanceof ModelDownloadError) {
      throw error;
    }
    if (signal.aborted) {
      throw new ModelDownloadError("The download was stopped.");
    }
    throw new ModelDownloadError(
      `The download failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

// the filter matches on basename, which holds whether or not tar has stripped the leading
// component when it runs; it also drops the release's test_wavs/.
function extractArchive(
  archivePath: string,
  outDir: string,
  required: ReadonlySet<string>,
): Promise<void> {
  return pipeline(
    createReadStream(archivePath),
    unbzip2(),
    extractTar({ cwd: outDir, strip: 1, filter: (path) => required.has(basename(path)) }),
  );
}

export async function removeModel(modelDir: string, spec: VoiceModelSpec): Promise<void> {
  const finalDir = modelDirFor(modelDir, spec);
  await rm(finalDir, { recursive: true, force: true });
  await rm(`${finalDir}${STAGING_SUFFIX}`, { recursive: true, force: true });
}
