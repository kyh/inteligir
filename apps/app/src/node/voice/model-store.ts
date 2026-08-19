// The model cache on disk: where a model lives, whether it is there, how it
// gets there, and how it goes away.
//
// A DOWNLOAD LANDS ATOMICALLY OR NOT AT ALL. Bytes stream to `<id>/download`
// and are renamed to `<id>/model.bin` only after the size and the digest both
// match the catalog's pin, so an interrupted fetch, a truncated response and a
// substituted file all leave the cache in the state it started in — which
// matters more than usual here, because the file is mmapped by a native
// runtime that will not check it for us.
//
// CANCELLATION IS THE SAME PATH AS FAILURE. `remove` aborts an in-flight
// download; the abort surfaces as a rejected stream, the partial file is
// unlinked, and the caller sees `no-model` either way. There is no separate
// "cancelled" state, because from the outside a stopped download and a failed
// one leave exactly the same disk.

import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, rename, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import { errnoCode } from "../errno";
import type { VoiceModelSpec } from "./model-catalog";

/** Named `model.bin` rather than after the id: the directory already carries
 *  the id, and a second copy of it is a second thing to keep in step. */
const MODEL_FILE_NAME = "model.bin";
const DOWNLOAD_FILE_NAME = "download";

export function modelDirFor(modelDir: string, spec: VoiceModelSpec): string {
  return join(modelDir, spec.id);
}

export function modelFilePath(modelDir: string, spec: VoiceModelSpec): string {
  return join(modelDirFor(modelDir, spec), MODEL_FILE_NAME);
}

/**
 * Is the model installed? The SIZE is checked as well as the presence, because
 * a file left behind by a crash between rename and fsync would otherwise be
 * reported as ready and then fail inside the native loader with a message
 * about tensors.
 */
export async function isModelInstalled(modelDir: string, spec: VoiceModelSpec): Promise<boolean> {
  try {
    const info = await stat(modelFilePath(modelDir, spec));
    return info.isFile() && info.size === spec.sizeBytes;
  } catch (error) {
    if (errnoCode(error) === "ENOENT") {
      return false;
    }
    throw error;
  }
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
  const directory = modelDirFor(modelDir, spec);
  const partialPath = join(directory, DOWNLOAD_FILE_NAME);
  await mkdir(directory, { recursive: true });

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
  try {
    await pipeline(measured(), createWriteStream(partialPath), { signal });
  } catch (error) {
    await rm(partialPath, { force: true });
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

  if (received !== spec.sizeBytes) {
    await rm(partialPath, { force: true });
    throw new ModelDownloadError(
      `${spec.id} arrived as ${received} bytes, not the ${spec.sizeBytes} this build expects.`,
    );
  }
  const actual = digest.digest("hex");
  if (actual !== spec.sha256) {
    await rm(partialPath, { force: true });
    throw new ModelDownloadError(
      `${spec.id} does not match its pinned checksum, so it was discarded.`,
    );
  }
  await rename(partialPath, join(directory, MODEL_FILE_NAME));
}

/** Delete the whole model directory — the file and any partial beside it. */
export async function removeModel(modelDir: string, spec: VoiceModelSpec): Promise<void> {
  await rm(modelDirFor(modelDir, spec), { recursive: true, force: true });
}
