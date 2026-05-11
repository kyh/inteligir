// ---------------------------------------------------------------------------
// Parakeet model downloader — fetches + extracts the streaming Parakeet
// model used by sherpa-onnx. Emits progress callbacks. Idempotent: skips
// if the model is already installed. Concurrent calls share one download.
// ---------------------------------------------------------------------------

import { createWriteStream, existsSync, mkdirSync, statSync } from "node:fs";
import { rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { spawn } from "node:child_process";

import type { VoiceModelStateEvent } from "@/shared/ipc";

export const MODEL_NAME = "sherpa-onnx-nemo-streaming-fast-conformer-transducer-en-24500";
const MODEL_URL = `https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/${MODEL_NAME}.tar.bz2`;

export type ModelDownloadResult = { ok: true } | { ok: false; error: string };

export type ProgressCallback = (event: VoiceModelStateEvent) => void;

let downloadInflight: Promise<ModelDownloadResult> | null = null;

function modelDir(projectRoot: string): string {
  return join(projectRoot, "resources", "stt", MODEL_NAME);
}

/** Absolute path to the unpacked model directory. Exported for reuse. */
export function getModelDir(projectRoot: string): string {
  return modelDir(projectRoot);
}

export function isModelInstalled(projectRoot: string): boolean {
  return existsSync(join(modelDir(projectRoot), "tokens.txt"));
}

export function getModelStatus(projectRoot: string): "ready" | "missing" {
  return isModelInstalled(projectRoot) ? "ready" : "missing";
}

export function downloadModel(
  projectRoot: string,
  onProgress: ProgressCallback,
): Promise<ModelDownloadResult> {
  if (downloadInflight) return downloadInflight;
  downloadInflight = doDownload(projectRoot, onProgress).finally(() => {
    downloadInflight = null;
  });
  return downloadInflight;
}

async function doDownload(
  projectRoot: string,
  onProgress: ProgressCallback,
): Promise<ModelDownloadResult> {
  if (isModelInstalled(projectRoot)) {
    onProgress({ status: "ready" });
    return { ok: true };
  }

  const dir = modelDir(projectRoot);
  const outRoot = dirname(dir);
  const archive = join(outRoot, `${MODEL_NAME}.tar.bz2`);

  try {
    mkdirSync(outRoot, { recursive: true });

    await fetchToFile(MODEL_URL, archive, (received, total) => {
      const percent = total > 0 ? Math.floor((received / total) * 100) : 0;
      onProgress({
        status: "downloading",
        percent,
        receivedBytes: received,
        totalBytes: total,
      });
    });

    onProgress({ status: "extracting" });
    await extract(archive, outRoot);
    await rm(archive).catch(() => {});

    if (!isModelInstalled(projectRoot)) {
      throw new Error(`Extraction completed but expected files missing in ${dir}`);
    }
    onProgress({ status: "ready" });
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await rm(archive).catch(() => {});
    onProgress({ status: "error", message });
    return { ok: false, error: message };
  }
}

async function fetchToFile(
  url: string,
  dest: string,
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
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      onProgress(received, total);
      if (!sink.write(value)) {
        await new Promise<void>((resolve) => sink.once("drain", () => resolve()));
      }
    }
    await new Promise<void>((resolve, reject) => {
      sink.end((err?: Error | null) => (err ? reject(err) : resolve()));
    });
  } catch (err) {
    sink.destroy();
    throw err;
  }

  // Sanity-check size — content-length may be 0 on some CDNs, in which case
  // skip; otherwise an interrupted download should be rejected.
  if (total > 0) {
    const actual = statSync(dest).size;
    if (actual !== total) {
      throw new Error(`Download size mismatch: expected ${total}, got ${actual}`);
    }
  }
}

function extract(archive: string, outDir: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn("tar", ["-xjf", archive, "-C", outDir], { stdio: "inherit" });
    proc.on("error", reject);
    proc.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`tar exited with code ${String(code)}`));
    });
  });
}
