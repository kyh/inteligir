// ---------------------------------------------------------------------------
// Parakeet model downloader — fetches + extracts the streaming Parakeet
// model used by sherpa-onnx. Emits progress callbacks. Idempotent: skips
// if the model is already installed. Concurrent calls share one download.
// ---------------------------------------------------------------------------

import { createHash } from "node:crypto";
import { createReadStream, createWriteStream, existsSync, mkdirSync, statSync } from "node:fs";
import { rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { pipeline as pipelineCb } from "node:stream";
import { promisify } from "node:util";

import { x as tarExtract } from "tar";
import unbzip2 from "unbzip2-stream";

import { toErrorMessage } from "@repo/bridge/wire-helpers";
import type { VoiceModelStateEvent } from "@repo/bridge/ipc-registry";

const streamPipeline = promisify(pipelineCb);

const MODEL_NAME = "sherpa-onnx-nemo-streaming-fast-conformer-transducer-en-480ms";
const MODEL_URL = `https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/${MODEL_NAME}.tar.bz2`;
// SHA-256 of the upstream archive at the URL above. Pinned to fail closed if
// the release is tampered with or silently re-uploaded. Recompute via
// `curl -L <url> | shasum -a 256` when bumping MODEL_NAME / MODEL_URL.
const MODEL_SHA256 = "e9995c0c2a80fd52cb13e4d03950cd69d256471a0f5993272753e8a6d4fc75b1";
// All four files must be present before the recognizer can initialize.
// Checking only tokens.txt would treat an interrupted install as already-done.
const REQUIRED_MODEL_FILES = ["encoder.onnx", "decoder.onnx", "joiner.onnx", "tokens.txt"];

export type ModelDownloadResult = { ok: true } | { ok: false; error: string };

let downloadInflight: Promise<ModelDownloadResult> | null = null;

/** What the model machinery needs from the composing host (voice/ never
 * imports the platform seam or the event bus). Installed once at handler
 * registration (registerVoiceHandlers), before any voice call can land. */
export type VoiceModelHost = {
  /** Per-user data dir that survives logout (HostPlatform.userDataDir). */
  userDataDir: () => string;
  /** Forward one onVoiceModelState progress event to the host event bus. */
  emitState: (event: VoiceModelStateEvent) => void;
};

let modelHost: VoiceModelHost | null = null;

/** Install the host seam once at composition time. */
export function configureVoiceModelHost(host: VoiceModelHost): void {
  modelHost = host;
}

function requireModelHost(): VoiceModelHost {
  if (!modelHost) throw new Error("Voice model host not configured — createHost() has not run");
  return modelHost;
}

// Progress events are fire-and-forget: before the host seam is installed they
// are dropped, exactly like an event-bus emission with no transport subscribed.
function emitProgress(event: VoiceModelStateEvent): void {
  modelHost?.emitState(event);
}

/**
 * Resolve the model's on-disk location. Uses the host's per-user data
 * dir (NOT ~/.inteligir, which logout wipes) so the bundle stays writable,
 * survives app updates, and never re-downloads across a logout.
 */
export function getModelDir(): string {
  return join(requireModelHost().userDataDir(), "stt", MODEL_NAME);
}

export function isModelInstalled(): boolean {
  const dir = getModelDir();
  return REQUIRED_MODEL_FILES.every((f) => existsSync(join(dir, f)));
}

export function downloadModel(): Promise<ModelDownloadResult> {
  if (downloadInflight) return downloadInflight;
  downloadInflight = doDownload().finally(() => {
    downloadInflight = null;
  });
  return downloadInflight;
}

async function doDownload(): Promise<ModelDownloadResult> {
  if (isModelInstalled()) {
    emitProgress({ status: "ready" });
    return { ok: true };
  }

  const dir = getModelDir();
  const outRoot = dirname(dir);
  const archive = join(outRoot, `${MODEL_NAME}.tar.bz2`);

  try {
    mkdirSync(outRoot, { recursive: true });

    let lastPercent = -1;
    await fetchToFile(MODEL_URL, archive, MODEL_SHA256, (received, total) => {
      const percent = total > 0 ? Math.floor((received / total) * 100) : 0;
      // Skip duplicate-percent broadcasts: each event crosses IPC + triggers
      // a renderer setState, and fetch fires onProgress per chunk read.
      if (percent === lastPercent) return;
      lastPercent = percent;
      emitProgress({
        status: "downloading",
        percent,
        receivedBytes: received,
        totalBytes: total,
      });
    });

    emitProgress({ status: "extracting" });
    await extract(archive, outRoot);
    await rm(archive).catch(() => {});

    if (!isModelInstalled()) {
      throw new Error(`Extraction completed but expected files missing in ${dir}`);
    }
    emitProgress({ status: "ready" });
    return { ok: true };
  } catch (err) {
    const message = toErrorMessage(err);
    await rm(archive).catch(() => {});
    emitProgress({ status: "error", message });
    return { ok: false, error: message };
  }
}

async function fetchToFile(
  url: string,
  dest: string,
  expectedSha256: string,
  onProgress: (received: number, total: number) => void,
): Promise<void> {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok || !res.body) {
    throw new Error(`HTTP ${String(res.status)} ${res.statusText}`);
  }
  const total = Number(res.headers.get("content-length") ?? 0);

  let received = 0;
  const sink = createWriteStream(dest);
  const reader = res.body.getReader();
  const hash = createHash("sha256");
  // Top-level error capture: a sink error during a write that didn't trigger
  // backpressure (i.e. write() returned true) would otherwise propagate to
  // the event loop and crash the main process.
  let sinkError: Error | null = null;
  const onSinkError = (err: Error) => {
    sinkError = err;
  };
  sink.on("error", onSinkError);
  try {
    while (true) {
      if (sinkError) throw sinkError;
      const { done, value } = await reader.read();
      if (done) break;
      hash.update(value);
      received += value.byteLength;
      onProgress(received, total);
      if (!sink.write(value)) {
        await new Promise<void>((resolve, reject) => {
          const onDrain = () => {
            sink.off("error", onError);
            resolve();
          };
          const onError = (err: Error) => {
            sink.off("drain", onDrain);
            reject(err);
          };
          sink.once("drain", onDrain);
          sink.once("error", onError);
        });
      }
    }
    if (sinkError) throw sinkError;
    const endError = await new Promise<Error | null>((resolve) => {
      sink.end((err?: Error | null) => resolve(err ?? null));
    });
    if (endError) throw endError;
  } catch (err) {
    sink.destroy();
    await reader.cancel().catch(() => {});
    throw err;
  } finally {
    sink.off("error", onSinkError);
  }

  // Sanity-check size — content-length may be 0 on some CDNs, in which case
  // skip; otherwise an interrupted download should be rejected.
  if (total > 0) {
    const actual = statSync(dest).size;
    if (actual !== total) {
      throw new Error(`Download size mismatch: expected ${total}, got ${actual}`);
    }
  }

  // Integrity check: bytes match the pinned hash. A drift here means the
  // upstream release was re-uploaded (intentionally or otherwise) and the
  // user shouldn't run it until the maintainer audits + repins.
  const actualSha = hash.digest("hex");
  if (actualSha !== expectedSha256) {
    throw new Error(`SHA-256 mismatch for ${url}: expected ${expectedSha256}, got ${actualSha}`);
  }
}

/**
 * Pure-Node tar.bz2 extraction. Avoids shelling out to the system tar — the
 * `-j` bzip2 flag isn't supported by Windows' built-in tar.exe.
 */
function extract(archive: string, outDir: string): Promise<void> {
  return streamPipeline(createReadStream(archive), unbzip2(), tarExtract({ cwd: outDir }));
}
