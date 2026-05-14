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

import { MODEL_NAME, MODEL_URL } from "../src/main/voice/model-info.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, "..");
const OUT_DIR = join(PROJECT_ROOT, "resources", "stt");
const MODEL_DIR = join(OUT_DIR, MODEL_NAME);
const ARCHIVE_PATH = join(OUT_DIR, `${MODEL_NAME}.tar.bz2`);

// Files written by the tar extraction. All four must be present before the
// recognizer can initialize — checking only tokens.txt would treat a partial
// install (download interrupted between files) as already-done.
const REQUIRED_FILES = ["encoder.onnx", "decoder.onnx", "joiner.onnx", "tokens.txt"];

function isModelReady() {
  return REQUIRED_FILES.every((f) => existsSync(join(MODEL_DIR, f)));
}

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
  if (isModelReady()) {
    log(`Model already present at ${MODEL_DIR} — skipping download.`);
    return;
  }

  mkdirSync(OUT_DIR, { recursive: true });

  await download(MODEL_URL, ARCHIVE_PATH);
  await extract(ARCHIVE_PATH, OUT_DIR);
  await rm(ARCHIVE_PATH);

  if (!isModelReady()) {
    throw new Error(`Extraction completed but expected files missing in ${MODEL_DIR}`);
  }
  log(`Model ready at ${MODEL_DIR}`);
}

main().catch((err) => {
  console.error("[download-stt-model] failed:", err.message);
  process.exit(1);
});
