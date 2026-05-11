#!/usr/bin/env node
// Downloads the streaming Parakeet (NeMo FastConformer Transducer, English)
// model used by sherpa-onnx for local on-device STT.
//
// Run: pnpm download-stt-model
// Output: apps/desktop/resources/stt/<model-name>/

import { createWriteStream, existsSync, mkdirSync, statSync } from "node:fs";
import { rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { pipeline } from "node:stream/promises";
import { spawn } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, "..");
const MODEL_NAME = "sherpa-onnx-nemo-streaming-fast-conformer-transducer-en-24500";
const MODEL_URL = `https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/${MODEL_NAME}.tar.bz2`;
const OUT_DIR = join(PROJECT_ROOT, "resources", "stt");
const MODEL_DIR = join(OUT_DIR, MODEL_NAME);
const ARCHIVE_PATH = join(OUT_DIR, `${MODEL_NAME}.tar.bz2`);

function log(msg) {
  process.stdout.write(`[download-stt-model] ${msg}\n`);
}

async function download(url, dest) {
  log(`Fetching ${url}`);
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok || !res.body) {
    throw new Error(`HTTP ${res.status} ${res.statusText}`);
  }
  await pipeline(res.body, createWriteStream(dest));
  const size = statSync(dest).size;
  log(`Downloaded ${(size / 1024 / 1024).toFixed(1)} MB → ${dest}`);
}

function extract(archive, outDir) {
  return new Promise((resolve, reject) => {
    log(`Extracting ${archive}`);
    const proc = spawn("tar", ["-xjf", archive, "-C", outDir], { stdio: "inherit" });
    proc.on("error", reject);
    proc.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`tar exited with code ${code}`));
    });
  });
}

async function main() {
  if (existsSync(join(MODEL_DIR, "tokens.txt"))) {
    log(`Model already present at ${MODEL_DIR} — skipping download.`);
    return;
  }

  mkdirSync(OUT_DIR, { recursive: true });

  await download(MODEL_URL, ARCHIVE_PATH);
  await extract(ARCHIVE_PATH, OUT_DIR);
  await rm(ARCHIVE_PATH);

  if (!existsSync(join(MODEL_DIR, "tokens.txt"))) {
    throw new Error(`Extraction completed but expected files missing in ${MODEL_DIR}`);
  }
  log(`Model ready at ${MODEL_DIR}`);
}

main().catch((err) => {
  console.error("[download-stt-model] failed:", err.message);
  process.exit(1);
});
