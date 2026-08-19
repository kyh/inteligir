// The download is the only part of dictation that takes bytes off the network
// and hands them to a native runtime to mmap, so every way it can go wrong is
// pinned here: short, long, corrupted, interrupted. The property that matters
// in all four is the same — `model.bin` never exists unless it is the file the
// catalog pinned.

import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { makeTempDir } from "../../__tests__/temp-dir";
import type { VoiceModelSpec } from "../model-catalog";
import {
  downloadModel,
  isModelInstalled,
  modelDirFor,
  modelFilePath,
  ModelDownloadError,
  removeModel,
} from "../model-store";

const BODY = Buffer.from("a pretend ggml model, byte for byte");

function specFor(body: Buffer): VoiceModelSpec {
  return {
    id: "test-model",
    label: "Test model",
    sizeBytes: body.byteLength,
    sha256: createHash("sha256").update(body).digest("hex"),
    url: "https://models.test/model.bin",
  };
}

/** A fetch that answers `body` in two chunks, so progress is observable. */
function fetchServing(body: Buffer): typeof fetch {
  return async () =>
    new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          const half = Math.ceil(body.byteLength / 2);
          controller.enqueue(new Uint8Array(body.subarray(0, half)));
          controller.enqueue(new Uint8Array(body.subarray(half)));
          controller.close();
        },
      }),
    );
}

describe("downloadModel", () => {
  it("installs the file and reports progress up to its size", async () => {
    const modelDir = makeTempDir("inteligir-models-");
    const spec = specFor(BODY);
    const progress: number[] = [];
    await downloadModel({
      modelDir,
      spec,
      signal: new AbortController().signal,
      onProgress: (received) => progress.push(received),
      fetchImpl: fetchServing(BODY),
    });

    expect(readFileSync(modelFilePath(modelDir, spec))).toEqual(BODY);
    expect(await isModelInstalled(modelDir, spec)).toBe(true);
    expect(progress.at(-1)).toBe(BODY.byteLength);
    expect(progress.length).toBeGreaterThan(1);
  });

  it("refuses a body that does not match the pinned digest, and installs nothing", async () => {
    const modelDir = makeTempDir("inteligir-models-");
    const spec = specFor(BODY);
    const tampered = Buffer.from("a pretend ggml model, byte for BYTE");
    await expect(
      downloadModel({
        modelDir,
        spec,
        signal: new AbortController().signal,
        onProgress: () => undefined,
        fetchImpl: fetchServing(tampered),
      }),
    ).rejects.toThrow(ModelDownloadError);
    expect(existsSync(modelFilePath(modelDir, spec))).toBe(false);
    expect(await isModelInstalled(modelDir, spec)).toBe(false);
  });

  it("refuses a body longer than the pin without writing all of it", async () => {
    const modelDir = makeTempDir("inteligir-models-");
    const spec = specFor(BODY);
    await expect(
      downloadModel({
        modelDir,
        spec,
        signal: new AbortController().signal,
        onProgress: () => undefined,
        fetchImpl: fetchServing(Buffer.concat([BODY, Buffer.alloc(1024)])),
      }),
    ).rejects.toThrow(/larger than/u);
    expect(existsSync(modelFilePath(modelDir, spec))).toBe(false);
  });

  it("refuses a truncated body", async () => {
    const modelDir = makeTempDir("inteligir-models-");
    const spec = specFor(BODY);
    await expect(
      downloadModel({
        modelDir,
        spec,
        signal: new AbortController().signal,
        onProgress: () => undefined,
        fetchImpl: fetchServing(BODY.subarray(0, 4)),
      }),
    ).rejects.toThrow(/not the/u);
    expect(existsSync(modelFilePath(modelDir, spec))).toBe(false);
  });

  it("says which host it could not reach", async () => {
    const modelDir = makeTempDir("inteligir-models-");
    await expect(
      downloadModel({
        modelDir,
        spec: specFor(BODY),
        signal: new AbortController().signal,
        onProgress: () => undefined,
        fetchImpl: async () => {
          throw new Error("getaddrinfo ENOTFOUND");
        },
      }),
    ).rejects.toThrow(/models\.test/u);
  });

  it("answers a non-2xx with its status", async () => {
    const modelDir = makeTempDir("inteligir-models-");
    await expect(
      downloadModel({
        modelDir,
        spec: specFor(BODY),
        signal: new AbortController().signal,
        onProgress: () => undefined,
        fetchImpl: async () => new Response("gone", { status: 404 }),
      }),
    ).rejects.toThrow(/404/u);
  });
});

describe("isModelInstalled", () => {
  it("is false for a file of the wrong size — a crash between rename and flush", async () => {
    const modelDir = makeTempDir("inteligir-models-");
    const spec = specFor(BODY);
    await mkdir(modelDirFor(modelDir, spec), { recursive: true });
    writeFileSync(modelFilePath(modelDir, spec), BODY.subarray(0, 3));
    expect(await isModelInstalled(modelDir, spec)).toBe(false);
  });
});

describe("removeModel", () => {
  it("takes the model and any partial beside it, and is idempotent", async () => {
    const modelDir = makeTempDir("inteligir-models-");
    const spec = specFor(BODY);
    await mkdir(modelDirFor(modelDir, spec), { recursive: true });
    writeFileSync(modelFilePath(modelDir, spec), BODY);
    writeFileSync(join(modelDirFor(modelDir, spec), "download"), BODY);

    await removeModel(modelDir, spec);
    expect(existsSync(modelDirFor(modelDir, spec))).toBe(false);
    await expect(removeModel(modelDir, spec)).resolves.toBeUndefined();
  });
});
