// The model cache on disk: where a model lives, whether it is there, how it
// gets there, and how it goes away.
//
// A DOWNLOAD LANDS ATOMICALLY OR NOT AT ALL. The release archive streams into
// `<id>.partial/`, is verified against the catalog's size and digest, and is
// extracted there; only once all four model files are present does the staging
// directory get renamed onto `<id>/`. So an interrupted fetch, a truncated
// response, a substituted file and a half-written extract all leave the cache
// in the state it started in — which matters more than usual here, because the
// files are mmapped by a native runtime that will not check them for us.
//
// THE ARCHIVE IS `.tar.bz2`, so extraction is PURE-JS (`unbzip2-stream` + `tar`)
// rather than a shell-out: Node has no built-in bzip2, and Windows' bundled
// tar.exe cannot do `-j` — an npx install that ships cross-platform cannot
// depend on a system tar.
//
// CANCELLATION IS THE SAME PATH AS FAILURE. `remove` aborts an in-flight
// download; the abort surfaces as a rejected stream, the staging directory is
// unlinked, and the caller sees `no-model` either way. There is no separate
// "cancelled" state, because from the outside a stopped download and a failed
// one leave exactly the same disk.

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

/** Streamed here, verified, extracted beside, then renamed onto the model dir. */
const STAGING_SUFFIX = ".partial";
const ARCHIVE_FILE_NAME = "download.tar.bz2";

export function modelDirFor(modelDir: string, spec: VoiceModelSpec): string {
  return join(modelDir, spec.id);
}

/** The four files the recognizer loads, as absolute paths under the model dir. */
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

/**
 * Is the model installed? EVERY file must be present and non-empty — checking
 * one would treat a crash mid-extract as done, and the recognizer would then
 * fail inside the native loader with a message about a missing tensor file.
 */
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
  /** Called as bytes land, so a surface can show progress against
   *  `spec.sizeBytes` without a second source of truth for the total. */
  onProgress: (receivedBytes: number) => void;
  /** Tests inject a transport; the shipping boot uses global fetch. */
  fetchImpl?: typeof fetch;
}

/** A refusal a person can act on: the sentence `no-model.lastError` carries. */
export class ModelDownloadError extends Error {}

export async function downloadModel(args: DownloadModelArgs): Promise<void> {
  const { modelDir, spec, signal, onProgress } = args;
  const fetchImpl = args.fetchImpl ?? fetch;
  const finalDir = modelDirFor(modelDir, spec);
  const stagingDir = `${finalDir}${STAGING_SUFFIX}`;
  const archivePath = join(stagingDir, ARCHIVE_FILE_NAME);

  // A previous attempt's staging (a crash between extract and rename) is not a
  // valid model — start from a clean directory every time.
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
        // Refused MID-STREAM rather than after: a body with no content-length,
        // or one that lies about it, would otherwise fill the disk before
        // anything checked the total.
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

    // Atomic swap: the staged tree becomes the model dir in one rename, so a
    // reader never sees a half-populated `<id>/`.
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

/**
 * Extract only the four model files, dropping the archive's top-level folder
 * (`strip: 1`) so they land directly in the model dir. The filter matches on
 * BASENAME, which is stable whether or not tar has stripped the leading
 * component by the time it runs — and it skips the `test_wavs/` the release
 * carries, which the recognizer never reads.
 */
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

/** Delete the whole model directory and any staging beside it. */
export async function removeModel(modelDir: string, spec: VoiceModelSpec): Promise<void> {
  const finalDir = modelDirFor(modelDir, spec);
  await rm(finalDir, { recursive: true, force: true });
  await rm(`${finalDir}${STAGING_SUFFIX}`, { recursive: true, force: true });
}
