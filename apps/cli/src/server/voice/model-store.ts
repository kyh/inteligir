// extraction is pure js (unbzip2-stream + tar): node has no bzip2 and windows' bundled tar.exe
// cannot do -j, and an npx install cannot depend on a system tar. cancellation is the failure
// path: an aborted download leaves the same disk a failed one does.

import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, mkdtemp, readdir, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { x as extractTar } from "tar";
import unbzip2 from "unbzip2-stream";
import { z } from "zod";
import { errnoCode } from "../errno";
import { messageOf } from "../error-message";
import type { VoiceModelSpec } from "./model-catalog";
import type { VoiceModelFiles } from "./worker-protocol";

// each attempt stages in its own dir under this prefix: the model dir is per machine, so two
// instances can install at once, and a staging dir they shared is one either could clear under
// the other.
const STAGING_SUFFIX = ".partial";
const ARCHIVE_FILE_NAME = "download.tar.bz2";
// a staging dir's mtime does not move while the archive inside it grows, so the age that marks
// one abandoned must outlast any real download.
const ABANDONED_STAGING_MS = 24 * 60 * 60_000;

export const modelDirFor = (modelDir: string, spec: VoiceModelSpec): string =>
  path.join(modelDir, spec.id);

export const resolveModelFiles = (modelDir: string, spec: VoiceModelSpec): VoiceModelFiles => {
  const dir = modelDirFor(modelDir, spec);
  return {
    decoder: path.join(dir, spec.files.decoder),
    encoder: path.join(dir, spec.files.encoder),
    joiner: path.join(dir, spec.files.joiner),
    tokens: path.join(dir, spec.files.tokens),
  };
};

const requiredFileNames = (spec: VoiceModelSpec): string[] => [
  spec.files.encoder,
  spec.files.decoder,
  spec.files.joiner,
  spec.files.tokens,
];

// every file, non-empty: a crash mid-extract would otherwise read as installed and fail inside
// the native loader.
export const isModelInstalled = async (
  modelDir: string,
  spec: VoiceModelSpec,
): Promise<boolean> => {
  const dir = modelDirFor(modelDir, spec);
  for (const name of requiredFileNames(spec)) {
    try {
      const info = await stat(path.join(dir, name));
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
};

export interface DownloadModelArgs {
  modelDir: string;
  spec: VoiceModelSpec;
  signal: AbortSignal;
  onProgress: (receivedBytes: number) => void;
  fetchImpl?: typeof fetch;
}

export class ModelDownloadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ModelDownloadError";
  }
}

// the filter matches on basename, which holds whether or not tar has stripped the leading
// component when it runs; it also drops the release's test_wavs/.
const extractArchive = async (
  archivePath: string,
  outDir: string,
  required: ReadonlySet<string>,
): Promise<void> => {
  await pipeline(
    createReadStream(archivePath),
    unbzip2(),
    extractTar({
      cwd: outDir,
      filter: (entryPath) => required.has(path.basename(entryPath)),
      strip: 1,
      // a recoverable warning (an absolute or `..` path, an entry it could not write) refuses the
      // archive rather than skipping a file.
      strict: true,
    }),
  );
};

// node types the fetch body's chunks loosely; the stream is the boundary.
const bodyChunkSchema = z.instanceof(Uint8Array);

// every staging dir of this model's attempts, or with `modifiedBefore` only those last touched
// before it: an attempt still running in another instance is younger.
const removeStagingDirs = async (
  modelDir: string,
  spec: VoiceModelSpec,
  modifiedBefore?: number,
): Promise<void> => {
  let entries: string[];
  try {
    entries = await readdir(modelDir);
  } catch (error) {
    if (errnoCode(error) === "ENOENT") {
      return;
    }
    throw error;
  }
  const staging = `${spec.id}${STAGING_SUFFIX}`;
  for (const entry of entries) {
    if (!entry.startsWith(staging)) {
      continue;
    }
    const entryPath = path.join(modelDir, entry);
    if (modifiedBefore !== undefined) {
      const info = await stat(entryPath).catch(() => null);
      if (info === null || info.mtimeMs >= modifiedBefore) {
        continue;
      }
    }
    await rm(entryPath, { force: true, recursive: true });
  }
};

export const downloadModel = async (args: DownloadModelArgs): Promise<void> => {
  const { modelDir, spec, signal, onProgress } = args;
  const fetchImpl = args.fetchImpl ?? fetch;
  const finalDir = modelDirFor(modelDir, spec);
  await mkdir(modelDir, { recursive: true });
  // a process killed mid-download never reaches its own cleanup, and each leaves ~100MB behind.
  await removeStagingDirs(modelDir, spec, Date.now() - ABANDONED_STAGING_MS);
  const stagingDir = await mkdtemp(`${finalDir}${STAGING_SUFFIX}-`);
  const archivePath = path.join(stagingDir, ARCHIVE_FILE_NAME);

  try {
    let response: Response;
    try {
      response = await fetchImpl(spec.url, { signal });
    } catch (error) {
      throw new ModelDownloadError(
        `Could not reach ${new URL(spec.url).host}: ${messageOf(error)}`,
      );
    }
    if (!response.ok || response.body === null) {
      throw new ModelDownloadError(`${spec.url} answered ${response.status}.`);
    }

    const digest = createHash("sha256");
    let received = 0;
    const { body } = response;
    const measured = async function* measured(): AsyncGenerator<Uint8Array> {
      for await (const raw of body) {
        const chunk = bodyChunkSchema.parse(raw);
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
    };
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
      const info = await stat(path.join(stagingDir, name)).catch(() => null);
      if (info === null || !info.isFile() || info.size === 0) {
        throw new ModelDownloadError(`${spec.id} archive did not contain ${name}.`);
      }
    }
    await rm(archivePath, { force: true });

    // one rename, so a reader never sees a half-populated dir.
    await rm(finalDir, { force: true, recursive: true });
    try {
      await rename(stagingDir, finalDir);
    } catch (error) {
      // another install landed between the rm and the rename; its bytes passed the same pin.
      if (!(await isModelInstalled(modelDir, spec))) {
        throw error;
      }
      await rm(stagingDir, { force: true, recursive: true });
    }
  } catch (error) {
    await rm(stagingDir, { force: true, recursive: true });
    if (error instanceof ModelDownloadError) {
      throw error;
    }
    if (signal.aborted) {
      throw new ModelDownloadError("The download was stopped.");
    }
    throw new ModelDownloadError(`The download failed: ${messageOf(error)}`);
  }
};

export const removeModel = async (modelDir: string, spec: VoiceModelSpec): Promise<void> => {
  await rm(modelDirFor(modelDir, spec), { force: true, recursive: true });
  await removeStagingDirs(modelDir, spec);
};
